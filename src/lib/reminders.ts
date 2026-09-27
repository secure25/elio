// ── Reminders: time-based pings the scheduler fires on schedule ──────────
// A reminder is a durable row: what to say, when, and how to notify.
// Delivery channels are owner-only by design (no third parties): the chat,
// the digest, and any connected messaging channel (Telegram/WhatsApp) —
// reminder delivery is Sentinel-classified separately (message.send_reminder)
// because the recipient is locked to the owner and the content is the
// reminder the owner themselves asked for.
import { db, now, uuid, audit } from "./db";
import { guard } from "./sentinel";

export interface Reminder {
  id: string;
  content: string;
  due_at: number; // epoch ms
  status: "pending" | "fired" | "cancelled";
  channel: string; // "chat" | "messaging"
  created_at: number;
  fired_at: number | null;
  conversation_id: string | null;
}

/** Parse flexible natural-language date-times into epoch ms. */
export function parseWhen(input: string): number | null {
  const s = input.trim().toLowerCase();
  const nowMs = Date.now();

  // "in 20 minutes" / "in 2 hours" / "in 3 days"
  const rel = s.match(/^in\s+(\d+)\s*(min|mins|minute|minutes|h|hr|hours|d|day|days)\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2][0];
    return nowMs + n * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
  }

  const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);

  // "tomorrow 9am" / "tomorrow at 9:30" / "tomorrow"
  if (/^tomorrow\b/.test(s)) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + 1);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (timeMatch[3] === "pm" && h < 12) h += 12;
      if (timeMatch[3] === "am" && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0);
    }
    return d.getTime();
  }

  // "tonight 8pm" / "today 4pm" / "tonight"
  if (/^(tonight|today)\b/.test(s)) {
    const d = new Date(nowMs);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (timeMatch[3] === "pm" && h < 12) h += 12;
      if (timeMatch[3] === "am" && h === 12) h = 0;
      // Bare hour in the night range + "tonight" means evening (8pm, not 8am).
      if (!timeMatch[3] && h < 8) h += 12;
      d.setHours(h, m, 0, 0);
      if (d.getTime() < nowMs) d.setDate(d.getDate() + 1);
    } else {
      d.setHours(20, 0, 0, 0);
    }
    return d.getTime();
  }

  // "at 5:30 pm" / "5pm" — today, or tomorrow if that time already passed.
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (timeMatch[3] === "pm" && h < 12) h += 12;
    if (timeMatch[3] === "am" && h === 12) h = 0;
    const d = new Date(nowMs);
    d.setHours(h, m, 0, 0);
    if (d.getTime() < nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // ISO-ish fallback ("2026-09-23T15:00" etc.)
  const t = Date.parse(input);
  return Number.isNaN(t) ? null : t;
}

export function createReminder(opts: {
  content: string;
  when: string | number;
  channel?: string;
  conversationId?: string | null;
}): { ok: boolean; message: string; id?: string; dueAt?: number } {
  const content = opts.content.trim();
  if (!content) return { ok: false, message: "Reminder text is required." };
  const dueAt = typeof opts.when === "number" ? opts.when : parseWhen(opts.when);
  if (!dueAt || Number.isNaN(dueAt) || dueAt < Date.now() - 60_000) {
    return {
      ok: false,
      message: `Could not understand the time "${opts.when}". Try "in 20 minutes", "tomorrow 9am", or an ISO datetime.`,
    };
  }
  const channel = opts.channel === "messaging" ? "messaging" : "chat";
  const id = uuid();
  db.prepare(
    "INSERT INTO reminders (id, content, due_at, status, channel, created_at, fired_at, conversation_id, updated_at) VALUES (?,?,?,'pending',?,?,NULL,?,?)"
  ).run(id, content.slice(0, 500), dueAt, channel, now(), opts.conversationId ?? null, now());
  audit("reminders", "created", {
    detail: `${content.slice(0, 120)} @ ${new Date(dueAt).toISOString()} via ${channel}`,
    risk: "low",
  });
  return { ok: true, message: `Reminder set for ${new Date(dueAt).toLocaleString()}.`, id, dueAt };
}

