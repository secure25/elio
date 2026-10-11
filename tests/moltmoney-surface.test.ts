// ── MoltMoney Phase 2B tests: cards / payouts / payment-requests ──────────
// All network mocked with vi.stubGlobal("fetch"). Sentinel approvals are
// settled via settlePending() exactly like tests/moltmoney-pay.test.ts.
process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = process.env.MUSE_DATA_DIR || "./data-test";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = [
  "MOLTMONEY_API_URL",
  "MOLTMONEY_API_KEY",
  "MOLTMONEY_ACCOUNT_ID",
  "MOLTMONEY_ENABLED",
] as const;
const saved: Record<string, string | undefined> = {};

const URL_ = "https://mm.test";
const KEY = "mm_test_0123456789abcdefSECRET";
const ACC = "e4122879-47d6-4e98-b5eb-ad0fde5a9b67";
const CTX = { taskId: null, conversationId: "conv-mm-tests-b" };

async function ensureConversation() {
  const { db, now } = await import("../src/lib/db");
  db.prepare(
    "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)"
  ).run(CTX.conversationId, "MoltMoney Phase 2B tests", now(), now());
}

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}) {
  process.env.MOLTMONEY_API_URL = overrides.MOLTMONEY_API_URL ?? URL_;
  process.env.MOLTMONEY_API_KEY = overrides.MOLTMONEY_API_KEY ?? KEY;
  process.env.MOLTMONEY_ACCOUNT_ID = overrides.MOLTMONEY_ACCOUNT_ID ?? ACC;
  process.env.MOLTMONEY_ENABLED = Object.prototype.hasOwnProperty.call(overrides, "MOLTMONEY_ENABLED")
    ? overrides.MOLTMONEY_ENABLED
    : "true";
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

async function settlePending(approve: boolean): Promise<void> {
  const { listApprovals, resolveApproval } = await import("../src/lib/sentinel");
  for (let i = 0; i < 50; i++) {
    const pending = listApprovals("pending") as any[];
    if (pending.length) {
      resolveApproval(pending[0].id, approve);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no pending Sentinel approval appeared");
}

const RULES_NO_BLOCKED = { perTransactionLimit: "10.00", dailyLimit: "50.00", requireApprovalAbove: "11.00" };
const RULES_WITH_BLOCKED = { ...RULES_NO_BLOCKED, blockedCategories: ["gambling", "alcohol"] };

const accountPayload = (spendingRules: unknown) => ({
  id: ACC,
  type: "AGENT",
  balance: "105.00",
  currency: "USD",
  status: "ACTIVE",
  spendingRules,
});

/** Route policy GET (/accounts/{id}) by URL; everything else to `other`. */
function routeFetch(fetchMock: any, account: unknown, other: (u: string) => any) {
  fetchMock.mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes(`/accounts/${ACC}`)) return Promise.resolve(res(200, account));
    return Promise.resolve(other(u));
  });
}

const PAYOUT_OK = {
  transaction: {
    id: "tx-po-1",
    amount: "75.00",
    type: "PAYOUT",
    status: "COMPLETED",
    description: "payout smoke",
    recipientName: "Jane Owner",
    recipientAccount: "****4321",
    approvalRequired: false,
    createdAt: "2026-10-11T12:00:00Z",
  },
};

const REQUEST_OK = {
  id: "pr-77",
  amount: "30.00",
  currency: "USD",
  description: "need GPU credits",
  status: "PENDING",
  paymentLink: "https://mm.test/pay/pr-77",
  fromAccountId: ACC,
  toAccountId: null,
  expiresAt: "2026-10-12T12:00:00Z",
  createdAt: "2026-10-11T12:00:00Z",
};

