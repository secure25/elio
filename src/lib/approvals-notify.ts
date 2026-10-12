// ── Telegram approval notifications ───────────────────────────────────────
// Every time the Sentinel queues a pending approval, the owner gets a message
// on their connected Telegram chat with inline ✅ Approve / ❌ Decline
// buttons, so sensitive actions can be resolved from Telegram without opening
// the app. Tapping a button hits the normal Telegram webhook as a
// callback_query; the resolution goes through the SAME resolveApproval used
// by the web app, so state stays consistent and the agent resume logic works
// unchanged. The chat id is hard-locked to the owner's vaulted chat — no
// third party can ever resolve an approval from Telegram.
import { db, now, audit } from "./db";
import { getSecret } from "./vault";
import { resolveApproval } from "./sentinel";
import { sendTelegramDirect, answerCallbackQuery } from "./connectors/messaging";
import { resumeTaskForApproval } from "./agent/runner";

export function telegramApprovalsEnabled(): boolean {
  // Toggle lives in Settings → Behavior (approval_telegram_enabled, default ON)
  return (db.prepare("SELECT value FROM settings WHERE key = 'approval_telegram_enabled'").get() as any)?.value !== "false";
}

/** Escape Telegram message-mode entities (v1: plain text is fine). */
const fmtAmountDetail = (detail: string, max = 340) =>
  detail.length > max ? `${detail.slice(0, max)}…` : `${detail}${detail.length === max ? "" : ""}`;

/** Push a newly-created pending approval to the owner's Telegram chat. */
export async function notifyApprovalCreated(
  approvalId: string,
  action: string,
  detail: string,
  risk: string
): Promise<void> {
  try {
    if (!telegramApprovalsEnabled()) return;
    const chatId = getSecret("telegram_chat_id");
    if (!chatId) return;

    const header = risk === "high" ? "🔔 Approval needed — high risk" : risk === "medium" ? "🔔 Approval needed" : "🔔 Approval";
    const text =
      `${header}\n\n` +
      `Action: ${action}\n` +
      `${fmtAmountDetail(detail)}\n\n` +
      `You can approve or decline right here, or in the Approvals page of the app.`;

    // sendMessage with inline keyboard uses the same bot API endpoint; we
    // bypass sendTelegramDirect because we need reply_markup.
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approval:approve:${approvalId}` },
            { text: "❌ Decline", callback_data: `approval:decline:${approvalId}` },
          ],
        ],
      },
    });
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    audit("sentinel", "approval.telegram_notified", {
      target: action,
      detail: `${data.ok ? "sent to owner chat" : `failed: ${data.description ?? res.status}`}`,
      risk,
    });
  } catch (e: any) {
    // Never break the Sentinel flow over a delivery hiccup.
    audit("sentinel", "approval.telegram_notify_error", {
      detail: String(e?.message || e).slice(0, 200),
      risk: "low",
    });
  }
}

/**
 * Handle an inline-keyboard callback from the owner: approve or decline the
 * referenced approval via the same path the web app uses, then confirm on
 * Telegram. Returns true if this callback was an approval action.
 */
export async function handleApprovalCallback(
  chatId: string | number,
  callbackId: string,
  data: string | undefined
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  // Security: only the owner's vaulted chat may act on approvals. If the chat
  // id is unset there is no linked owner — refuse.
  const ownerChatId = getSecret("telegram_chat_id");
  if (!ownerChatId || String(chatId) !== String(ownerChatId)) {
    if (token) void answerCallbackQuery(callbackId, "Not authorized", true);
    return true; // consume the callback either way
  }

  const match = /^approval:(approve|decline):([A-Za-z0-9-]+)$/.exec(data || "");
  if (!match) return false; // not ours — let other handlers look at it

  const [, verb, approvalId] = match;
  const approve = verb === "approve";

  const row = db.prepare("SELECT action, detail, status FROM approvals WHERE id = ?").get(approvalId) as
    | { action: string; detail: string; status: string }
    | undefined;
  if (!row) {
    if (token) void answerCallbackQuery(callbackId, "Approval not found", true);
    return true;
  }
  if (row.status !== "pending") {
    if (token) void answerCallbackQuery(callbackId, `Already ${row.status}`, true);
    return true;
  }

  const resolved = resolveApproval(approvalId, approve);
  audit("sentinel", approve ? "approval.granted_telegram" : "approval.denied_telegram", {
    target: row.action,
    detail: row.detail.slice(0, 200),
    risk: "medium",
  });

  if (token) {
    void answerCallbackQuery(callbackId, approve ? "✅ Approved" : "❌ Declined");
    void sendTelegramDirect(
      chatId,
      `${approve ? "✅ Approved" : "❌ Declined"}: ${row.action}\n${row.detail.slice(0, 160)}`
    ).then(() => {
      // Kick the waiting connector/agent loop awake (same as the web app does).
      void resumeTaskForApproval(approvalId);
    });
  } else {
    void resumeTaskForApproval(approvalId);
  }
  return true;
}
