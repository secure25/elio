// ── Phone-messaging connectors (free, hosted APIs — nothing self-hosted) ──
// Telegram Bot API: free forever, hosted by Telegram. Sends to a chat the user
//   opened with their own bot (bot token in .env, chat id in the vault).
// WhatsApp Cloud API: Meta-hosted, free tier includes service conversations;
//   replies inside a 24h session window are free. Business token + phone-id in
//   .env, recipient number in the vault.
//
// Both are SENT-ONLY from Elio: inbound replies arrive in the user's normal
// Telegram/WhatsApp apps, not here — no webhooks needed, so this deploys
// anywhere (Vercel, Railway, Fly) without persistent sockets.
//
// Safety model (Sentinel):
//   message.send      → "allow": the recipient is always the owner's own
//                       vault-locked chat — never a third party.
//   message.send_test → "allow": the test ping only ever goes to the OWNER's
//                       own chat/number (hard-restricted below), never the LLM.
import { getSecret, putSecret } from "../vault";
import { guard, waitForApproval } from "../sentinel";
import { addStep, audit } from "../db";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN) && getSecret("telegram_chat_id") !== null;
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) && getSecret("whatsapp_to") !== null;
}

/** Recipient identifiers live in the vault — never logged, never in chat history. */
export function telegramRecipientHint(): string {
  return getSecret("telegram_chat_id") !== null ? "your connected Telegram chat" : "your Telegram chat";
}

export function whatsappRecipientHint(): string {
  return getSecret("whatsapp_to") !== null ? "your connected WhatsApp number" : "your WhatsApp number";
}

