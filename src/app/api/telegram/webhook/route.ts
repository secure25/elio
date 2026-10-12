import { NextRequest, NextResponse } from "next/server";
import { db, now, uuid, audit } from "@/lib/db";
import { getSecret, putSecret } from "@/lib/vault";
import {
  sendTelegramDirect,
  sendTelegramChatAction,
  saveTelegramChat,
} from "@/lib/connectors/messaging";
import { runAgent } from "@/lib/agent/loop";
import { createTask } from "@/lib/agent/runner";
import { extractMemories } from "@/lib/memory";
import { tryHandleDigestReply } from "@/lib/digest-commands";
import { runDigest, unreadDigestCount } from "@/lib/digest";
import { handleApprovalCallback } from "@/lib/approvals-notify";
import { guard } from "@/lib/sentinel";

export const runtime = "nodejs";
export const maxDuration = 300;

// Deduplication cache for recent Telegram update_ids (prevents duplicate runs on webhook retries)
const recentUpdates = new Set<number>();
function trackUpdate(updateId: number): boolean {
  if (recentUpdates.has(updateId)) return false;
  recentUpdates.add(updateId);
  if (recentUpdates.size > 500) {
    const oldest = recentUpdates.values().next().value;
    if (oldest !== undefined) recentUpdates.delete(oldest);
  }
  return true;
}

function upsertGrant(connector: string, accountEmail: string) {
  const existing = db.prepare("SELECT id FROM connector_grants WHERE connector = ?").get(connector) as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare(
      "UPDATE connector_grants SET status = 'connected', account_email = ?, updated_at = ? WHERE connector = ?"
    ).run(accountEmail, now(), connector);
  } else {
    db.prepare(
      "INSERT INTO connector_grants (id, connector, scopes, status, account_email, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(uuid(), connector, "", "connected", accountEmail, now(), now());
  }
  audit("connectors", `${connector}.connected`, { detail: "connected via Telegram webhook", risk: "medium" });
}

export async function GET() {
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const chatId = getSecret("telegram_chat_id");
  return NextResponse.json({
    ok: true,
    service: "Elio Telegram Webhook",
    status: configured ? "ready" : "missing_bot_token",
    chatLinked: Boolean(chatId),
  });
}