const PEER_REQUEST = {
  ...REQUEST_OK,
  id: "pr-peer-1",
  toAccountId: ACC,
  description: "invoice for shared GPU",
};

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  setEnv();
  await ensureConversation();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("moltmoney_list_cards (read-only)", () => {
  it("lists cards with masked numbers and no approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, {
        cards: [
          { id: "card-1", cardNumber: "555555******1111", expiryMonth: 10, expiryYear: 2029, status: "ACTIVE", spendLimit: "50.00", accountId: ACC, createdAt: "2026-10-01T00:00:00Z" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyListCards();

    expect(out).toContain("card-1");
    expect(out).toContain("555555******1111");
    expect(out).toContain("ACTIVE");
    expect(out).toContain("50.00");
    expect(out).toContain("owner"); // mentions owner-only issuing
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_}/cards?accountId=${ACC}`);
    expect((listApprovals("pending") as any[]).length).toBe(0); // no approval card for a read
  });

  it("handles the no-cards case without approval", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { cards: [] })));
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyListCards();
    expect(out).toContain("No virtual cards");
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });
});

describe("moltmoney_create_payout (Sentinel-gated, fail-closed validation)", () => {
  const args = {
    amount: "75.00",
    routingNumber: "021000021",
    accountNumber: "12345678901234",
    accountHolder: "Jane Owner",
    description: "owner payout",
  };

  it("validates bank details BEFORE Sentinel — zero network calls on garbage input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    expect(await mm.moltmoneyCreatePayout(CTX, { ...args, amount: "-5" })).toContain("Invalid amount");
    expect(await mm.moltmoneyCreatePayout(CTX, { ...args, routingNumber: "02100002" })).toContain("routing number");
    expect(await mm.moltmoneyCreatePayout(CTX, { ...args, accountNumber: "123" })).toContain("account number");
    expect(await mm.moltmoneyCreatePayout(CTX, { ...args, accountHolder: "J" })).toContain("account holder");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((listApprovals("pending") as any[]).length).toBe(0); // no approval card for garbage input
  });

  it("waits for Sentinel approval, then calls POST /payments/payout exactly once with the raw bank details", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), (u) =>
      u.includes("/payments/payout") ? Promise.resolve(res(201, PAYOUT_OK)) : Promise.resolve(res(404, { message: `unexpected ${u}` }))
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePayout(CTX, args);
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("tx-po-1");
    expect(out).toContain("COMPLETED");
    expect(out).toContain("****4321");

    const payoutCalls = fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes("/payments/payout"));
    expect(payoutCalls).toHaveLength(1); // no retries, ever
    const [calledUrl, init] = payoutCalls[0];
    expect(String(calledUrl)).toBe(`${URL_}/payments/payout`);
    const body = JSON.parse((init as any).body);
    expect(body).toEqual({
      amount: "75.00", // string, not float
      routingNumber: "021000021",
      accountNumber: "12345678901234",
      accountHolder: "Jane Owner",
      description: "owner payout",
    });
  });

  it("never audits full bank numbers in the approval detail or audit log", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), (u) =>
      u.includes("/payments/payout") ? Promise.resolve(res(201, PAYOUT_OK)) : Promise.resolve(res(404, { message: `unexpected ${u}` }))
    );
    const { listApprovals } = await import("../src/lib/sentinel");
    const { db: auditDb } = await import("../src/lib/db");
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePayout(CTX, args);
    await settlePending(true);
    await pending;

    const pendingRows = listApprovals("pending") as any[]; // resolved by settle, list is empty
    expect(pendingRows.length).toBe(0);
    for (const row of pendingRows) {
      expect(row.detail).not.toContain(args.accountNumber);
    }
    const auditRows = auditDb.prepare(`SELECT detail FROM audit_log WHERE detail LIKE '%12345678901234%'`).all();
    expect(auditRows).toHaveLength(0); // the FULL account number never lands in the audit trail
  });

  it("does NOT call MoltMoney when the human denies the approval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => {
      throw new Error("payout POST must never happen without approval");
    });
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePayout(CTX, args);
    await settlePending(false);
    const out = await pending;
    expect(out).toContain("NOT started");
    expect(out).toContain("No money moved");
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the policy GET
  });

  it("fails closed when the policy cannot be retrieved (no approval, no payout)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500, "<html>bad</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyCreatePayout(CTX, args);
    expect(out).toContain("POLICY UNAVAILABLE");
    expect(out).toContain("NOT started");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("refuses a blocked-category classification BEFORE Sentinel (no approval, no call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => {
      throw new Error("payout POST must never happen for a blocked category");
    });
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyCreatePayout(CTX, { ...args, merchantCategory: "gambling" });
    expect(out).toContain("BLOCKED CATEGORY");
    expect(out).toContain("hard prohibition");
    expect(fetchMock).toHaveBeenCalledTimes(1); // policy GET only
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("maps a payout failure to a fail-closed message and NEVER retries", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), (u) =>
      u.includes("/payments/payout")
        ? Promise.resolve(res(400, { error: { code: "INSUFFICIENT_BALANCE", message: "Insufficient balance" } }))
        : Promise.resolve(res(404, { message: `unexpected ${u}` }))
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePayout(CTX, args);
    await settlePending(true);
    const out = await pending;
    expect(out).toContain("400");
    expect(out).toContain("Insufficient balance");
    expect(out).toContain("moltmoney_get_payment");
    expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes("/payments/payout"))).toHaveLength(1);
  });

  it("surfaces MoltMoney owner-approval holds instead of treating a PENDING payout as complete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), (u) =>
      u.includes("/payments/payout")
        ? Promise.resolve(res(201, { ...PAYOUT_OK, transaction: { ...PAYOUT_OK.transaction, status: "PENDING", approvalRequired: true } }))
        : Promise.resolve(res(404, { message: `unexpected ${u}` }))
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePayout(CTX, args);
    await settlePending(true);
    const out = await pending;
    expect(out).toContain("OWNER APPROVAL REQUIRED");
    expect(out).toContain("NOT complete yet");
  });
});

describe("moltmoney_create_payment_request (Sentinel-gated)", () => {
  it("creates a fund request to the owner (no toAccountId) with a 24h default expiry and returns id/status", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), (u) =>
      u.includes("/payments/request") ? Promise.resolve(res(201, REQUEST_OK)) : Promise.resolve(res(404, { message: `unexpected ${u}` }))
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePaymentRequest(CTX, { amount: "30.00", description: "need GPU credits" });
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("pr-77");
    expect(out).toContain("PENDING");
    expect(out).toContain("fund request");
    expect(out).toContain("owner-only");

    const reqCalls = fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes("/payments/request"));
    expect(reqCalls).toHaveLength(1);
    const body = JSON.parse((reqCalls[0][1] as any).body);
    expect(body.amount).toBe("30.00");
    expect(body.toAccountId).toBeUndefined();
    expect(body.description).toBe("need GPU credits");
    const expires = new Date(body.expiresAt).getTime();
    expect(expires).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(expires).toBeLessThan(Date.now() + 25 * 3_600_000);
  });

  it("requires a description (refused before approval, zero network)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyCreatePaymentRequest(CTX, { amount: "30.00" });
    expect(out).toContain("description is required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("refuses a blocked-category classification BEFORE Sentinel", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => {
      throw new Error("request POST must never happen for a blocked category");
    });
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyCreatePaymentRequest(CTX, { amount: "30.00", description: "wager", merchantCategory: "gambling" });
    expect(out).toContain("BLOCKED CATEGORY");
    expect((listApprovals("pending") as any[]).length).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // policy GET only
  });

  it("does NOT create the request when the human denies", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => {
      throw new Error("request POST must never happen without approval");
    });
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePaymentRequest(CTX, { amount: "30.00", description: "x" });
    await settlePending(false);
    const out = await pending;
    expect(out).toContain("NOT created");
    expect(fetchMock).toHaveBeenCalledTimes(1); // policy GET only
  });
});

describe("moltmoney_list_payment_requests (read-only)", () => {
  it("lists fund and peer requests with status/expiry and no approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [REQUEST_OK, PEER_REQUEST] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyListPaymentRequests();
    expect(out).toContain("pr-77");
    expect(out).toContain("fund request → owner");
    expect(out).toContain(`to: ${ACC}`);
    // No status filter passed → bare URL (status query omitted).
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_}/payments/requests`);
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("propagates failure as a fail-closed message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(401, { error: { code: "UNAUTHORIZED", message: "Invalid API key" } })));
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyListPaymentRequests();
    expect(out).toContain("401");
    expect(out).toContain("Invalid API key");
  });
});

