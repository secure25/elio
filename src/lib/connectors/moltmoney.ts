// ── MoltMoney connector (Phase 1 read-only + Phase 2A money movement) ────
// Thin authenticated client for the MoltMoney Agent Banking API.
//
// Scope:
//   Phase 1 (read-only): account / balance / transactions.
//   Option A (read-only): spending-policy view re-reads GET /accounts/{id} and
//   formats the rules — fail-closed; daily usage is NOT computed here.
//   Phase 2A (money-moving, Sentinel-gated): PayPal checkout via MoltMoney —
//   create order → (user approves on PayPal) → capture. Elio NEVER touches
//   PayPal credentials, card data, or webhooks: MoltMoney owns all PayPal
//   integration, transaction state, spending rules and idempotency.
//
// Endpoints (confirmed against the live sandbox API 2026-10-05 and the
// MoltMoney source inspection):
//   GET  /accounts/{accountId}                     → account object
//   GET  /accounts/{accountId}/balance             → balance object
//   GET  /transactions?accountId={id}&pageSize=N   → { data[], total, page, pageSize, hasMore }
//   GET  /transactions/{id}                        → single transaction
//   POST /payments/paypal/orders                   → { transaction, orderId, approvalUrl, state }
//   POST /payments/paypal/orders/{orderId}/capture → { transaction } (idempotent)
//   POST /payments/send                            → { transaction } (internal transfer)
//   GET  /cards                                    → { cards[] } (masked, no CVV)
//   POST /payments/payout                          → { transaction } (external bank payout)
//   POST /payments/request                         → PaymentRequest (fund request to owner)
//   GET  /payments/requests?status=N               → { data[] } (requester + recipient view)
//   POST /payments/request/{id}/pay                → { request, transaction }
//
// Owner-vs-agent auth model (confirmed against MoltMoney routes 2026-10-11):
// card issuing/freeze/cancel and fund-request APPROVAL are owner-token only —
// deliberately NOT exposed to Elio (agent keys are rejected there).
//
// Configuration (all required, all server-side):
//   MOLTMONEY_API_URL      e.g. https://<host> (no trailing slash needed)
//   MOLTMONEY_API_KEY      agent-scoped bearer token (NEVER exposed to the client)
//   MOLTMONEY_ACCOUNT_ID   the AGENT account id (the key is account-scoped; the
//                          API has no usable list endpoint for agent tokens, so
//                          the id comes from configuration, never from the LLM)
//
// Failure model: fail closed. Every failure — missing config, network error,
// timeout, auth rejection, unexpected body — returns a clear string result for
// the model. Nothing here throws into the agent loop. NO RETRIES on any
// money-moving call: MoltMoney's create-order endpoint has no client
// idempotency key, so a blind retry could mint a second pending transaction.
// The API key is scrubbed from any message that could reach the model or logs.
import { audit } from "../db";
import { guard, waitForApproval } from "../sentinel";
import type { ToolContext } from "../agent/tools";

const TIMEOUT_MS = 10_000;

interface MoltMoneyConfig {
  baseUrl: string;
  apiKey: string;
  accountId: string;
}

/** True when every required env var is present (kill switch: MOLTMONEY_ENABLED=false). */
export function moltmoneyConfigured(): boolean {
  if ((process.env.MOLTMONEY_ENABLED || "").trim().toLowerCase() === "false") return false;
  return Boolean(
    (process.env.MOLTMONEY_API_URL || "").trim() &&
      (process.env.MOLTMONEY_API_KEY || "").trim() &&
      (process.env.MOLTMONEY_ACCOUNT_ID || "").trim()
  );
}

function config(): MoltMoneyConfig | null {
  const baseUrl = (process.env.MOLTMONEY_API_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.MOLTMONEY_API_KEY || "").trim();
  const accountId = (process.env.MOLTMONEY_ACCOUNT_ID || "").trim();
  if (!baseUrl || !apiKey || !accountId) return null;
  return { baseUrl, apiKey, accountId };
}

/** Scrub the API key out of any text that could reach the model, steps or logs. */
function sanitize(text: string, apiKey: string): string {
  let out = text;
  if (apiKey) out = out.split(apiKey).join("[redacted]");
  return out.slice(0, 400);
}

type MmResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Authenticated GET. Never throws; never retries (reads are cheap to re-ask,
 * and blind retries are exactly what we must never do to money endpoints).
 */
