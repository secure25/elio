// ── Deterministic digest-reply commands ───────────────────────────────────
// Common replies are handled without the LLM: faster, free, and always works
// even with no API key configured. Anything else falls through to the agent.
import { db, audit } from "./db";
import { retryTask } from "./agent/runner";
import { resolveApproval, listApprovals } from "./sentinel";
import { markDigestRead } from "./digest";

export interface CommandResult {
  handled: boolean;
  reply: string;
  newTaskId?: string;
}

function latestUnreadDigestId(): string | null {
  const row = db
    .prepare("SELECT id FROM digests WHERE read = 0 ORDER BY ts DESC LIMIT 1")
    .get() as any;
  return row?.id ?? null;
}

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/^["'`]+|["'`!.,]+$/g, "");
}

/** Try to interpret a user message as a digest-reply command. Returns null when not a command. */
export function tryHandleDigestReply(text: string, conversationId: string): CommandResult | null {
  const t = normalize(text);

  // 1) Retry failed tasks: "retry the failed one", "retry failed tasks", "run it again"
  const isRetry =
    /^retry( the)? failed (one|task|goal|job)s?$/.test(t) ||
    /^(please )?retry (the )?failed/.test(t) ||
    /^retry (it|that|them|all failed)$/.test(t) ||
    /^(run|try) (it|that|the failed one) again$/.test(t);
  if (isRetry) {
    const failed = db
      .prepare(
        "SELECT id, goal FROM tasks WHERE status='failed' ORDER BY updated_at DESC LIMIT 5"
      )
      .all() as any[];
    if (!failed.length) {
      return {
        handled: true,
        reply:
          "There are no failed tasks to retry — everything is in a good state. Want me to take on something new?",
      };
    }
    const retried: string[] = [];
    let lastId: string | undefined;
    for (const f of failed) {
      try {
        lastId = retryTask(f.id, conversationId);
        retried.push(f.goal.length > 60 ? f.goal.slice(0, 60) + "…" : f.goal);
      } catch {
        /* keep retrying the rest */
      }
    }
    const digestId = latestUnreadDigestId();
    if (digestId) markDigestRead(digestId);
    audit("digest", "command.retry_failed", { detail: `${retried.length} task(s)`, risk: "low" });
    return {
      handled: true,
      newTaskId: lastId,
      reply:
        `Restarted ${retried.length} failed task${retried.length === 1 ? "" : "s"}:\n` +
        retried.map((g) => `- ${g}`).join("\n") +
        `\n\nThey're running in the background now — I'll report back here and in tomorrow's digest.`,
    };
  }

  // 2) Approve pending actions — ONLY explicit command shapes. Bare "yes"/"ok" must
  // fall through to the agent (it may be answering the agent's own question, and a
  // casual reply must never blanket-approve Sentinel-gated actions).
  const isApproveAll =
    /^(approve|accept|allow|confirm)( all( of( them)?)?| everything| them all)$/.test(t) ||
    /^approve (all )?(the )?pending( approvals| actions)?$/.test(t) ||
    /^(approve|confirm) (them|it) all$/.test(t);
  if (isApproveAll) {
    const pending = listApprovals("pending") as any[];
    if (!pending.length) {
      return { handled: true, reply: "Nothing is waiting for approval right now." };
    }
    const approved: string[] = [];
    for (const p of pending) {
      if (resolveApproval(p.id, true)) {
        approved.push(`${p.action} — ${String(p.detail).slice(0, 80)}`);
      }
    }
    const digestId = latestUnreadDigestId();
    if (digestId) markDigestRead(digestId);
    audit("digest", "command.approve_all", {
      detail: `${approved.length} approval(s)`,
      risk: "medium",
    });
    return {
      handled: true,
      reply:
        `Approved ${approved.length} pending action${approved.length === 1 ? "" : "s"}:\n` +
        approved.map((a) => `- ${a}`).join("\n") +
        `\n\nAny tasks that were blocked will continue now.`,
    };
  }

  // 3) Status: "what's next", "status"
  const isWhatsNext =
    /^(what'?s next|what should i do next|status|what'?s the status|anything waiting)$/.test(t);
  if (isWhatsNext) {
    const pending = listApprovals("pending") as any[];
    const running = db
      .prepare(
        "SELECT goal, status FROM tasks WHERE status IN ('running','pending','waiting_approval') ORDER BY updated_at DESC LIMIT 5"
      )
      .all() as any[];
    const failed = db
      .prepare("SELECT goal FROM tasks WHERE status='failed' ORDER BY updated_at DESC LIMIT 5")
      .all() as any[];
    const lines: string[] = [];
    if (pending.length) {
      lines.push(`**Waiting on you (${pending.length}):**`);
      for (const p of pending)
        lines.push(
          `- ${p.action} — ${String(p.detail).slice(0, 80)} _(on the Approvals page, or say "approve all")_`
        );
    }
    if (running.length) {
      lines.push(`**In progress:**`);
      for (const r of running) lines.push(`- ${r.goal} _(${r.status})_`);
    }
    if (failed.length) {
      lines.push(`**Failed (say "retry the failed one" to restart):**`);
      for (const f of failed) lines.push(`- ${f.goal}`);
    }
    if (!lines.length) {
      lines.push("All clear — no pending approvals, running tasks, or failures. Give me a new goal any time.");
    }
    return { handled: true, reply: lines.join("\n") };
  }

  // 4) Re-show the digest: "show the digest"
  const isShowDigest =
    /^(show|open|summarize|summarise)( the| my)? (digest|morning digest|report)$/.test(t) ||
    /^(digest|morning report)$/.test(t);
  if (isShowDigest) {
    const row = db
      .prepare("SELECT id, ts, body FROM digests ORDER BY ts DESC LIMIT 1")
      .get() as any;
    if (!row) {
      return {
        handled: true,
        reply:
          "No digest has been generated yet. I write one every morning — or generate a preview from the Digest page.",
      };
    }
    const digestId = latestUnreadDigestId();
    if (digestId) markDigestRead(digestId);
    return {
      handled: true,
      reply: `Here's your latest digest (from ${new Date(row.ts).toLocaleString()}):\n\n${row.body}`,
    };
  }

  return null; // not a known command → the agent handles it
}
