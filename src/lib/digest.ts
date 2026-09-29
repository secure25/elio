// ── Proactive daily digest ──────────────────────────────────
// Each morning (configurable hour) the agent summarizes background goal
// progress and suggests next actions. Runs in-process via the scheduler;
// composes via the LLM when available, with a deterministic fallback so a
// digest always exists even without an API key.
import { db, now, uuid, audit, getSetting, setSetting } from "./db";
import { redact } from "./vault";

export interface Digest {
  id: string;
  ts: number;
  kind: string;
  body: string;
  read: number;
  meta: string | null;
}

export function digestConfig(): {
  hour: number;
  eveningHour: number;
  enabled: boolean;
  emailEnabled: boolean;
  telegramEnabled: boolean;
} {
  const hour = Number(getSetting("digest_hour") ?? "9");
  const eveningHour = Number(getSetting("digest_evening_hour") ?? "21");
  const enabled = (getSetting("digest_enabled") ?? "true") === "true";
  const emailEnabled = (getSetting("digest_email_enabled") ?? "false") === "true";
  const telegramEnabled = (getSetting("digest_telegram_enabled") ?? "true") === "true";
  return {
    hour: Number.isFinite(hour) ? hour : 9,
    eveningHour: Number.isFinite(eveningHour) ? eveningHour : 21,
    enabled,
    emailEnabled,
    telegramEnabled,
  };
}

export function setDigestConfig(opts: {
  hour?: number;
  eveningHour?: number;
  enabled?: boolean;
  emailEnabled?: boolean;
  telegramEnabled?: boolean;
}) {
  if (typeof opts.hour === "number" && opts.hour >= 0 && opts.hour <= 23) {
    setSetting("digest_hour", String(Math.floor(opts.hour)));
  }
  if (typeof opts.eveningHour === "number" && opts.eveningHour >= 0 && opts.eveningHour <= 23) {
    setSetting("digest_evening_hour", String(Math.floor(opts.eveningHour)));
  }
  if (typeof opts.enabled === "boolean") {
    setSetting("digest_enabled", opts.enabled ? "true" : "false");
  }
  if (typeof opts.emailEnabled === "boolean") {
    setSetting("digest_email_enabled", opts.emailEnabled ? "true" : "false");
    audit("digest", "email.optin", {
      detail: opts.emailEnabled ? "opted in" : "opted out",
      risk: "medium",
    });
  }
  if (typeof opts.telegramEnabled === "boolean") {
    setSetting("digest_telegram_enabled", opts.telegramEnabled ? "true" : "false");
    audit("digest", "telegram.optin", {
      detail: opts.telegramEnabled ? "opted in" : "opted out",
      risk: "medium",
    });
  }
}

/** Has today's scheduled digest already been produced? */
export function isDue(kind: "morning" | "evening" = "morning"): boolean {
  const { enabled, hour, eveningHour } = digestConfig();
  if (!enabled) return false;
  const targetHour = kind === "morning" ? hour : eveningHour;
  const d = new Date();
  d.setHours(targetHour, 0, 0, 0);
  const dueAt = d.getTime();
  if (Date.now() < dueAt) return false;
  const last = db
    .prepare("SELECT MAX(ts) AS maxTs FROM digests WHERE kind = ?")
    .get(kind) as { maxTs: number | null };
  return !last.maxTs || last.maxTs < dueAt;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString();
}

function days(n: number) {
  return n * 864e5;
}

interface Gathered {
  activeTasks: { goal: string; status: string; created_at: number; updated_at: number }[];
  waitingTasks: { goal: string; status: string; created_at: number }[];
  doneYesterday: { goal: string; updated_at: number }[];
  failed: { goal: string; last_error: string | null; updated_at: number }[];
  pendingApprovals: { id: string; action: string; detail: string; created_at: number }[];
  recentMemories: { content: string; category: string }[];
  upcomingEvents: { summary: string; start: string }[];
  unreadMail: number | null;
  auditCount: number;
  llmConfigured: boolean;
  upcomingReminders: { content: string; due_at: number; channel: string }[];
  activeMonitors: { description: string; cadence: string; last_summary: string | null }[];
}