async function mmGet(path: string, query?: Record<string, string | number>): Promise<MmResult<any>> {
  const cfg = config();
  if (!cfg) {
    return {
      ok: false,
      error:
        "MoltMoney is not configured (set MOLTMONEY_API_URL, MOLTMONEY_API_KEY and MOLTMONEY_ACCOUNT_ID).",
    };
  }
  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && `${v}` !== "") url.searchParams.set(k, `${v}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body handled below */
    }
    if (!res.ok) {
      // MoltMoney uses two error shapes: {error:{code,message,timestamp}} and
      // {message,error,statusCode} — handle both, plus non-JSON fallbacks.
      const msg =
        body?.error?.message ||
        body?.message ||
        body?.error?.code ||
        (typeof body?.error === "string" ? body.error : "") ||
        text.slice(0, 200) ||
        `HTTP ${res.status}`;
      return { ok: false, error: sanitize(`MoltMoney ${res.status}: ${msg}`, cfg.apiKey) };
    }
    if (body === null || typeof body !== "object") {
      return { ok: false, error: sanitize("MoltMoney returned an unexpected (non-JSON) response.", cfg.apiKey) };
    }
    return { ok: true, data: body };
  } catch (e: any) {
    const reason = e?.name === "AbortError" ? `timed out after ${TIMEOUT_MS / 1000}s` : String(e?.message || e);
    return { ok: false, error: sanitize(`MoltMoney unreachable (${reason}).`, cfg.apiKey) };
  } finally {
    clearTimeout(timer);
  }
}

function fail(err: string, what: string): string {
  audit("moltmoney", `finance.read.${what}`, { detail: err, risk: "low" });
  return err;
}

/** GET /accounts/{accountId} — the connected AGENT account. */
export async function moltmoneyGetAccount(): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "account");
  const r = await mmGet(`/accounts/${cfg.accountId}`);
  if (!r.ok) return fail(r.error, "account");
  const a = r.data;
  audit("moltmoney", "finance.read.account", { target: a.id, detail: `status=${a.status}`, risk: "low" });
  return [
    `MoltMoney account ${a.id}`,
    `type: ${a.type} | status: ${a.status} | currency: ${a.currency}`,
    `balance: ${a.balance} ${a.currency}`,
    a.accountNumber ? `account number: ${a.accountNumber}` : "",
    a.spendingRules ? `spending rules: ${JSON.stringify(a.spendingRules)}` : "spending rules: none",
  ]
    .filter(Boolean)
    .join("\n");
}

/** GET /accounts/{accountId}/balance — decimal-safe string amounts. */
export async function moltmoneyGetBalance(): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "balance");
  const r = await mmGet(`/accounts/${cfg.accountId}/balance`);
  if (!r.ok) return fail(r.error, "balance");
  const b = r.data;
  audit("moltmoney", "finance.read.balance", { target: b.accountId, detail: `${b.balance} ${b.currency}`, risk: "low" });
  return `MoltMoney balance: ${b.balance} ${b.currency} (account status: ${b.status}).`;
}

/** GET /transactions?accountId=…&pageSize=… — read-only history. */
export async function moltmoneyGetTransactions(limit?: number): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "transactions");
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
  const r = await mmGet("/transactions", { accountId: cfg.accountId, pageSize });
  if (!r.ok) return fail(r.error, "transactions");
  const rows: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
  audit("moltmoney", "finance.read.transactions", { detail: `${rows.length}/${r.data?.total ?? 0}`, risk: "low" });
  if (!rows.length) return "No MoltMoney transactions yet.";
  const lines = rows.slice(0, pageSize).map((t) => {
    const dir = t.direction || t.type || "";
    const amt = t.amount !== undefined ? `${t.amount} ${t.currency ?? ""}` : "";
    return [
      t.id ?? t.transactionId ?? "?",
      [dir, amt].filter(Boolean).join(" "),
      t.status ?? "",
      t.createdAt ?? t.created_at ?? "",
      t.description ?? t.memo ?? "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
  const more = r.data?.hasMore ? ` (showing ${lines.length} of ${r.data.total})` : "";
  return [`MoltMoney transactions${more}:`, ...lines].join("\n");
}

/**
 * GET /accounts/{accountId}/spending-policy — authoritative policy view
 * (Option B, read-only). Rules AND server-computed daily usage
 * (spentToday/remainingToday/serverTime) come from MoltMoney — the single
 * source of truth; Elio never derives authoritative usage itself and never
 * hardcodes limits. Deliberately OUTSIDE the finance.pay approval gate: no
 * guard() call, nothing created, nothing charged.
 *
 * Falls back to GET /accounts/{id} (no server-computed daily usage) only if
 * the dedicated endpoint does not exist yet (404).
 *
 * Fail-closed: if the policy cannot be retrieved or parsed, the result must
 * NOT imply that spending is permitted.
 */
export async function moltmoneyGetSpendingRules(): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "spending_rules");
  const p = await mmGet(`/accounts/${cfg.accountId}/spending-policy`);
  let r: MmResult<any>;
  let viaPolicyEndpoint = false;
  if (p.ok && p.data && typeof p.data === "object" && !Array.isArray(p.data) && "rules" in p.data) {
    r = p;
    viaPolicyEndpoint = true;
  } else if (p.ok) {
    return fail(
      "POLICY UNAVAILABLE: MoltMoney returned an unparseable spending-policy payload. " +
        "Do NOT assume spending is permitted — treat ALL spending as requiring explicit human approval before proceeding.",
      "spending_rules"
    );
  } else if (/\b404\b/.test(p.error)) {
    // Older MoltMoney without the dedicated endpoint: fall back to the
    // account view (daily usage NOT computed there).
    r = await mmGet(`/accounts/${cfg.accountId}`);
  } else {
    r = p;
  }
  if (!r.ok) {
    return fail(
      "POLICY UNAVAILABLE: could not retrieve Elio's spending policy from MoltMoney. " +
        `Details: ${r.error}. ` +
        "Do NOT assume spending is permitted — treat ALL spending as requiring explicit human approval before proceeding. " +
        "MoltMoney enforces spending rules server-side regardless of what Elio believes.",
      "spending_rules"
    );
  }
  const a: any = r.data;
  const rules: unknown = viaPolicyEndpoint ? a?.rules : a?.spendingRules;
  if (rules !== null && rules !== undefined && (typeof rules !== "object" || Array.isArray(rules))) {
    // Account reached fine but the rules blob is malformed → parse failure.
    return fail(
      "POLICY UNAVAILABLE: MoltMoney returned an unparseable spending-rules payload. " +
        "Do NOT assume spending is permitted — treat ALL spending as requiring explicit human approval before proceeding.",
      "spending_rules"
    );
  }
  const rj = (rules ?? {}) as Record<string, unknown>;
  const present = (v: unknown) => v !== undefined && v !== null && String(v) !== "";
  const hasRules =
    present(rj.perTransactionLimit) ||
    present(rj.dailyLimit) ||
    present(rj.requireApprovalAbove) ||
    (Array.isArray(rj.blockedCategories) && rj.blockedCategories.length > 0) ||
    (Array.isArray(rj.allowedMerchants) && rj.allowedMerchants.length > 0);
  if (!hasRules) {
    audit("moltmoney", "finance.read.spending_rules", {
      target: a?.id,
      detail: "no rules configured",
      risk: "low",
    });
    return [
      `No spending rules configured on MoltMoney account ${a?.id ?? cfg.accountId}.`,
      "MoltMoney will not apply rule-based owner approval on this account (balance and account-status checks still apply server-side).",
      "Elio's own Sentinel approval is still required before any payment attempt.",
      "Fail-closed: if this policy cannot be retrieved, do not assume spending is permitted.",
    ].join("\n");
  }
  const cur = typeof a?.currency === "string" ? ` ${a.currency}` : "";
  const lines: string[] = [`Spending policy (MoltMoney, account ${a?.id ?? cfg.accountId}):`];
  if (present(rj.perTransactionLimit)) lines.push(`- per-transaction limit: ${rj.perTransactionLimit}${cur}`);
  if (present(rj.dailyLimit)) lines.push(`- daily limit: ${rj.dailyLimit}${cur}`);
  if (present(rj.requireApprovalAbove))
    lines.push(`- requires owner approval above: ${rj.requireApprovalAbove}${cur}`);
  if (Array.isArray(rj.blockedCategories))
    lines.push(`- blocked categories: ${rj.blockedCategories.length ? rj.blockedCategories.join(", ") : "none"}`);
  if (Array.isArray(rj.allowedMerchants) && rj.allowedMerchants.length)
    lines.push(`- allowed merchants: ${rj.allowedMerchants.join(", ")}`);
  if (viaPolicyEndpoint) {
    lines.push(
      `- spent today: ${a?.spentToday ?? "unknown"}${cur} (server-computed by MoltMoney — authoritative)`,
      a?.remainingToday === null || a?.remainingToday === undefined
        ? "- remaining today: unlimited (no daily limit configured server-side)"
        : `- remaining today: ${a.remainingToday}${cur}`,
      `- server time: ${a?.serverTime ?? "unknown"} (MoltMoney server clock; the daily window is server-local)`
    );
  } else {
    lines.push(
      "- daily usage: NOT computed by this endpoint (fallback account view) — use moltmoney_get_transactions (COMPLETED outbound today) for history, or upgrade MoltMoney to get the /spending-policy endpoint."
    );
  }
  lines.push(
    "HARD PROHIBITION: blocked categories are hard stops, NOT approval cases. Elio must refuse a purchase in a blocked category BEFORE requesting any approval or creating any order — no Sentinel approval request, no MoltMoney call, no PayPal order, ever. When blocked categories are configured, MoltMoney also REQUIRES a merchantCategory on every PayPal order and rejects orders without one; if the category cannot be determined, do not proceed.",
    "MoltMoney independently enforces these rules server-side at order creation and capture; Elio's own check is UX only, not the security control.",
    "SOFT APPROVAL POLICY: per-transaction limit, daily limit and the require-approval-above threshold work differently — MoltMoney may still create the order but will require additional owner approval before capture. Explain that to the user rather than treating the payment as impossible.",
    "Fail-closed: if this policy cannot be retrieved, do not assume spending is permitted and do not start any purchase."
  );
  audit("moltmoney", "finance.read.spending_rules", { target: a?.id, detail: "policy retrieved", risk: "low" });
  return lines.join("\n");
}

function notConfiguredMsg(): string {
  return "MoltMoney is not configured (set MOLTMONEY_API_URL, MOLTMONEY_API_KEY and MOLTMONEY_ACCOUNT_ID).";
}

/**
 * Fetch ONLY what the pre-Sentinel policy check needs: the account's CURRENT
 * blockedCategories from MoltMoney (single source of truth — nothing is
 * hardcoded in Elio). Read-only GET, no guard() (same gate class as the
 * spending-rules tool). ok:false ⇒ callers must fail closed.
 */
async function getBlockedCategoriesFromPolicy(): Promise<
  { ok: true; blocked: string[] } | { ok: false; error: string }
> {
  const cfg = config();
  if (!cfg) return { ok: false, error: notConfiguredMsg() };
  const r = await mmGet(`/accounts/${cfg.accountId}`);
  if (!r.ok) return { ok: false, error: r.error };
  const rules = (r.data as any)?.spendingRules;
  const blocked = Array.isArray(rules?.blockedCategories)
    ? rules.blockedCategories.filter((c: unknown): c is string => typeof c === "string")
    : [];
  return { ok: true, blocked };
}

// ── Phase 2A: PayPal purchase flow (all money movement Sentinel-gated) ────

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/; // plain decimal string, no floats, no negatives
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Authenticated POST. Same contract as mmGet; NEVER retried by callers. */
async function mmPost(path: string, body: unknown): Promise<MmResult<any>> {
  const cfg = config();
  if (!cfg) return { ok: false, error: notConfiguredMsg() };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.baseUrl + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON handled below */
    }
    if (!res.ok) {
      const msg =
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.error?.code ||
        (typeof parsed?.error === "string" ? parsed.error : "") ||
        text.slice(0, 200) ||
        `HTTP ${res.status}`;
      return { ok: false, error: sanitize(`MoltMoney ${res.status}: ${msg}`, cfg.apiKey) };
    }
    if (parsed === null || typeof parsed !== "object") {
      return { ok: false, error: sanitize("MoltMoney returned an unexpected (non-JSON) response.", cfg.apiKey) };
    }
    return { ok: true, data: parsed };
  } catch (e: any) {
    const reason = e?.name === "AbortError" ? `timed out after ${TIMEOUT_MS / 1000}s` : String(e?.message || e);
    return { ok: false, error: sanitize(`MoltMoney unreachable (${reason}).`, cfg.apiKey) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /transactions/{id} — read-only status of one transaction (MoltMoney
 * transaction id or PayPal order id both resolve MoltMoney-side).
 */
export async function moltmoneyGetPayment(transactionId: string): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "payment");
  const id = String(transactionId || "").trim();
  if (!id) return fail("A transaction_id is required.", "payment");
  const r = await mmGet(`/transactions/${encodeURIComponent(id)}`);
  if (!r.ok) return fail(r.error, "payment");
  const t = r.data;
  audit("moltmoney", "finance.read.payment", { target: t.id, detail: `status=${t.status}`, risk: "low" });
  return [
    `Transaction ${t.id}`,
    `status: ${t.status} | type: ${t.type} | amount: ${t.amount} ${t.currency ?? ""}`.trim(),
    t.merchantName ? `merchant: ${t.merchantName}` : "",
    t.description ? `description: ${t.description}` : "",
    t.approvalRequired ? `owner approval: ${t.approvedAt ? `granted (${t.approvedAt})` : "REQUIRED, not yet granted"}` : "",
    t.providerRefId ? `paypal order: ${t.providerRefId}` : "",
    `created: ${t.createdAt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * POST /payments/paypal/orders — create a PayPal purchase via MoltMoney.
 * Sentinel: finance.pay (high/ask) BEFORE any HTTP call; nothing moves money
 * here yet (MoltMoney holds the transaction PENDING until capture), but the
 * human checkpoint happens up front so the user always consents to starting
 * a purchase. No retries, ever: create-order has no client idempotency key,
 * and a retried call would mint a second pending transaction.
 *
 * Blocked categories are HARD prohibitions (policy decision): checked here
 * BEFORE Sentinel, so they never reach an approval mechanism. Elio's
 * classification is advisory UX — MoltMoney independently re-checks and is
 * the security control. Policy fetch failing ⇒ fail closed.
 */
export async function moltmoneyCreatePaypalOrder(
  ctx: ToolContext,
  args: {
    amount?: string;
    currency?: string;
    description?: string;
    merchantName?: string;
    merchantCategory?: string;
    returnUrl?: string;
    cancelUrl?: string;
  }
): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "paypal_order");

  // ── Fail-closed validation BEFORE Sentinel and BEFORE any network call ──
  const amount = String(args.amount ?? "").trim();
  if (!DECIMAL_RE.test(amount) || Number(amount) <= 0) {
    return fail(
      `Invalid amount "${args.amount ?? ""}": use a positive decimal string like "5.00" (payment not started).`,
      "paypal_order"
    );
  }
  const currency = (args.currency || "USD").trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    return fail(`Invalid currency "${args.currency ?? ""}": use a 3-letter ISO code (payment not started).`, "paypal_order");
  }
  const description = String(args.description ?? "").slice(0, 500) || undefined;
  const merchantName = String(args.merchantName ?? "").slice(0, 100) || undefined;
  const merchantCategory = String(args.merchantCategory ?? "").trim().slice(0, 50) || undefined;

  // ── Fail-closed policy check BEFORE Sentinel: hard prohibitions must never
  // reach an approval mechanism. Reads the CURRENT policy from MoltMoney;
  // never hardcoded here. If the policy cannot be retrieved, fail closed.
  const policy = await getBlockedCategoriesFromPolicy();
  if (!policy.ok) {
    audit("moltmoney", "finance.pay.order.policy_unavailable", { risk: "high", detail: "purchase refused" });
    return fail(
      "POLICY UNAVAILABLE: could not retrieve Elio's spending policy from MoltMoney (" +
        policy.error +
        ") Fail-closed: the purchase was NOT started and no approval was requested — do not assume spending is permitted.",
      "paypal_order"
    );
  }
  if (policy.blocked.length > 0) {
    if (!merchantCategory) {
      audit("moltmoney", "finance.pay.order.category_required", { risk: "high", detail: "purchase refused" });
      return fail(
        "REFUSED before any approval or order: this MoltMoney account has blocked categories configured, so every purchase must declare a merchantCategory. Missing category is NOT interpreted as allowed. If you cannot determine the category, do NOT proceed — ask the user or refuse the purchase. Nothing was started.",
        "paypal_order"
      );
    }
    if (policy.blocked.includes(merchantCategory)) {
      audit("moltmoney", "finance.pay.order.blocked_category", { risk: "high", detail: merchantCategory });
      return fail(
        `REFUSED — BLOCKED CATEGORY: "${merchantCategory}" is a hard prohibition in MoltMoney's current policy. Blocked categories must NEVER reach an approval mechanism: no Sentinel approval request was created and no order was attempted. Offer the user an allowed alternative instead.`,
        "paypal_order"
      );
    }
  }

  // ── Sentinel gate: finance.pay → approval card → wait for the human ──
  const verdict = guard({
    action: "finance.pay",
    detail:
      `PayPal purchase via MoltMoney: ${amount} ${currency}` +
      (merchantName ? ` at ${merchantName}` : "") +
      (merchantCategory ? ` [category: ${merchantCategory}]` : "") +
      (description ? ` — ${description}` : ""),
    taskId: ctx.taskId,
    conversationId: ctx.conversationId,
  });
  if (verdict.decision === "deny") return fail(`Blocked by Sentinel: ${verdict.reason}`, "paypal_order");
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return fail("Blocked by Sentinel.", "paypal_order");
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("moltmoney", "finance.pay.order.not_approved", { risk: "high", detail: outcome });
      return "PayPal purchase was NOT started (approval denied or timed out). No money is committed.";
    }
  }

  // ── Approved: exactly one create call, no retry ──
  const body: Record<string, unknown> = { amount, currency };
  if (description) body.description = description;
  if (merchantName) body.merchantName = merchantName;
  if (merchantCategory) body.merchantCategory = merchantCategory;
  if (args.returnUrl) body.returnUrl = String(args.returnUrl);
  if (args.cancelUrl) body.cancelUrl = String(args.cancelUrl);
  const r = await mmPost("/payments/paypal/orders", body);
  if (!r.ok) return fail(r.error, "paypal_order");

  const tx = r.data.transaction ?? {};
  const transactionId = tx.id ?? r.data.orderId;
  audit("moltmoney", "finance.pay.order.created", {
    target: transactionId,
    detail: `${amount} ${currency}${merchantName ? ` at ${merchantName}` : ""} paypalOrderId=${r.data.orderId}`,
    risk: "high",
  });
  return [
    `PayPal purchase created (NOT yet paid).`,
    `moltmoney transaction: ${transactionId}`,
    `paypal order: ${r.data.orderId}`,
    `state: ${r.data.state ?? "WAITING_FOR_PAYER_APPROVAL"}`,
    r.data.approvalUrl
      ? `NEXT STEP — the USER must open this PayPal approval URL and approve the payment before it can be captured:\n${r.data.approvalUrl}`
      : "(no approval URL returned — ask the user to check their PayPal account)",
    `Amount committed so far: none. Use moltmoney_get_payment with the transaction id to check status; capture only after the user has approved on PayPal.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * POST /payments/paypal/orders/{id}/capture — capture an APPROVED PayPal
 * order via MoltMoney. Sentinel: finance.pay (high/ask) before the call.
 * MoltMoney's capture is idempotent (an already-completed capture returns
 * the same transaction), so a duplicate tool call can never double-charge;
 * we still never auto-retry network failures.
 */
export async function moltmoneyCapturePaypalOrder(ctx: ToolContext, transactionId: string): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "paypal_capture");

  const id = String(transactionId || "").trim();
  if (!id)
    return fail(
      "A transaction_id from moltmoney_create_paypal_order is required (capture not attempted).",
      "paypal_capture"
    );

  // ── Sentinel gate: finance.pay → approval card → wait for the human ──
  const verdict = guard({
    action: "finance.pay",
    detail: `Capture PayPal payment (finalize purchase) for MoltMoney transaction ${id}`,
    taskId: ctx.taskId,
    conversationId: ctx.conversationId,
  });
  if (verdict.decision === "deny") return fail(`Blocked by Sentinel: ${verdict.reason}`, "paypal_capture");
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return fail("Blocked by Sentinel.", "paypal_capture");
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("moltmoney", "finance.pay.capture.not_approved", { risk: "high", target: id, detail: outcome });
      return `Capture was NOT performed (approval denied or timed out). Transaction ${id} is unchanged — nothing was charged.`;
    }
  }

  // ── Approved: exactly one capture call, no retry ──
  const r = await mmPost(`/payments/paypal/orders/${encodeURIComponent(id)}/capture`, {});
  if (!r.ok)
    return fail(`${r.error} (transaction ${id} — check its status with moltmoney_get_payment)`, "paypal_capture");

  const t = r.data.transaction ?? {};
  audit("moltmoney", "finance.pay.capture.result", { target: t.id ?? id, detail: `status=${t.status}`, risk: "high" });
  return [
    `Capture result for transaction ${t.id ?? id}:`,
    `status: ${t.status}`,
    t.amount !== undefined ? `amount: ${t.amount} ${t.currency ?? ""}` : "",
    t.providerRefId ? `paypal order: ${t.providerRefId}` : "",
    t.status === "COMPLETED" ? "Payment completed — verify in MoltMoney balance/transactions." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * POST /payments/send — internal transfer from the agent's MoltMoney account
 * to another MoltMoney account (NOT a merchant purchase; use
 * moltmoney_create_paypal_order for those). Sentinel: finance.pay (high/ask)
 * BEFORE any HTTP call — unlike PayPal create-order (which only mints a
 * PENDING transaction), this single call MOVES money immediately. No retries,
 * ever: a retried send could double-send with no idempotency key.
 *
 * Category semantics differ from the PayPal purchase flow: an internal
 * transfer has no merchant, so a merchantCategory is NOT required here and
 * its absence is NOT treated as a policy failure. But if Elio DOES classify
 * the transfer into a blocked category, it refuses pre-Sentinel — a hard
 * prohibition must never reach an approval mechanism. Elio's check is
 * advisory UX only; MoltMoney independently re-checks spending rules
 * server-side (and may hold the transfer for owner approval) and is the
 * security control. Policy fetch failing ⇒ fail closed, no approval, no call.
 */
export async function moltmoneySendPayment(
  ctx: ToolContext,
  args: {
    amount?: string;
    toAccountId?: string;
    description?: string;
    merchantName?: string;
    merchantCategory?: string;
  }
): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "send_payment");

  // ── Fail-closed validation BEFORE Sentinel and BEFORE any network call ──
  const amount = String(args.amount ?? "").trim();
  if (!DECIMAL_RE.test(amount) || Number(amount) <= 0) {
    return fail(
      `Invalid amount "${args.amount ?? ""}": use a positive decimal string like "5.00" (transfer not started).`,
      "send_payment"
    );
  }
  const toAccountId = String(args.toAccountId ?? "").trim().slice(0, 100) || undefined;
  const description = String(args.description ?? "").slice(0, 500) || undefined;
  const merchantName = String(args.merchantName ?? "").slice(0, 100) || undefined;
  const merchantCategory = String(args.merchantCategory ?? "").trim().slice(0, 50) || undefined;

  // ── Fail-closed policy check BEFORE Sentinel: reads the CURRENT policy
  // from MoltMoney; never hardcoded. Policy unavailable ⇒ refuse.
  const policy = await getBlockedCategoriesFromPolicy();
  if (!policy.ok) {
    audit("moltmoney", "finance.pay.send.policy_unavailable", { risk: "high", detail: "transfer refused" });
    return fail(
      "POLICY UNAVAILABLE: could not retrieve Elio's spending policy from MoltMoney (" +
        policy.error +
        ") Fail-closed: the transfer was NOT started and no approval was requested — do not assume spending is permitted.",
      "send_payment"
    );
  }
  if (merchantCategory && policy.blocked.length > 0 && policy.blocked.includes(merchantCategory)) {
    audit("moltmoney", "finance.pay.send.blocked_category", { risk: "high", detail: merchantCategory });
    return fail(
      `REFUSED — BLOCKED CATEGORY: "${merchantCategory}" is a hard prohibition in MoltMoney's current policy. Blocked categories must NEVER reach an approval mechanism: no Sentinel approval request was created and no transfer was attempted. Ask the user how they want to proceed instead.`,
      "send_payment"
    );
  }

  // ── Sentinel gate: finance.pay → approval card → wait for the human ──
  const verdict = guard({
    action: "finance.pay",
    detail:
      `MoltMoney internal transfer: ${amount}` +
      (toAccountId ? ` to ${toAccountId}` : " (no destination account specified)") +
      (merchantCategory ? ` [category: ${merchantCategory}]` : "") +
      (description ? ` — ${description}` : ""),
    taskId: ctx.taskId,
    conversationId: ctx.conversationId,
  });
  if (verdict.decision === "deny") return fail(`Blocked by Sentinel: ${verdict.reason}`, "send_payment");
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return fail("Blocked by Sentinel.", "send_payment");
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("moltmoney", "finance.pay.send.not_approved", { risk: "high", detail: outcome });
      return "Transfer was NOT started (approval denied or timed out). No money moved.";
    }
  }

  // ── Approved: exactly one send call, no retry ──
  const body: Record<string, unknown> = { amount };
  if (toAccountId) body.toAccountId = toAccountId;
  if (description) body.description = description;
  if (merchantName) body.merchantName = merchantName;
  if (merchantCategory) body.merchantCategory = merchantCategory;
  const r = await mmPost("/payments/send", body);
  if (!r.ok)
    return fail(
      `${r.error} (transfer NOT completed — verify with moltmoney_get_payment before attempting anything else)`,
      "send_payment"
    );

  const tx = r.data.transaction ?? {};
  audit("moltmoney", "finance.pay.send.result", {
    target: tx.id,
    detail: `${amount} status=${tx.status}`,
    risk: "high",
  });
  return [
    `Internal transfer via MoltMoney:`,
    `transaction: ${tx.id ?? "?"}`,
    `status: ${tx.status ?? "unknown"}`,
    `amount: ${tx.amount ?? amount}`,
    tx.approvalRequired
      ? "OWNER APPROVAL REQUIRED: MoltMoney is holding this transfer until the account owner approves it — it is NOT complete yet. Tell the user; do not re-send or duplicate it."
      : "",
    tx.description ? `description: ${tx.description}` : "",
    `Check status with moltmoney_get_payment using the transaction id.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Phase 2B: cards, payouts, payment-requests (Sentinel-gated) ───────────

/**
 * GET /cards?accountId=… — list the agent account's virtual cards. Read-only
 * (finance.read, no guard). MoltMoney masks numbers in list responses and
 * never returns CVV; Elio echoes whatever masking it received and adds none.
 */
export async function moltmoneyListCards(): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "cards");
  const r = await mmGet("/cards", { accountId: cfg.accountId });
  if (!r.ok) return fail(r.error, "cards");
  const cards: any[] = Array.isArray(r.data?.cards) ? r.data.cards : [];
  audit("moltmoney", "finance.read.cards", { detail: `${cards.length}`, risk: "low" });
  if (!cards.length) return `No virtual cards on MoltMoney account ${cfg.accountId}.`;
  const lines = cards.map((c) =>
    [
      c.id,
      `${c.cardNumber} exp ${c.expiryMonth}/${c.expiryYear}`,
      `status: ${c.status}`,
      c.spendLimit ? `spend limit: ${c.spendLimit}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
  );
  return [
    `Virtual cards on MoltMoney account ${cfg.accountId}:`,
    ...lines,
    "(issuing, freezing and cancelling are owner-only operations in the MoltMoney dashboard — ask the owner; agent API keys are rejected there by design.)",
  ].join("\n");
}