export async function POST(req: NextRequest) {
  // Optional secret verification
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && secretHeader !== expectedSecret) {
    audit("security", "telegram.webhook_unauthorized", { detail: "Secret token mismatch", risk: "high" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as any;
  if (!update) {
    return NextResponse.json({ ok: true });
  }

  // ── Inline-keyboard callbacks (Approve / Decline) ────────────────────────
  // Fast-path before the message handler so pressing a button never logs a
  // fake empty "message". Only the owner's chat may act; anything else is
  // consumed (answered) by handleApprovalCallback itself.
  if (update.callback_query) {
    const cb = update.callback_query;
    if (typeof update.update_id === "number" && !trackUpdate(update.update_id)) {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    try {
      await handleApprovalCallback(cb?.message?.chat?.id, cb?.id, cb?.data);
    } catch (e: any) {
      audit("telegram", "approval.callback_error", { detail: String(e?.message || e).slice(0, 200), risk: "low" });
    }
    return NextResponse.json({ ok: true });
  }

  if (!update.message) {
    return NextResponse.json({ ok: true });
  }

  const updateId = update.update_id;
  if (typeof updateId === "number" && !trackUpdate(updateId)) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  const message = update.message;
  const chat = message.chat;
  const from = message.from;
  const text = (message.text || "").trim();

  if (!chat?.id || !text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = chat.id;
  const senderName = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || `chat ${chatId}`;

  // Check authorization
  const ownerChatId = getSecret("telegram_chat_id");
  if (ownerChatId && String(chatId) !== String(ownerChatId)) {
    audit("security", "telegram.unauthorized_chat", {
      detail: `Rejected message from chat ${chatId} (${senderName})`,
      risk: "high",
    });
    void sendTelegramDirect(
      chatId,
      "🔒 Sorry, this Elio assistant is private and only responds to its configured owner."
    );
    return NextResponse.json({ ok: true });
  }

  // Auto-link owner on first interaction if not yet set
  if (!ownerChatId) {
    saveTelegramChat(chatId);
    upsertGrant("telegram", `telegram: ${senderName}`);
    audit("connectors", "telegram.owner_linked", { detail: `Linked owner chat ${chatId} (${senderName})` });
    if (text === "/start") {
      void sendTelegramDirect(
        chatId,
        `👋 Welcome to Elio! Your Telegram account has been linked as the owner (${senderName}).\n\nYou can now talk with me here anytime just like in the web app!\n\nTry asking me:\n• "What's on my calendar today?"\n• "Check my unread emails"\n• "Summarize the latest AI news"\n\nCommands:\n/status — Check running tasks & approvals\n/digest — Get your daily digest\n/new — Start a fresh conversation`
      );
      return NextResponse.json({ ok: true });
    }
  }

  // Handle standard slash commands
  if (text === "/start") {
    void sendTelegramDirect(
      chatId,
      `👋 Hi! I'm Elio, your personal AI assistant.\n\nYou can chat with me here just like in the web app:\n• Ask questions or research topics\n• Check your inbox and calendar\n• Give me tasks to run\n• Browse the web and summarize articles\n\nCommands:\n/status — Check active tasks & approvals\n/digest — Send your daily digest now\n/new — Start a fresh conversation`
    );
    return NextResponse.json({ ok: true });
  }

  if (text === "/status") {
    const running = db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE status IN ('pending', 'running')")
      .get() as { c: number };
    const pendingApprovals = db
      .prepare("SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'")
      .get() as { c: number };
    const unreadDigests = unreadDigestCount();

    const statusMsg = [
      `📊 *Elio Status Overview*`,
      ``,
      `• Active tasks: ${running.c}`,
      `• Pending approvals: ${pendingApprovals.c}`,
      `• Unread digests: ${unreadDigests}`,
      ``,
      pendingApprovals.c > 0
        ? `⚠️ You have ${pendingApprovals.c} approval(s) waiting in the web app.`
        : `✅ All systems running smoothly.`,
    ].join("\n");

    void sendTelegramDirect(chatId, statusMsg);
    return NextResponse.json({ ok: true });
  }

  if (text === "/digest") {
    void (async () => {
      void sendTelegramChatAction(chatId, "typing");
      try {
        const d = await runDigest("morning", true);
        await sendTelegramDirect(chatId, `☀️ Here is your latest Elio digest:\n\n${d.body}`);
      } catch (e: any) {
        await sendTelegramDirect(chatId, `Failed to generate digest: ${e.message}`);
      }
    })();
    return NextResponse.json({ ok: true });
  }

  if (text === "/approval-test") {
    // Owner-only end-to-end self-test: creates a harmless synthetic pending
    // approval (action 'test.telegram_e2e'), which the Sentinel automatically
    // pushes to this chat with Approve/Decline buttons. Nothing real is at
    // stake — it exists so the owner can verify the approval→Telegram→button
    // pipeline works, and this command is reachable only from the locked chat.
    const verdict = guard({
      action: "test.telegram_e2e",
      detail: "Synthetic E2E test approval — safe to approve or decline. Created via /approval-test from Telegram.",
      conversationId: getSecret("telegram_active_conversation_id"),
    });
    void sendTelegramDirect(
      chatId,
      verdict.decision === "ask" && verdict.approvalId
        ? "🧪 Test approval created — the card with Approve/Decline buttons should arrive next. Tap one to complete the end-to-end test."
        : "Unexpected verdict: " + JSON.stringify(verdict)
    );
    return NextResponse.json({ ok: true });
  }

  if (text === "/new" || text === "/clear") {
    const newConvId = uuid();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, 'Telegram', ?, ?)").run(
      newConvId,
      now(),
      now()
    );
    putSecret("telegram_active_conversation_id", "system", newConvId);
    void sendTelegramDirect(chatId, "✨ Started a fresh conversation thread. What would you like to work on?");
    return NextResponse.json({ ok: true });
  }

  // ── Conversational chat with Elio ───────────────────────────────────────
  // Process asynchronously in background so Telegram gets an instant 200 OK.
  void handleIncomingMessage(chatId, text, message.message_id);

  return NextResponse.json({ ok: true });
}

async function handleIncomingMessage(chatId: string | number, text: string, messageId?: number) {
  // Start typing indicator immediately and keep it active while the agent works
  void sendTelegramChatAction(chatId, "typing");
  const typingTimer = setInterval(() => {
    void sendTelegramChatAction(chatId, "typing");
  }, 4000);

  try {
    // Find or create active Telegram conversation
    let convId = getSecret("telegram_active_conversation_id");
    if (convId) {
      const exists = db.prepare("SELECT id FROM conversations WHERE id = ?").get(convId);
      if (!exists) convId = null;
    }

    if (!convId) {
      const existingRow = db
        .prepare("SELECT id FROM conversations WHERE title = 'Telegram' ORDER BY updated_at DESC LIMIT 1")
        .get() as { id: string } | undefined;
      if (existingRow) {
        convId = existingRow.id;
      } else {
        convId = uuid();
        db.prepare(
          "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, 'Telegram', ?, ?)"
        ).run(convId, now(), now());
      }
      putSecret("telegram_active_conversation_id", "system", convId);
    } else {
      db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now(), convId);
    }

    // Record the user message
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, 'user', ?, ?, ?)"
    ).run(
      uuid(),
      convId,
      text,
      JSON.stringify({ channel: "telegram", ...(messageId ? { messageId } : {}) }),
      now()
    );

    // Fast-path: digest-reply commands
    const command = tryHandleDigestReply(text, convId);
    if (command?.handled) {
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
      ).run(
        uuid(),
        convId,
        "assistant",
        command.reply,
        JSON.stringify({ digestCommand: true, channel: "telegram" }),
        now()
      );
      clearInterval(typingTimer);
      await sendTelegramDirect(chatId, command.reply);
      return;
    }

    // Memory extraction in background
    void extractMemories(text).catch(() => {});

    // Create and execute task
    const taskId = createTask(text, convId);
    db.prepare("UPDATE tasks SET status='running', updated_at=? WHERE id=?").run(now(), taskId);

    const { finalText } = await runAgent(text, {
      taskId,
      conversationId: convId,
    });

    clearInterval(typingTimer);

    // Record assistant message
    db.prepare("UPDATE tasks SET status='done', updated_at=? WHERE id=?").run(now(), taskId);
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)"
    ).run(uuid(), convId, finalText, JSON.stringify({ taskId, channel: "telegram" }), now());

    // Send result directly back to user on Telegram
    await sendTelegramDirect(chatId, finalText);
  } catch (err: any) {
    clearInterval(typingTimer);
    const errMessage = err.message || "An unexpected error occurred.";
    audit("telegram", "message.error", { detail: errMessage.slice(0, 200), risk: "medium" });
    await sendTelegramDirect(chatId, `⚠️ Something went wrong while working on this: ${errMessage}`);
  }
}