async function gather(): Promise<Gathered> {
  const dayAgo = now() - days(1);
  const threeDaysAgo = now() - days(3);

  const activeTasks = db
    .prepare(
      "SELECT goal, status, created_at, updated_at FROM tasks WHERE status IN ('pending','running') AND created_at > ? ORDER BY updated_at DESC LIMIT 10"
    )
    .all(threeDaysAgo) as any[];
  const waitingTasks = db
    .prepare(
      "SELECT goal, status, created_at FROM tasks WHERE status = 'waiting_approval' ORDER BY created_at DESC LIMIT 5"
    )
    .all() as any[];
  const doneYesterday = db
    .prepare(
      "SELECT goal, updated_at FROM tasks WHERE status = 'done' AND updated_at > ? ORDER BY updated_at DESC LIMIT 10"
    )
    .all(dayAgo) as any[];
  const failed = db
    .prepare(
      "SELECT goal, last_error, updated_at FROM tasks WHERE status = 'failed' AND updated_at > ? ORDER BY updated_at DESC LIMIT 5"
    )
    .all(threeDaysAgo) as any[];
  const pendingApprovals = db
    .prepare(
      "SELECT id, action, detail, created_at FROM approvals WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10"
    )
    .all() as any[];
  const recentMemories = db
    .prepare("SELECT content, category FROM memories ORDER BY updated_at DESC LIMIT 8")
    .all() as any[];
  const auditRow = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE ts > ?").get(dayAgo) as {
    c: number;
  };

  // Optional live connectors (fail soft when not connected)
  let upcomingEvents: { summary: string; start: string }[] = [];
  try {
    const { calendarList } = await import("./connectors/gcal");
    const list = await calendarList(null);
    upcomingEvents = list
      .split("\n")
      .slice(0, 5)
      .map((line) => {
        const [start, , summary] = line.split("|").map((s) => s.trim());
        return { start: start || "", summary: summary || "" };
      })
      .filter((e) => e.summary);
  } catch {
    /* calendar not connected */
  }

  let unreadMail: number | null = null;
  try {
    const { gmailList } = await import("./connectors/gmail");
    const list = await gmailList(null, { query: "is:unread", max: 5 });
    const ids = list.split("\n").filter((l) => l.startsWith("id:"));
    unreadMail = ids.length; // capped at 5 by the query; >=5 means "5 or more"
  } catch {
    /* gmail not connected */
  }

  // Reminders + standing monitors (fail soft)
  let upcomingReminders: { content: string; due_at: number; channel: string }[] = [];
  let activeMonitors: { description: string; cadence: string; last_summary: string | null }[] = [];
  try {
    const { listReminders } = await import("./reminders");
    const { listMonitors } = await import("./monitors");
    upcomingReminders = (listReminders(false) as any[]).slice(0, 5).map((r) => ({
      content: r.content,
      due_at: r.due_at,
      channel: r.channel,
    }));
    activeMonitors = (listMonitors("active") as any[]).slice(0, 5).map((m) => ({
      description: m.description,
      cadence: m.cadence,
      last_summary: m.last_summary ?? null,
    }));
  } catch {
    /* tables not migrated yet */
  }

  return {
    activeTasks,
    waitingTasks,
    doneYesterday,
    failed,
    pendingApprovals,
    recentMemories,
    upcomingEvents,
    unreadMail,
    auditCount: auditRow?.c ?? 0,
    upcomingReminders,
    activeMonitors,
    llmConfigured: Boolean(
      process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY
    ),
  };
}