/**
 * POST /payments/payout — send money to an external bank account.
 * Sentinel: finance.pay (high/ask) BEFORE any HTTP call; a single approved
 * call moves money immediately. No retries, ever (no idempotency key).
 *
 * Elio NEVER memorizes or stores bank details: routing/account numbers must
 * come from the USER in this conversation. MoltMoney independently verifies
 * the external account exists server-side and enforces spending rules
 * (blocked categories, limits — payouts may be held for owner approval).
 * Policy fetch failing ⇒ fail closed, no approval, no call.
 */
export async function moltmoneyCreatePayout(
  ctx: ToolContext,
  args: {
    amount?: string;
    routingNumber?: string;
    accountNumber?: string;
    accountHolder?: string;
    description?: string;
    merchantCategory?: string;
  }
): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "payout");

  // ── Fail-closed validation BEFORE Sentinel and BEFORE any network call ──
  const amount = String(args.amount ?? "").trim();
  if (!DECIMAL_RE.test(amount) || Number(amount) <= 0) {
    return fail(
      `Invalid amount "${args.amount ?? ""}": use a positive decimal string like "5.00" (payout not started).`,
      "payout"
    );
  }
  const routingNumber = String(args.routingNumber ?? "").trim();
  if (!/^\d{9}$/.test(routingNumber)) {
    return fail(`Invalid routing number: must be exactly 9 digits (payout not started).`, "payout");
  }
  const accountNumber = String(args.accountNumber ?? "").trim();
  if (!/^\d{8,17}$/.test(accountNumber)) {
    return fail(`Invalid account number: must be 8-17 digits (payout not started).`, "payout");
  }
  const accountHolder = String(args.accountHolder ?? "").trim().slice(0, 100);
  if (accountHolder.length < 2) {
    return fail(`Invalid account holder: name is required (2-100 chars) (payout not started).`, "payout");
  }
  const description = String(args.description ?? "").slice(0, 500) || undefined;
  const merchantCategory = String(args.merchantCategory ?? "").trim().slice(0, 50) || undefined;

  // ── Fail-closed policy check BEFORE Sentinel (same rule as send-payment) ──
  const policy = await getBlockedCategoriesFromPolicy();
  if (!policy.ok) {
    audit("moltmoney", "finance.pay.payout.policy_unavailable", { risk: "high", detail: "payout refused" });
    return fail(
      "POLICY UNAVAILABLE: could not retrieve Elio's spending policy from MoltMoney (" +
        policy.error +
        ") Fail-closed: the payout was NOT started and no approval was requested — do not assume spending is permitted.",
      "payout"
    );
  }
  if (merchantCategory && policy.blocked.length > 0 && policy.blocked.includes(merchantCategory)) {
    audit("moltmoney", "finance.pay.payout.blocked_category", { risk: "high", detail: merchantCategory });
    return fail(
      `REFUSED — BLOCKED CATEGORY: "${merchantCategory}" is a hard prohibition in MoltMoney's current policy. Blocked categories must NEVER reach an approval mechanism: no Sentinel approval request was created and no payout was attempted. Ask the user how they want to proceed instead.`,
      "payout"
    );
  }

  // ── Sentinel gate: finance.pay → approval card → wait for the human ──
  const verdict = guard({
    action: "finance.pay",
    detail:
      `MoltMoney bank payout: ${amount} (USD) to ${accountHolder}, account ****${accountNumber.slice(-4)} (routing ${routingNumber.slice(0, 3)}…)` +
      (merchantCategory ? ` [category: ${merchantCategory}]` : "") +
      (description ? ` — ${description}` : ""),
    taskId: ctx.taskId,
    conversationId: ctx.conversationId,
  });
  if (verdict.decision === "deny") return fail(`Blocked by Sentinel: ${verdict.reason}`, "payout");
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return fail("Blocked by Sentinel.", "payout");
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("moltmoney", "finance.pay.payout.not_approved", { risk: "high", detail: outcome });
      return "Payout was NOT started (approval denied or timed out). No money moved.";
    }
  }

  // ── Approved: exactly one payout call, no retry ──
  const body: Record<string, unknown> = { amount, routingNumber, accountNumber, accountHolder };
  if (description) body.description = description;
  const r = await mmPost("/payments/payout", body);
  if (!r.ok)
    return fail(
      `${r.error} (payout NOT completed — verify with moltmoney_get_payment before attempting anything else)`,
      "payout"
    );

  const tx = r.data.transaction ?? {};
  audit("moltmoney", "finance.pay.payout.result", {
    target: tx.id,
    detail: `${amount} status=${tx.status}`, // account/routing numbers deliberately never audited
    risk: "high",
  });
  return [
    `Bank payout via MoltMoney:`,
    `transaction: ${tx.id ?? "?"}`,
    `status: ${tx.status ?? "unknown"}`,
    `amount: ${tx.amount ?? amount}`,
    tx.recipientAccount ? `to: ${tx.recipientName ?? accountHolder} (${tx.recipientAccount})` : "",
    tx.approvalRequired
      ? "OWNER APPROVAL REQUIRED: MoltMoney is holding this payout until the account owner approves it — it is NOT complete yet. Tell the user; do not re-send or duplicate it."
      : "",
    `Check status with moltmoney_get_payment using the transaction id.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * POST /payments/request — create a payment/fund request. When toAccountId is
 * omitted, MoltMoney treats it as a FUND REQUEST to the owner (owner must
 * approve it in the dashboard — approval itself is owner-only and stays that
 * way). Sentinel: finance.pay (high/ask) BEFORE the call — the request asks
 * for money and, once paid, moves it. Amount validation also matches
 * MoltMoney's server-side schema BEFORE approval is requested.
 */
export async function moltmoneyCreatePaymentRequest(
  ctx: ToolContext,
  args: {
    amount?: string;
    description?: string;
    toAccountId?: string;
    generateLink?: boolean;
    expiresInHours?: number;
    merchantCategory?: string;
  }
): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "payment_request");

  const amount = String(args.amount ?? "").trim();
 if (!DECIMAL_RE.test(amount) || Number(amount) <= 0) {
    return fail(
      `Invalid amount "${args.amount ?? ""}": use a positive decimal string like "5.00" (request not created).`,
      "payment_request"
    );
  }
  const description = String(args.description ?? "").trim().slice(0, 500);
  if (!description) {
    return fail("A description is required for a payment request (request not created).", "payment_request");
  }
  const toAccountId = String(args.toAccountId ?? "").trim().slice(0, 100) || undefined;
  const generateLink = Boolean(args.generateLink);
  const hours = Number(args.expiresInHours);
  const ms = Number.isFinite(hours) && hours > 0 && hours <= 720 ? Math.floor(hours * 3_600_000) : 24 * 3_600_000;
  const expiresAt = new Date(Date.now() + ms).toISOString();

  // Hard-prohibition pre-check (fund requests to the owner carry no category;
  // peer requests may — refuse a blocked classification before approval).
  const policy = await getBlockedCategoriesFromPolicy();
  if (!policy.ok) {
    audit("moltmoney", "finance.pay.request.policy_unavailable", { risk: "high", detail: "request refused" });
    return fail(
      "POLICY UNAVAILABLE: could not retrieve Elio's spending policy from MoltMoney (" +
        policy.error +
        ") Fail-closed: the request was NOT created — do not assume spending is permitted.",
      "payment_request"
    );
  }
  const merchantCategory = String(args.merchantCategory ?? "").trim().slice(0, 50) || undefined;
  if (merchantCategory && policy.blocked.length > 0 && policy.blocked.includes(merchantCategory)) {
    audit("moltmoney", "finance.pay.request.blocked_category", { risk: "high", detail: merchantCategory });
    return fail(
      `REFUSED — BLOCKED CATEGORY: "${merchantCategory}" is a hard prohibition in MoltMoney's current policy. No approval was requested and no request was created.`,
      "payment_request"
    );
  }

  const verdict = guard({
    action: "finance.pay",
    detail:
      `MoltMoney payment request: ${amount}${toAccountId ? ` to account ${toAccountId}` : " (fund request to owner)"}` +
      (merchantCategory ? ` [category: ${merchantCategory}]` : "") +
      ` — ${description}`,
    taskId: ctx.taskId,
    conversationId: ctx.conversationId,
  });
  if (verdict.decision === "deny") return fail(`Blocked by Sentinel: ${verdict.reason}`, "payment_request");
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return fail("Blocked by Sentinel.", "payment_request");
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("moltmoney", "finance.pay.request.not_approved", { risk: "high", detail: outcome });
      return "Payment request was NOT created (approval denied or timed out).";
    }
  }

  const body: Record<string, unknown> = { amount, description, expiresAt };
  if (toAccountId) body.toAccountId = toAccountId;
  if (generateLink) body.generateLink = true;
  const r = await mmPost("/payments/request", body);
  if (!r.ok) return fail(`${r.error} (request NOT created)`, "payment_request");

  const pr = r.data;
  audit("moltmoney", "finance.pay.request.created", {
    target: pr.id,
    detail: `${amount} status=${pr.status}`,
    risk: "high",
  });
  return [
    `Payment request created on MoltMoney:`,
    `request: ${pr.id}`,
    `status: ${pr.status}`,
    `amount: ${pr.amount ?? amount}`,
    toAccountId ? `to account: ${pr.toAccountId ?? toAccountId}` : "fund request to owner — the OWNER approves it in the MoltMoney dashboard (owner-only; Elio cannot approve its own fund request).",
    pr.paymentLink ? `payment link: ${pr.paymentLink}` : "",
    pr.expiresAt ? `expires: ${pr.expiresAt}` : "",
    "Track it with moltmoney_list_payment_requests.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * GET /payments/requests — list requests from this agent's account (and peer
 * requests addressed to it). Read-only (finance.read). Owner-view filtering,
 * fund-request approval and decline are owner-side — not exposed here.
 */
