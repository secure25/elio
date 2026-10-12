// ── Sentinel: separate gatekeeper layer for all sensitive/effectful actions ──
// Modeled on the Muse reference design's Sentinel: a distinct module (never the agent itself)
// that decides allow / ask / deny for every effectful action, with a full
// audit trail and human approval for anything sensitive.
import { db, now, uuid, audit } from "./db";

export type Risk = "low" | "medium" | "high";
export type Decision = "allow" | "ask" | "deny";

export interface SentinelRequest {
  action: string; // e.g. "gmail.send", "calendar.create", "browser.goto", "payment.charge"
  detail: string; // human-readable description of exactly what will happen
  taskId?: string | null;
  conversationId?: string | null;
}

export interface SentinelVerdict {
  decision: Decision;
  risk: Risk;
  reason: string;
  approvalId?: string;
}

const RULES: {
  match: RegExp;
  risk: Risk;
  decision: Decision;
  reason: string;
}[] = [
  { match: /^payment\./, risk: "high", decision: "ask", reason: "Spending money always requires explicit human approval." },
  // MoltMoney financial actions (Phase 2A): reads are low-risk lookups;
  // anything that moves money through MoltMoney/PayPal always asks.
  { match: /^finance\.read$/, risk: "low", decision: "allow", reason: "Read-only financial lookups via MoltMoney." },
  { match: /^finance\.pay$/, risk: "high", decision: "ask", reason: "Spending money via MoltMoney/PayPal requires explicit human approval." },
  { match: /^gmail\.send$/, risk: "high", decision: "ask", reason: "Sending email on your behalf requires approval." },
  // Digest delivery: allow ONLY because (a) the user explicitly opted in via the Digest
  // page toggle, (b) the connector hard-restricts the recipient to the connected account
  // owner, and (c) this action is not exposed as an agent tool — the LLM can never invoke it.
  { match: /^gmail\.send_digest$/, risk: "medium", decision: "allow", reason: "Opted-in digest delivery to the account owner only." },
  { match: /^gmail\.delete/, risk: "high", decision: "deny", reason: "Permanent deletion of mail is not permitted." },
  { match: /^gmail\.(list|read|search)$/, risk: "low", decision: "allow", reason: "Read-only mail access (OTP filtering active)." },
  { match: /^calendar\.create$/, risk: "medium", decision: "ask", reason: "Creating events on your calendar requires approval." },
  { match: /^calendar\.delete$/, risk: "high", decision: "ask", reason: "Deleting events requires approval." },
  { match: /^calendar\.(list|read|freebusy)$/, risk: "low", decision: "allow", reason: "Read-only calendar access." },
  // Phone messaging (Telegram/WhatsApp): user-directed messages to owner's connected chat.
  // The _test variant is also allow-listed for owner's test ping.
  { match: /^message\.send$/, risk: "low", decision: "allow", reason: "Messaging to owner's connected accounts." },
  { match: /^message\.send_digest$/, risk: "medium", decision: "allow", reason: "Opted-in digest delivery to owner's channels." },
  { match: /^message\.send_test$/, risk: "low", decision: "allow", reason: "Test ping goes to the owner's own chat only." },
  // Reminder delivery: allow ONLY because (a) the recipient is locked to the owner's
  // connected chat in the vault, (b) the content is the reminder the owner themselves
  // asked for, and (c) scheduled delivery cannot block on a human (it would never fire).
  { match: /^message\.send_reminder$/, risk: "low", decision: "allow", reason: "Owner-requested reminder to the owner's own chat." },
  // Task-result delivery: allow ONLY because (a) the recipient is locked to the
  // owner's connected chat in the vault, (b) the content is Elio's own reply to
  // the owner's request, and (c) the owner can switch it off in Settings
  // (telegram_results_enabled, default ON). Not exposed as an agent tool — the
  // LLM can never invoke it directly.
  { match: /^message\.send_result$/, risk: "low", decision: "allow", reason: "Task result pushed to the owner's own chat (toggle-controlled)." },
  { match: /^browser\.goto$/, risk: "low", decision: "allow", reason: "Navigation is read-only until a form is submitted." },
  { match: /^browser\.read/, risk: "low", decision: "allow", reason: "Read-only page access." },
  { match: /^browser\.(fill|type)/, risk: "low", decision: "allow", reason: "Filling form fields is reversible until submit." },
  { match: /^browser\.click/, risk: "medium", decision: "allow", reason: "Clicks are allowed; destructive submit buttons are separately gated." },
  { match: /^browser\.submit/, risk: "high", decision: "ask", reason: "Submitting a web form can place orders or change accounts." },
  { match: /^browser\.download/, risk: "medium", decision: "allow", reason: "Downloads into the sandbox VM directory." },
  { match: /^(web\.)?(fetch|search)$/, risk: "low", decision: "allow", reason: "Public web reads." },
  { match: /^vault\.(store|delete)/, risk: "high", decision: "ask", reason: "Changing stored credentials requires approval." },
  { match: /^memory\.forget/, risk: "low", decision: "allow", reason: "You asked for it to be forgotten." },
  // Monitor checks are REPORT-ONLY by construction (the watch prompt forbids
  // effectful actions). Any effectful tool the check touches still hits its own
  // Sentinel rule, so this class stays safe to allow for unattended runs.
  { match: /^monitor\.run$/, risk: "low", decision: "allow", reason: "Scheduled watch checks are report-only." },
];