function fallbackBody(g: Gathered, kind: "morning" | "evening" = "morning"): string {
  const greeting = kind === "morning" ? "Good morning" : "Good evening";
  const lines: string[] = [`## ${greeting} — your Elio digest`, ``];
  lines.push(`### Background goals`);
  if (g.doneYesterday.length) {
    lines.push(`**Completed recently:**`);
    for (const t of g.doneYesterday) lines.push(`- ${t.goal} _(finished ${fmtTime(t.updated_at)})_`);
  } else {
    lines.push(`_No completed tasks in the last 24h._`);
  }
  if (g.activeTasks.length) {
    lines.push(`**Still in progress:**`);
    for (const t of g.activeTasks) lines.push(`- ${t.goal} _(status: ${t.status})_`);
  }
  if (g.failed.length) {
    lines.push(`**Needs attention:**`);
    for (const t of g.failed)
      lines.push(`- ${t.goal} — failed: ${t.last_error ? redact(t.last_error).slice(0, 140) : "unknown"}`);
  }
  if (!g.doneYesterday.length && !g.activeTasks.length && !g.failed.length) {
    lines.push(`_No goals running yet. Give Elio something to work on in the chat._`);
  }

  lines.push(``, `### Approvals waiting on you`);
  if (g.pendingApprovals.length) {
    for (const a of g.pendingApprovals)
      lines.push(`- **${a.action}** — ${a.detail} _(waiting since ${fmtTime(a.created_at)})_`);
    lines.push(``, `Open the **Approvals** page to review them.`);
  } else {
    lines.push(`_Nothing pending — clean slate._`);
  }

  if (g.upcomingEvents.length) {
    lines.push(``, `### Next calendar events`);
    for (const e of g.upcomingEvents) lines.push(`- ${e.start} — ${e.summary}`);
  }
  if (g.unreadMail !== null) {
    lines.push(``, `### Inbox`);
    lines.push(`- ${g.unreadMail}${g.unreadMail >= 5 ? "+" : ""} unread message${g.unreadMail === 1 ? "" : "s"}`);
  }

  if (g.upcomingReminders.length) {
    lines.push(``, `### Upcoming reminders`);
    for (const r of g.upcomingReminders) lines.push(`- ${r.content} _(due ${fmtTime(r.due_at)}${r.channel === "messaging" ? ", phone ping" : ""})_`);
  }
  if (g.activeMonitors.length) {
    lines.push(``, `### Standing watches`);
    for (const m of g.activeMonitors) {
      lines.push(`- ${m.description} _(checks ${m.cadence.replace("_", " ")})_`);
      if (m.last_summary) lines.push(`  - Latest: ${m.last_summary}`);
    }
  }

  lines.push(``, `### Suggested next actions`);
  const suggestions: string[] = [];
  if (g.pendingApprovals.length)
    suggestions.push(`Review the ${g.pendingApprovals.length} pending approval(s) so blocked goals can continue.`);
  for (const t of g.failed) suggestions.push(`Retry the failed task: "${t.goal.slice(0, 60)}".`);
  if (!g.llmConfigured)
    suggestions.push(`Add a free LLM API key in .env (e.g. GEMINI_API_KEY) so Elio can act, not just report.`);
  if (!g.activeTasks.length && !g.doneYesterday.length)
    suggestions.push(`Start a background goal — e.g. "watch flights AUS→JFK and email me when under $250".`);
  if (!suggestions.length) suggestions.push(`All quiet. Ask Elio to take on something new.`);
  for (const s of suggestions) lines.push(`- ${s}`);

  return lines.join("\n");
}

async function composeWithLlm(g: Gathered, kind: "morning" | "evening" = "morning"): Promise<string | null> {
  if (!g.llmConfigured) return null;
  try {
    const { getAdapter } = await import("./llm");
    const adapter = getAdapter();
    const facts = [
      `Completed tasks (24h): ${JSON.stringify(g.doneYesterday)}`,
      `In-progress tasks: ${JSON.stringify(g.activeTasks)}`,
      `Failed tasks (72h): ${JSON.stringify(g.failed)}`,
      `Pending approvals: ${JSON.stringify(g.pendingApprovals)}`,
      `Upcoming calendar events: ${JSON.stringify(g.upcomingEvents)}`,
      `Unread mail count: ${g.unreadMail ?? "unknown (gmail not connected)"}`,
      `Recent memories: ${JSON.stringify(g.recentMemories)}`,
      `Agent audit events (24h): ${g.auditCount}`,
      `Upcoming reminders: ${JSON.stringify(g.upcomingReminders)}`,
      `Standing monitors: ${JSON.stringify(g.activeMonitors)}`,
    ].join("\n");
    const greeting = kind === "morning" ? "morning" : "evening";
    const res = await adapter.complete(
      [
        {
          role: "system",
          content:
            `You are Elio, writing the user's ${greeting} digest. Summarize background goal progress ` +
            `and suggest 2-4 concrete next actions. Be warm, concise, and specific; reference ` +
            `actual task names. Use markdown with short sections. Never invent facts not in the data.`,
        },
        { role: "user", content: `Today is ${new Date().toDateString()}.\n\n${facts}` },
      ],
      { temperature: 0.5, maxTokens: 700 }
    );
    const text = res.text.trim();
    return text.length > 40 ? text : null;
  } catch {
    return null;
  }
}

