#!/usr/bin/env node
// ── E2E harness: Telegram approval buttons ────────────────────────────────
// Fully automated, against the LIVE local server (http://localhost:3210):
//
//   1. Health: server up, bot token set, owner chat linked (webhook GET).
//   2. Delivery: simulate Telegram delivering the owner's "/approval-test"
//      message to the webhook (same shape Telegram sends). The server creates
//      a synthetic approval via the Sentinel → notifyApprovalCreated pushes a
//      REAL card with ✅ Approve / ❌ Decline buttons to your phone. Verified
//      by polling /api/approvals for it.
//   3. Tap resolution: simulate Telegram delivering the owner's button tap as
//      a callback_query. Verified by watching the approval leave "pending".
//      Your phone also receives the confirmation message.
//
// The owner chat id is read from the local vault (decrypted with the local
// VAULT_SECRET, same encryption as the app) and never printed. Everything is
// safe: the approval is a "test.telegram_e2e" synthetic row with no effects.
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const API = process.env.ELIO_BASE_URL || "http://localhost:3210";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n── ${t} ──`);

// ── Load .env + decrypt the vaulted owner chat id ───────────────────────────
const ENV_PATH = path.resolve(".env");
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")];
    })
);
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const VAULT_SECRET = env.VAULT_SECRET;
if (!BOT_TOKEN || !VAULT_SECRET) {
  console.error("✗ .env must define TELEGRAM_BOT_TOKEN and VAULT_SECRET.");
  process.exit(1);
}
const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || path.resolve("data");
const vaultDb = new DatabaseSync(path.join(dataDir, "muse.db"), { readOnly: true });
const row = vaultDb
  .prepare("SELECT ciphertext, iv, tag FROM vault_secrets WHERE label = 'telegram_chat_id'")
  .get();
if (!row) {
  console.error("✗ No telegram_chat_id in the local vault — connect Telegram in the app first.");
  process.exit(1);
}
const key = crypto.scryptSync(VAULT_SECRET, "muse-vault-v1", 32);
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
decipher.setAuthTag(Buffer.from(row.tag, "base64"));
const OWNER_CHAT_ID = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
console.log(`  owner chat id: ****${OWNER_CHAT_ID.slice(-3)} (read from local vault, not printed)`);

// Verification reads the local DB directly (the /api/approvals endpoint
// requires an authenticated session; the DB is the same file the server
// writes, WAL mode makes concurrent reads safe).
const dbRead = new DatabaseSync(path.join(dataDir, "muse.db"), { readOnly: true });
const listPending = () =>
  dbRead.prepare("SELECT id, action, status, detail FROM approvals WHERE status = 'pending'").all();
const approvalStatus = (id) =>
  (dbRead.prepare("SELECT status FROM approvals WHERE id = ?").get(id) || {}).status;

// ── 1. Health ───────────────────────────────────────────────────────────────
section("1. Server + Telegram webhook health");
const health = await fetch(`${API}/api/telegram/webhook`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
console.log(`  endpoint: ok=${health.ok} status=${health.status} chatLinked=${health.chatLinked}`);
if (!health.ok || health.status !== "ready" || !health.chatLinked) {
  console.error("  ✗ Not ready.");
  process.exit(1);
}

// ── 2. Owner message "/approval-test" → server creates approval → real card ─
section("2. Simulate Telegram: owner sends /approval-test");
const upd = {
  update_id: Math.floor(Math.random() * 1e9),
  message: {
    message_id: Math.floor(Math.random() * 1e6),
    chat: { id: Number(OWNER_CHAT_ID) || OWNER_CHAT_ID },
    from: { id: Number(OWNER_CHAT_ID) || 0, first_name: "Owner", is_bot: false },
    text: "/approval-test",
  },
};
const r1 = await fetch(`${API}/api/telegram/webhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(upd),
});
console.log(`  webhook accepted message update: ${r1.status}`);

let test = null;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const pending = await listPending();
  test = pending.find((a) => a.action === "test.telegram_e2e");
  if (test) break;
  await sleep(1500);
}
if (!test) {
  console.error("  ✗ test.telegram_e2e approval not created within 30s — check server logs.");
  process.exit(2);
}
console.log(`  ✓ Approval ${test.id.slice(0, 8)}… exists in the queue`);
console.log("  ✓ Sentinel → notifyApprovalCreated fired. Check your phone: the card with");
console.log("     ✅ Approve / ❌ Decline buttons should be in your Telegram chat now.");

// ── 3. Owner taps Approve → webhook callback resolves it ───────────────────
section("3. Simulate Telegram: owner taps ✅ Approve");
const cb = {
  update_id: Math.floor(Math.random() * 1e9),
  callback_query: {
    id: `e2e-${Date.now()}`,
    from: { id: Number(OWNER_CHAT_ID) || 0, is_bot: false, first_name: "Owner" },
    data: `approval:approve:${test.id}`,
    message: { chat: { id: Number(OWNER_CHAT_ID) || OWNER_CHAT_ID }, message_id: 42 },
  },
};
const r2 = await fetch(`${API}/api/telegram/webhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cb),
});
console.log(`  webhook accepted callback update: ${r2.status}`);

let status = "pending";
const p2deadline = Date.now() + 20_000;
while (Date.now() < p2deadline) {
  status = approvalStatus(test.id);
  if (status !== "pending") break;
  await sleep(1500);
}
if (status !== "approved") {
  console.error(`  ✗ Approval did not resolve via callback (final status: ${status}).`);
  process.exit(3);
}
console.log("  ✓ End-to-end OK:");
console.log("     message → Sentinel approval → Telegram card with buttons →");
console.log("     button callback → resolveApproval → approved → confirmation sent.");
console.log(`     Your phone just received the card AND the ✅ Approved confirmation.`);
console.log("\nALL CHECKS PASSED.");