/** One-tap setup helper: resolves the owner's own chat id (owner-initiated only). */
export async function telegramResolveChat(): Promise<{ ok: boolean; message: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, message: "TELEGRAM_BOT_TOKEN is not set in .env" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = (await res.json()) as any;
    if (!data.ok) return { ok: false, message: `Telegram API error: ${data.description ?? res.status}` };
    const msgs = data.result ?? [];
    if (!msgs.length) {
      return {
        ok: false,
        message:
          "No messages yet. Open Telegram, find your bot (the username from BotFather), press START, and send it any message — then try again.",
      };
    }
    const last = msgs[msgs.length - 1];
    const chat = last.message?.chat;
    if (!chat?.id) return { ok: false, message: "Could not find a chat in recent updates." };
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || `chat ${chat.id}`;
    saveTelegramChat(chat.id);
    audit("connectors", "telegram.chat_resolved", { detail: `chat: ${name}` });
    return { ok: true, message: `Found chat with ${name}. Saved as your message target.` };
  } catch (e: any) {
    return { ok: false, message: `Network error reaching Telegram: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** Persist the owner's Telegram chat id (setup path, not agent-reachable). */
export function saveTelegramChat(chatId: string | number): void {
  putSecret("telegram_chat_id", "messaging", String(chatId));
}

export async function sendTelegram(
  taskId: string | null,
  conversationId: string | null,
  text: string
): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = getSecret("telegram_chat_id");
  if (!token || !chatId) return "Telegram is not fully connected (missing bot token or chat id).";

  const verdict = guard({
    action: "message.send",
    detail: `Send Telegram message to ${telegramRecipientHint()}: "${text.slice(0, 160)}"`,
    taskId,
    conversationId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return "Blocked by Sentinel.";
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") return "Message was NOT sent (approval denied or timed out).";
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = (await res.json()) as any;
    if (!res.ok || !data.ok) {
      const desc = data.description ?? `HTTP ${res.status}`;
      return `Telegram send failed: ${desc}`;
    }
    if (taskId) addStep(taskId, "message.send", `Telegram message delivered (${text.length} chars)`);
    audit("connectors", "telegram.sent", { detail: `${text.length} chars via Telegram Bot API`, risk: "high" });
    return `Sent via Telegram: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`;
  } catch (e: any) {
    return `Telegram send error: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}

export async function sendWhatsApp(
  taskId: string | null,
  conversationId: string | null,
  text: string
): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const to = getSecret("whatsapp_to");
  if (!token || !phoneId || !to) return "WhatsApp is not fully connected (missing token, phone id, or recipient).";

  const verdict = guard({
    action: "message.send",
    detail: `Send WhatsApp message to ${whatsappRecipientHint()}: "${text.slice(0, 160)}"`,
    taskId,
    conversationId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return "Blocked by Sentinel.";
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") return "Message was NOT sent (approval denied or timed out).";
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      const err = data?.error?.message ?? `HTTP ${res.status}`;
      return `WhatsApp send failed: ${err}`;
    }
    if (taskId) addStep(taskId, "message.send", `WhatsApp message delivered (${text.length} chars)`);
    audit("connectors", "whatsapp.sent", { detail: `${text.length} chars via WhatsApp Cloud API`, risk: "high" });
    return `Sent via WhatsApp: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`;
  } catch (e: any) {
    return `WhatsApp send error: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}

// ── Non-interactive senders (scheduler/reminder delivery) ─────────────────
// The CALLER performs the Sentinel check (message.send_reminder is allow-classed
// because recipient + content are both owner-locked). These never wait on
// approvals — scheduled delivery can't block on a human.
export async function sendTelegramDirect(
  chatId: string | number,
  text: string
): Promise<{ ok: boolean; message?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, message: "Missing TELEGRAM_BOT_TOKEN" };
  if (!chatId) return { ok: false, message: "Missing chat ID" };

  // Telegram character limit is 4096. Split into clean chunks <= 4000 chars.
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 4000) {
    let splitIdx = remaining.lastIndexOf("\n\n", 4000);
    if (splitIdx < 1000) splitIdx = remaining.lastIndexOf("\n", 4000);
    if (splitIdx < 1000) splitIdx = 4000;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);

  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || !data.ok) {
        return { ok: false, message: data.description || `HTTP ${res.status}` };
      }
    } catch (e: any) {
      return { ok: false, message: String(e.message || e) };
    }
  }
  return { ok: true };
}

/** Answer an inline-keyboard callback query (removes the spinner on the button). */
export async function answerCallbackQuery(
  callbackId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callbackId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: showAlert }),
    });
    await res.json().catch(() => ({}));
  } catch {
    // Non-critical
  }
}

export async function sendTelegramChatAction(
  chatId: string | number,
  action: "typing" | "upload_document" | "find_location" = "typing"
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Non-critical action
  }
}

export async function setTelegramWebhook(
  url: string,
  secretToken?: string
): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "Missing TELEGRAM_BOT_TOKEN" };
  try {
    const body: Record<string, string> = { url };
    if (secretToken) body.secret_token = secretToken;
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    return { ok: !!data.ok, description: data.description || (data.ok ? "Webhook set" : `HTTP ${res.status}`) };
  } catch (e: any) {
    return { ok: false, description: String(e.message || e) };
  }
}

export async function deleteTelegramWebhook(): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "Missing TELEGRAM_BOT_TOKEN" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    const data = (await res.json()) as any;
    return { ok: !!data.ok, description: data.description || (data.ok ? "Webhook removed" : `HTTP ${res.status}`) };
  } catch (e: any) {
    return { ok: false, description: String(e.message || e) };
  }
}

export async function getTelegramWebhookInfo(): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "Missing TELEGRAM_BOT_TOKEN" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    return await res.json();
  } catch (e: any) {
    return { ok: false, description: String(e.message || e) };
  }
}

export async function deliverTelegram(text: string): Promise<string> {
  const chatId = getSecret("telegram_chat_id");
  if (!chatId) return "Telegram is not fully connected.";
  const res = await sendTelegramDirect(chatId, text);
  if (!res.ok) return `Telegram send failed: ${res.message}`;
  audit("connectors", "telegram.delivered", { detail: `${text.length} chars (scheduled delivery)`, risk: "medium" });
  return `Sent via Telegram`;
}

export async function deliverWhatsApp(text: string): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const to = getSecret("whatsapp_to");
  if (!token || !phoneId || !to) return "WhatsApp is not fully connected.";
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return `WhatsApp send failed: ${data?.error?.message ?? res.status}`;
    audit("connectors", "whatsapp.delivered", { detail: `${text.length} chars (scheduled delivery)`, risk: "medium" });
    return `Sent via WhatsApp`;
  } catch (e: any) {
    return `WhatsApp send error: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}

/** Owner-initiated test ping — hard-restricted to the owner's own chat/number. */
export async function sendTestMessage(channel: "telegram" | "whatsapp"): Promise<string> {
  const guardVerdict = guard({ action: "message.send_test", detail: `Test ping via ${channel} to the owner only` });
  if (guardVerdict.decision === "deny") return `Blocked by Sentinel: ${guardVerdict.reason}`;
  const text = `👋 Elio messaging is live (test ping, ${new Date().toLocaleString()}).`;
  return channel === "telegram"
    ? sendTelegram(null, null, text).then((r) => r.replace(/^Sent via Telegram/, "Test sent via Telegram"))
    : sendWhatsApp(null, null, text).then((r) => r.replace(/^Sent via WhatsApp/, "Test sent via WhatsApp"));
}