/** Produce today's digest of the given kind (idempotent per day). Returns the digest row. */
export async function runDigest(kind: "morning" | "evening" = "morning", force = false): Promise<Digest> {
  if (!force && !isDue(kind)) {
    const last = db
      .prepare("SELECT * FROM digests WHERE kind = ? ORDER BY ts DESC LIMIT 1")
      .get(kind) as unknown as Digest | undefined;
    if (last) return last;
  }
  const g = await gather();
  const body = (await composeWithLlm(g, kind)) ?? fallbackBody(g, kind);
  const { emailEnabled, telegramEnabled } = digestConfig();
  let emailStatus: string | null = null;
  let telegramStatus: string | null = null;

  // Unattended email delivery — only when the user explicitly opted in.
  // Deliberately skipped for forced/manual preview runs (force = true).
  if (emailEnabled && !force) {
    emailStatus = await emailDigest(body);
  }

  // Telegram delivery — on by default (user can toggle off).
  if (telegramEnabled && !force) {
    telegramStatus = await telegramDigest(body, kind);
  }

  const id = uuid();
  db.prepare("INSERT INTO digests (id, ts, kind, body, read, meta) VALUES (?,?,?,?,0,?)").run(
    id,
    now(),
    kind,
    body,
    JSON.stringify({
      source: g.llmConfigured ? "llm" : "fallback",
      ...(emailStatus ? { email: emailStatus } : {}),
      ...(telegramStatus ? { telegram: telegramStatus } : {}),
    })
  );
  audit("digest", `${kind}.generated`, {
    detail: `${body.length} chars (source=${g.llmConfigured ? "llm" : "fallback"}${emailStatus ? ", email=" + emailStatus : ""}${telegramStatus ? ", telegram=" + telegramStatus : ""})`,
  });
  return db.prepare("SELECT * FROM digests WHERE id = ?").get(id) as unknown as Digest;
}

/** Backward-compatible alias — calls runDigest("morning", force). */
export async function runMorningDigest(force = false): Promise<Digest> {
  return runDigest("morning", force);
}

/**
 * Email the digest to the connected account owner via the Gmail connector.
 * Returns a status string: "sent" | "not_connected" | "failed: ...".
 */
export async function emailDigest(body: string): Promise<string> {
  try {
    const { gmailSendDigest } = await import("./connectors/gmail");
    const subject = `Elio morning digest — ${new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })}`;
    return await gmailSendDigest(subject, body);
  } catch (e: any) {
    audit("digest", "email.failed", { detail: String(e.message).slice(0, 200), risk: "low" });
    return `failed: ${String(e.message).slice(0, 120)}`;
  }
}

/**
 * Push the digest to Telegram via the bot.
 * Returns a status string: "sent" | "not_connected" | "failed: ...".
 */
export async function telegramDigest(body: string, kind: "morning" | "evening" = "morning"): Promise<string> {
  try {
    const { deliverTelegram, telegramConfigured } = await import("./connectors/messaging");
    if (!telegramConfigured()) return "not_connected";
    const { guard } = await import("./sentinel");
    const verdict = guard({
      action: "message.send_digest",
      detail: `Deliver ${kind} digest to the owner's Telegram`,
    });
    if (verdict.decision === "deny") return `blocked: ${verdict.reason}`;
    const greeting = kind === "morning" ? "☀️ Good morning" : "🌙 Good evening";
    const header = `${greeting} — here's your Elio digest:\n\n`;
    const result = await deliverTelegram(header + body);
    return result.startsWith("Sent") ? "sent" : result;
  } catch (e: any) {
    audit("digest", "telegram.failed", { detail: String(e.message).slice(0, 200), risk: "low" });
    return `failed: ${String(e.message).slice(0, 120)}`;
  }
}

export function listDigests(limit = 30): Digest[] {
  return db
    .prepare("SELECT * FROM digests ORDER BY ts DESC LIMIT ?")
    .all(limit) as unknown as Digest[];
}

export function markDigestRead(id: string) {
  db.prepare("UPDATE digests SET read = 1 WHERE id = ?").run(id);
}

export function unreadDigestCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM digests WHERE read = 0").get() as { c: number };
  return row.c;
}

/** Compact digest context for the agent: lets it act on digest replies with real ids. */
export function digestContext(): string {
  const latest = db
    .prepare("SELECT id, ts, body FROM digests ORDER BY ts DESC LIMIT 1")
    .get() as any;
  if (!latest) return "";
  const failed = db
    .prepare("SELECT id, goal, last_error FROM tasks WHERE status='failed' ORDER BY updated_at DESC LIMIT 5")
    .all() as any[];
  const pending = db
    .prepare("SELECT id, action, detail FROM approvals WHERE status='pending' ORDER BY created_at DESC LIMIT 10")
    .all() as any[];
  const lines = [
    `\n\n## Latest digest (for acting on user replies to it)`,
    `- Digest id: ${latest.id} (from ${new Date(latest.ts).toLocaleString()})`,
  ];
  if (failed.length) {
    lines.push(`- Failed tasks the user may ask to retry:`);
    for (const f of failed) lines.push(`  - id=${f.id} goal="${f.goal.slice(0, 80)}"`);
  }
  if (pending.length) {
    lines.push(`- Pending approvals (resolve on the Approvals page; you cannot self-approve):`);
    for (const p of pending) lines.push(`  - ${p.action} — ${String(p.detail).slice(0, 80)}`);
  }
  return lines.join("\n");
}