export function listReminders(includeDone = false): Reminder[] {
  const rows = db
    .prepare(
      includeDone
        ? "SELECT * FROM reminders ORDER BY due_at ASC LIMIT 100"
        : "SELECT * FROM reminders WHERE status = 'pending' ORDER BY due_at ASC LIMIT 100"
    )
    .all() as any[];
  return rows as Reminder[];
}

export function cancelReminder(idOrMatch: string): number {
  const byId = db.prepare("SELECT id FROM reminders WHERE id = ? AND status='pending'").get(idOrMatch);
  if (byId) {
    db.prepare("UPDATE reminders SET status='cancelled', updated_at=? WHERE id=?").run(now(), idOrMatch);
    audit("reminders", "cancelled", { target: idOrMatch });
    return 1;
  }
  const rows = db
    .prepare("SELECT id FROM reminders WHERE status='pending' AND content LIKE ?")
    .all(`%${idOrMatch}%`) as any[];
  for (const r of rows) db.prepare("UPDATE reminders SET status='cancelled', updated_at=? WHERE id=?").run(now(), r.id);
  audit("reminders", "cancelled", { detail: `${rows.length} matched "${idOrMatch.slice(0, 80)}"` });
  return rows.length;
}

export function dueReminders(): Reminder[] {
  return db.prepare("SELECT * FROM reminders WHERE status='pending' AND due_at <= ?").all(now()) as any[];
}

/** Fire every due reminder. Returns how many fired. Called by the scheduler. */
export async function fireDueReminders(): Promise<number> {
  const due = dueReminders();
  let fired = 0;
  for (const r of due) {
    try {
      await deliver(r);
      db.prepare("UPDATE reminders SET status='fired', fired_at=?, updated_at=? WHERE id=?").run(now(), now(), r.id);
      fired++;
    } catch (e: any) {
      audit("reminders", "fire_failed", { target: r.id, detail: String(e?.message ?? e).slice(0, 200) });
    }
  }
  if (fired) audit("reminders", "fired_batch", { detail: `${fired} reminder(s) delivered` });
  return fired;
}

async function deliver(r: Reminder): Promise<void> {
  const text = `⏰ Reminder: ${r.content}`;

  // Sentinel: owner-only delivery — the recipient is locked in the vault and
  // the content is the reminder the owner asked for (same rationale as digest email).
  const verdict = guard({ action: "message.send_reminder", detail: `Deliver reminder: ${r.content.slice(0, 120)}` });
  if (verdict.decision === "deny") {
    audit("reminders", "blocked_by_sentinel", { target: r.id });
    return;
  }

  if (r.channel === "messaging") {
    const { telegramConfigured, whatsappConfigured, deliverTelegram, deliverWhatsApp } = await import(
      "./connectors/messaging"
    );
    // deliver* are the non-interactive senders: the Sentinel check above is
    // THE approval (owner-only recipient, owner-authored content).
    if (telegramConfigured()) {
      const out = await deliverTelegram(text);
      if (!/failed|error|not fully connected/i.test(out)) {
        audit("reminders", "fired", { target: r.id, detail: "via Telegram" });
        return;
      }
    } else if (whatsappConfigured()) {
      const out = await deliverWhatsApp(text);
      if (!/failed|error|not fully connected/i.test(out)) {
        audit("reminders", "fired", { target: r.id, detail: "via WhatsApp" });
        return;
      }
    }
    // No channel connected or delivery failed → fall back to chat so nothing is lost.
  }

  postAssistantMessage(r.conversation_id, `${text}\n(set for ${new Date(r.due_at).toLocaleString()})`);
  audit("reminders", "fired", { target: r.id, detail: "chat delivery" });
}

function postAssistantMessage(conversationId: string | null, content: string) {
  if (!conversationId) {
    audit("reminders", "delivered_no_chat", { detail: content.slice(0, 160) });
    return;
  }
  // The conversation may have been deleted since the reminder was set; the FK on
  // messages would reject the insert and the reminder would retry forever. Treat
  // a missing conversation as delivered (audit keeps the record).
  const conv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) {
    audit("reminders", "delivered_conv_missing", { detail: content.slice(0, 160) });
    return;
  }
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
  ).run(uuid(), conversationId, "assistant", content, JSON.stringify({ kind: "reminder" }), now());
}
