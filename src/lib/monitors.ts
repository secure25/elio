// ── Monitors: standing watches that run on a cadence ─────────────────────
// A monitor is a natural-language watch instruction ("watch this price page",
// "check if my refund arrived", "keep an eye on apartment listings"). The
// scheduler re-runs its prompt through the agent every N hours; the monitor
// prompt template instructs the agent to REPORT ONLY (no effectful actions),
// and change detection compares against the previous summary. "Come back when
// something changes" = the summary differs from the last one → the scheduler
// posts an update to the chat + shows in digests + Tasks page.
import { db, now, uuid, audit } from "./db";
import { guard } from "./sentinel";

export type Cadence = "hourly" | "every_6h" | "daily";

const CADENCE_MS: Record<Cadence, number> = {
  hourly: 60 * 60_000,
  every_6h: 6 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

export interface Monitor {
  id: string;
  prompt: string;
  description: string;
  cadence: Cadence;
  status: "active" | "paused";
  last_run: number | null;
  last_summary: string | null;
  last_change: string | null;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
}

export function createMonitor(opts: {
  prompt: string;
  cadence?: Cadence;
  conversationId?: string | null;
}): { ok: boolean; message: string; id?: string } {
  const prompt = opts.prompt.trim();
  if (prompt.length < 8) return { ok: false, message: "Describe what to watch in a sentence or more." };
  const cadence: Cadence = opts.cadence && CADENCE_MS[opts.cadence] ? opts.cadence : "daily";
  const id = uuid();
  const description = prompt.slice(0, 120);
  db.prepare(
    "INSERT INTO monitors (id, prompt, description, cadence, status, last_run, last_summary, last_change, conversation_id, created_at, updated_at) VALUES (?,?,?,?,'active',NULL,NULL,NULL,?,?,?)"
  ).run(id, prompt, description, cadence, opts.conversationId ?? null, now(), now());
  audit("monitors", "created", { detail: `${cadence} watch: ${description}`, risk: "low" });
  return {
    ok: true,
    message: `Watching: “${description}” (checks ${cadence.replace("_", " ")}). I'll report when something changes.`,
    id,
  };
}

export function listMonitors(status?: "active" | "paused"): Monitor[] {
  const rows = status
    ? db.prepare("SELECT * FROM monitors WHERE status = ? ORDER BY updated_at DESC").all(status)
    : db.prepare("SELECT * FROM monitors ORDER BY updated_at DESC").all();
  return rows as any[];
}

export function setMonitorStatus(id: string, status: "active" | "paused"): boolean {
  const r = db.prepare("UPDATE monitors SET status=?, updated_at=? WHERE id=?").run(status, now(), id);
  audit("monitors", status === "paused" ? "paused" : "resumed", { target: id });
  return r.changes > 0;
}

export function deleteMonitor(id: string): boolean {
  const r = db.prepare("DELETE FROM monitors WHERE id=?").run(id);
  audit("monitors", "deleted", { target: id });
  return r.changes > 0;
}

/** Monitors whose cadence interval has elapsed since last_run. */
export function dueMonitors(): Monitor[] {
  const active = listMonitors("active");
  const t = now();
  return active.filter((m) => !m.last_run || t - m.last_run >= CADENCE_MS[m.cadence]);
}

/**
 * Run one monitor: re-ask the watch prompt in REPORT-ONLY mode, compare with
 * the previous summary, and post an update to the chat when it changed.
 * Returns the fresh summary (or null when the run failed).
 */
export async function runMonitor(m: Monitor): Promise<string | null> {
  const verdict = guard({ action: "monitor.run", detail: `Scheduled watch check: ${m.description.slice(0, 120)}` });
  if (verdict.decision === "deny") return null;

  const { runAgent } = await import("./agent/loop");
  const watchPrompt =
    `You are performing a SCHEDULED MONITOR CHECK (report-only). Watch instruction: "${m.prompt}"\n` +
    `Use read-only tools (web_search, web_fetch, browser_goto, browser_read, gmail_list, gmail_read, ` +
    `calendar_list) to gather the current state. DO NOT send messages, create/delete calendar events, ` +
    `submit forms, or take any other effectful action.\n` +
    `End with a line "SUMMARY: <one or two sentences describing the current state>".`;

  let summary: string | null = null;
  try {
    const { finalText } = await runAgent(watchPrompt, {
      taskId: null,
      conversationId: "",
      maxSteps: 10,
    });
    if (finalText) {
      const match = finalText.match(/SUMMARY:\s*([\s\S]+)$/);
      summary = (match ? match[1] : finalText).trim().slice(0, 500);
    }
  } catch (e: any) {
    audit("monitors", "run_failed", { target: m.id, detail: String(e?.message ?? e).slice(0, 200) });
    db.prepare("UPDATE monitors SET last_run=?, updated_at=? WHERE id=?").run(now(), now(), m.id);
    return null;
  }

  const changed = summary !== null && m.last_summary !== null && summary !== m.last_summary;
  const first = summary !== null && m.last_summary === null;

  db.prepare(
    "UPDATE monitors SET last_run=?, last_summary=?, last_change=?, updated_at=? WHERE id=?"
  ).run(now(), summary, changed ? "changed" : m.last_change, now(), m.id);

  if (changed) {
    audit("monitors", "change_detected", { target: m.id, detail: (summary ?? "").slice(0, 200) });
    if (summary) notifyConversation(m, summary);
  } else if (first && summary) {
    // First run establishes the baseline silently (no chat spam).
    audit("monitors", "baseline_recorded", { target: m.id });
  }

  return summary;
}

function notifyConversation(m: Monitor, summary: string) {
  if (!m.conversation_id) return;
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
  ).run(
    uuid(),
    m.conversation_id,
    "assistant",
    `👁 Monitor update — “${m.description}”\n\n${summary}`,
    JSON.stringify({ kind: "monitor", monitorId: m.id }),
    now()
  );
}