export function classify(action: string): { risk: Risk; decision: Decision; reason: string } {
  for (const rule of RULES) {
    if (rule.match.test(action)) return { risk: rule.risk, decision: rule.decision, reason: rule.reason };
  }
  // Unknown effectful actions default to ask — fail closed.
  return { risk: "medium", decision: "ask", reason: "Unknown action class; defaulting to human approval." };
}

/** Ask the Sentinel for a verdict. Creates a pending approval row when needed. */
export function guard(req: SentinelRequest): SentinelVerdict {
  const { risk, decision, reason } = classify(req.action);
  audit("sentinel", `guard.${req.action}`, {
    target: req.detail.slice(0, 200),
    detail: `decision=${decision}`,
    risk,
  });
  if (decision !== "ask") return { decision, risk, reason };

  const id = uuid();
  db.prepare(
    "INSERT INTO approvals (id, task_id, conversation_id, action, detail, risk, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)"
  ).run(id, req.taskId ?? null, req.conversationId ?? null, req.action, req.detail, risk, now());
  audit("sentinel", "approval.requested", { target: req.action, detail: req.detail.slice(0, 500), risk });
  // Push the approval to the owner's connected Telegram chat (async, never
  // blocks or fails the action itself). Skipped safely when Telegram is not
  // connected.
  void import("./approvals-notify")
    .then((m) => m.notifyApprovalCreated(id, req.action, req.detail, risk))
    .catch(() => {});
  return { decision: "ask", risk, reason, approvalId: id };
}

/** Block until the human resolves a pending approval (polls; used inside the agent loop). */
export async function waitForApproval(
  approvalId: string,
  opts: { timeoutMs?: number; onStatus?: (status: string) => void } = {}
): Promise<"approved" | "denied" | "timeout"> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId) as
      | { status: string }
      | undefined;
    if (!row) return "timeout";
    if (row.status === "approved") return "approved";
    if (row.status === "denied") return "denied";
    opts.onStatus?.(row.status);
    await new Promise((r) => setTimeout(r, 1500));
  }
  db.prepare("UPDATE approvals SET status='expired', resolved_at=? WHERE id=? AND status='pending'").run(
    now(),
    approvalId
  );
  return "timeout";
}

export function resolveApproval(id: string, approve: boolean) {
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
    | { action: string; detail: string; risk: string; status: string }
    | undefined;
  if (!row || row.status !== "pending") return null;
  db.prepare("UPDATE approvals SET status=?, resolved_at=? WHERE id=?").run(
    approve ? "approved" : "denied",
    now(),
    id
  );
  audit("human", approve ? "approval.granted" : "approval.denied", {
    target: row.action,
    detail: row.detail.slice(0, 500),
    risk: row.risk,
  });
  return { ...row, status: approve ? "approved" : "denied" };
}

export function listApprovals(status?: string) {
  const sql = status
    ? "SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 100"
    : "SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100";
  return status ? db.prepare(sql).all(status) : db.prepare(sql).all();
}