export async function moltmoneyListPaymentRequests(status?: string): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "payment_requests");
  const st = String(status ?? "").trim().toUpperCase();
  const r = await mmGet("/payments/requests", st ? { status: st } : undefined);
  if (!r.ok) return fail(r.error, "payment_requests");
  const rows: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
  audit("moltmoney", "finance.read.payment_requests", { detail: `${rows.length}`, risk: "low" });
  if (!rows.length) return "No MoltMoney payment requests yet.";
  const lines = rows.slice(0, 50).map((p) =>
    [
      p.id,
      `${p.amount} ${p.currency ?? ""}`.trim(),
      `status: ${p.status}`,
      p.toAccountId === null ? "fund request → owner" : `to: ${p.toAccountId}`,
      p.description,
      p.expiresAt ? `expires ${p.expiresAt}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
  );
  return ["MoltMoney payment requests:", ...lines].join("\n");
}

/**
 * POST /payments/request/{id}/pay — pay a peer request addressed TO this
 * agent (payerAccountId must equal the request's toAccountId; MoltMoney
 * rejects Elio paying anyone else's request). Sentinel: finance.pay BEFORE
 * the call — paying a request moves money immediately. No retries.
 */
export async function moltmoneyPayPaymentRequest(ctx: ToolContext, requestId: string): Promise<string> {
  const cfg = config();
  if (!cfg) return fail(notConfiguredMsg(), "pay_request");

  const id = String(requestId || "").trim();
  if (!id) return fail("A request_id is required (payment not attempted).", "pay_request");

  // ── Read the request first: fail closed BEFORE approval if it is not a
  // pending request addressed to Elio's account. Mirror of MoltMoney's own
  // "only the recipient can pay" check, so invalid targets never even create
  // an approval card.
  const list = await mmGet("/payments/requests");
  if (!list.ok) return fail(`Could not verify the request before approving anything (${list.error})`, "pay_request");
  const rows: any[] = Array.isArray(list.data?.data) ? list.data.data : [];
  const target = rows.find((p) => p.id === id);
  if (!target) {
    return fail(
      `Request ${id} is not visible to this account — refusing (only the recipient can pay a request; nothing was approved or paid).`,
      "pay_request"
    );
  }
  if (target.status !== "PENDING") {
    return fail(`Request ${id} is ${String(target.status).toLowerCase()} — only PENDING requests can be paid (nothing was paid).`, "pay_request");
  }
  if (target.toAccountId == null || target.toAccountId !== cfg.accountId) {
    return fail(
      `Request ${id} is not addressed to this account (toAccountId=${target.toAccountId ?? "null"}) — refusing. Fund requests go to the OWNER, who approves them in the MoltMoney dashboard; nothing was approved or paid.`,
      "pay_request"
    );
  }

  // ── Sentinel gate: finance.pay → approval card → wait for the human ──
  const verdict = guard({
    action: "finance.pay",
    detail: `Pay MoltMoney payment request ${id}: ${target.amount} ${target.currency ?? ""}`.trim() +
      (target.description ? ` — ${target.description}` : ""),
    taskId: ctx.taskId,
    conversationId: ctx.conversationId,
  });
  if (verdict.decision === "deny") return fail(`Blocked by Sentinel: ${verdict.reason}`, "pay_request");
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return fail("Blocked by Sentinel.", "pay_request");
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("moltmoney", "finance.pay.pay_request.not_approved", { risk: "high", target: id, detail: outcome });
      return `Payment request ${id} was NOT paid (approval denied or timed out). Nothing moved.`;
    }
  }

  // ── Approved: exactly one pay call, no retry ──
  const r = await mmPost(`/payments/request/${encodeURIComponent(id)}/pay`, { payerAccountId: cfg.accountId });
  if (!r.ok)
    return fail(`${r.error} (payment NOT completed — verify the request's status before retrying anything)`, "pay_request");

  const req = r.data.request ?? {};
  const tx = r.data.transaction ?? {};
  audit("moltmoney", "finance.pay.pay_request.result", {
    target: tx.id ?? id,
    detail: `request=${id} status=${tx.status}`,
    risk: "high",
  });
  return [
    `Paid payment request ${req.id ?? id}:`,
    `request status: ${req.status ?? "unknown"}`,
    `transaction: ${tx.id ?? "?"} (amount ${tx.amount ?? "?"}, status ${tx.status ?? "unknown"})`,
    `Check balances with moltmoney_get_balance.`,
  ]
    .filter(Boolean)
    .join("\n");
}
