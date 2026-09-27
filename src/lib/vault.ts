import crypto from "node:crypto";
import { db, uuid, now, audit } from "./db";

// ── AES-256-GCM vault: real secrets never leave this module unencrypted ──
const SALT = "muse-vault-v1";

function key(): Buffer {
  const secret = process.env.VAULT_SECRET || "";
  if (!secret) {
    throw new Error(
      "VAULT_SECRET is not set. Copy .env.example to .env and set a long random string."
    );
  }
  return crypto.scryptSync(secret, SALT, 32);
}

export function encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(payload: { ciphertext: string; iv: string; tag: string }): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ── Credential surrogation ────────────────────────────────────────────────
// The agent only ever sees surrogate tokens like {{vault:stripe_card_1}}.
// Real values are resolved exclusively inside connector boundary code.

export function surrogateFor(label: string): string {
  return `{{vault:${label}}}`;
}

export function putSecret(label: string, kind: string, value: string) {
  const enc = encrypt(value);
  db.prepare(
    `INSERT INTO vault_secrets (id, label, kind, ciphertext, iv, tag, surrogate, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(label) DO UPDATE SET kind=excluded.kind, ciphertext=excluded.ciphertext,
       iv=excluded.iv, tag=excluded.tag, updated_at=excluded.updated_at`
  ).run(
    uuid(),
    label,
    kind,
    enc.ciphertext,
    enc.iv,
    enc.tag,
    surrogateFor(label),
    now(),
    now()
  );
  audit("vault", "secret.stored", { target: label, risk: "high" });
}

export function getSecret(label: string): string | null {
  const row = db.prepare("SELECT * FROM vault_secrets WHERE label = ?").get(label) as
    | { ciphertext: string; iv: string; tag: string }
    | undefined;
  if (!row) return null;
  return decrypt(row);
}

export function listSecretLabels(): { label: string; kind: string; surrogate: string }[] {
  return db
    .prepare("SELECT label, kind, surrogate FROM vault_secrets ORDER BY label")
    .all() as { label: string; kind: string; surrogate: string }[];
}

export function deleteSecret(label: string) {
  db.prepare("DELETE FROM vault_secrets WHERE label = ?").run(label);
  audit("vault", "secret.deleted", { target: label, risk: "medium" });
}

/** Replace any surrogate tokens in a string with real secret values. Connector-boundary only. */
export function resolveSurrogates(text: string): string {
  return text.replace(/\{\{vault:([^}]+)\}\}/g, (_m, label) => getSecret(label) ?? "");
}

// Redaction: scrub anything that looks like a secret from text that could reach the model or UI.
const SECRETISH_PATTERNS: RegExp[] = [
  /\{\{vault:[^}]+\}\}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRETISH_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}