describe("moltmoney_pay_payment_request (Sentinel-gated, recipient-only)", () => {
  it("pays a PENDING peer request addressed to this account after Sentinel approval — exactly once", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((url: any) => {
      const u = String(url);
      if (u.includes("/payments/requests")) return Promise.resolve(res(200, { data: [PEER_REQUEST] }));
      if (u.includes("/payments/request/pr-peer-1/pay")) {
        return Promise.resolve(res(200, {
          request: { id: "pr-peer-1", status: "PAID" },
          transaction: { id: "tx-pay-1", amount: "30.00", type: "INBOUND", status: "COMPLETED" },
        }));
      }
      return Promise.resolve(res(404, { message: `unexpected ${u}` }));
    });
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyPayPaymentRequest(CTX, "pr-peer-1");
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("pr-peer-1");
    expect(out).toContain("PAID");
    expect(out).toContain("tx-pay-1");

    const payCalls = fetchMock.mock.calls.filter((c: any[]) => String(c[0]).endsWith("/pay"));
    expect(payCalls).toHaveLength(1); // exactly one pay call, no retries
    const body = JSON.parse((payCalls[0][1] as any).body);
    expect(body.payerAccountId).toBe(ACC);
  });

  it("refuses requests addressed to someone else BEFORE creating any approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [{ ...PEER_REQUEST, id: "pr-x", toAccountId: "other-account", status: "PENDING" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyPayPaymentRequest(CTX, "pr-x");
    expect(out).toContain("not addressed to this account");
    expect(out).toContain("nothing was approved or paid");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the verification GET only
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("refuses fund requests (toAccountId null) — those are owner-approved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [REQUEST_OK] }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyPayPaymentRequest(CTX, "pr-77");
    expect(out).toContain("not addressed to this account");
    expect(out).toContain("Fund requests go to the OWNER");
  });

  it("refuses a request it cannot see (fail closed, no approval, no pay call)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyPayPaymentRequest(CTX, "pr-gone");
    expect(out).toContain("not visible to this account");
    expect((listApprovals("pending") as any[]).length).toBe(0);
    expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).endsWith("/pay"))).toHaveLength(0);
  });

  it("refuses non-PENDING requests before approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [{ ...PEER_REQUEST, status: "PAID" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyPayPaymentRequest(CTX, "pr-peer-1");
    expect(out).toContain("paid");
    expect(out).toContain("only PENDING");
  });

  it("does NOT pay when the human denies the approval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((url: any) => {
      const u = String(url);
      if (u.includes("/payments/requests")) return Promise.resolve(res(200, { data: [PEER_REQUEST] }));
      throw new Error("pay POST must never happen without approval");
    });
    const mm = await import("../src/lib/connectors/moltmoney");
    const pending = mm.moltmoneyPayPaymentRequest(CTX, "pr-peer-1");
    await settlePending(false);
    const out = await pending;
    expect(out).toContain("NOT paid");
    expect(out).toContain("Nothing moved");
    expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).endsWith("/pay"))).toHaveLength(0);
  });

  it("requires a request id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyPayPaymentRequest(CTX, "");
    expect(out).toContain("request_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Phase 2B tool registration gating", () => {
  it("registers all 11 MoltMoney tools when MOLTMONEY_ENABLED=true and creds present", async () => {
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    for (const n of [
      "moltmoney_get_account",
      "moltmoney_get_balance",
      "moltmoney_get_transactions",
      "moltmoney_get_spending_rules",
      "moltmoney_list_cards",
      "moltmoney_list_payment_requests",
      "moltmoney_get_payment",
      "moltmoney_create_paypal_order",
      "moltmoney_capture_paypal_order",
      "moltmoney_send_payment",
      "moltmoney_create_payout",
      "moltmoney_create_payment_request",
      "moltmoney_pay_payment_request",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("registers ONLY read-only tools when MOLTMONEY_ENABLED is unset", async () => {
    setEnv({ MOLTMONEY_ENABLED: undefined });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    expect(names).toContain("moltmoney_list_cards");
    expect(names).toContain("moltmoney_list_payment_requests");
    expect(names).not.toContain("moltmoney_create_payout");
    expect(names).not.toContain("moltmoney_create_payment_request");
    expect(names).not.toContain("moltmoney_pay_payment_request");
  });

  it("registers NO MoltMoney tools when MOLTMONEY_ENABLED=false (kill switch)", async () => {
    setEnv({ MOLTMONEY_ENABLED: "false" });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().filter((d) => d.name.startsWith("moltmoney_"));
    expect(names).toEqual([]);
  });
});
