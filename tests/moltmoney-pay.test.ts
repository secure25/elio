// ── MoltMoney Phase 2A tests: PayPal purchase flow (all network mocked) ──
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
const CTX = { taskId: null, conversationId: "conv-mm-tests" };

/** Sentinel approvals FK-reference conversations; create the test conversation once. */
async function ensureConversation() {
  const { db, now } = await import("../src/lib/db");
  db.prepare(
    "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)"
  ).run(CTX.conversationId, "MoltMoney pay tests", now(), now());
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

/** Resolve the oldest pending Sentinel approval (the connector is polling for it). */
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

const CREATE_OK = {
  transaction: {
    id: "tx-mm-123",
    amount: "5.00",
    currency: "USD",
    type: "OUTBOUND",
    status: "PENDING",
    approvalRequired: false,
    providerName: "paypal",
    providerRefId: "ORDER-XYZ",
    createdAt: "2026-10-05T12:00:00Z",
  },
  orderId: "ORDER-XYZ",
  approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-XYZ",
  state: "WAITING_FOR_PAYER_APPROVAL",
};

const RULES_NO_BLOCKED = { perTransactionLimit: "10.00", dailyLimit: "50.00", requireApprovalAbove: "11.00" };
const RULES_WITH_BLOCKED = {
  ...RULES_NO_BLOCKED,
  blockedCategories: ["gambling", "alcohol", "dangerous goods"],
};
const accountPayload = (spendingRules: unknown) => ({
  id: ACC,
  type: "AGENT",
  balance: "105.00",
  currency: "USD",
  status: "ACTIVE",
  spendingRules,
});

/** Route the pre-Sentinel policy GET (GET /accounts/{id}) and the order POST to different payloads. */
function routeFetch(fetchMock: any, account: unknown, order: () => any) {
  fetchMock.mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes("/payments/paypal/orders")) return Promise.resolve(order());
    if (u.includes(`/accounts/${ACC}`)) return Promise.resolve(res(200, account));
    return Promise.resolve(res(404, { message: `unexpected fetch: ${u}` }));
  });
}

function orderPostCalls(fetchMock: any): any[] {
  return fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes("/payments/paypal/orders"));
}

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

describe("moltmoney_get_payment (read-only)", () => {
  it("fetches /transactions/{id} and formats status without any Sentinel approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, {
        id: "tx-mm-123",
        amount: "5.00",
        currency: "USD",
        type: "OUTBOUND",
        status: "PENDING",
        description: "sandbox test",
        merchantName: "Test Merchant",
        approvalRequired: false,
        approvedAt: null,
        providerRefId: "ORDER-XYZ",
        createdAt: "2026-10-05T12:00:00Z",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneyGetPayment("tx-mm-123");

    expect(out).toContain("tx-mm-123");
    expect(out).toContain("PENDING");
    expect(out).toContain("5.00 USD");
    expect(out).toContain("ORDER-XYZ");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_}/transactions/tx-mm-123`);
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe(`Bearer ${KEY}`);
    expect((listApprovals("pending") as any[]).length).toBe(0); // read-only: no approval created
  });

  it("propagates not-found as a fail-closed message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(404, { message: "Transaction not found", statusCode: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetPayment("tx-missing");
    expect(out).toContain("404");
    expect(out).toContain("not found");
  });
});

describe("moltmoney_create_paypal_order (Sentinel-gated, no retry)", () => {
  it("waits for Sentinel approval, then creates the order exactly once and returns id/orderId/approvalUrl/state", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => res(201, CREATE_OK));
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePaypalOrder(CTX, {
      amount: "5.00",
      currency: "USD",
      description: "sandbox test",
      merchantName: "Test Merchant",
    });
    await settlePending(true); // human approves via the approval card
    const out = await pending;

    expect(out).toContain("tx-mm-123");
    expect(out).toContain("ORDER-XYZ");
    expect(out).toContain("https://www.sandbox.paypal.com/checkoutnow?token=ORDER-XYZ");
    expect(out).toContain("WAITING_FOR_PAYER_APPROVAL");
    expect(out).toContain("NOT yet paid");
    expect(out).toContain("NEXT STEP");

    // 2 calls total: the pre-Sentinel policy GET + exactly one create POST
    // (no retries, ever).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(orderPostCalls(fetchMock)).toHaveLength(1);
    const [calledUrl, init] = orderPostCalls(fetchMock)[0];
    expect(String(calledUrl)).toBe(`${URL_}/payments/paypal/orders`);
    expect((init as any).method).toBe("POST");
    const body = JSON.parse((init as any).body);
    expect(body).toEqual({
      amount: "5.00", // string, not float
      currency: "USD",
      description: "sandbox test",
      merchantName: "Test Merchant",
    });
    expect((init as any).headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("does NOT call MoltMoney when the human denies the approval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => res(201, CREATE_OK));
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePaypalOrder(CTX, { amount: "5.00" });
    await settlePending(false); // human denies
    const out = await pending;

    expect(out).toContain("NOT started");
    // Only the read-only policy GET happened; the order was NEVER attempted.
    expect(orderPostCalls(fetchMock)).toHaveLength(0);
  });

  it("rejects invalid amounts/currency BEFORE Sentinel and with zero network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    expect(await mm.moltmoneyCreatePaypalOrder(CTX, { amount: "-1" })).toContain("Invalid amount");
    expect(await mm.moltmoneyCreatePaypalOrder(CTX, { amount: "abc" })).toContain("Invalid amount");
    expect(await mm.moltmoneyCreatePaypalOrder(CTX, { amount: "1e9" })).toContain("Invalid amount");
    expect(await mm.moltmoneyCreatePaypalOrder(CTX, { amount: "5.00", currency: "USDD" })).toContain(
      "Invalid currency"
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect((listApprovals("pending") as any[]).length).toBe(0); // no approval card for garbage input
  });

  it("maps create-order failure to a fail-closed result and NEVER retries (exactly one call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(
      fetchMock,
      accountPayload(RULES_NO_BLOCKED),
      () => res(400, { error: { code: "INSUFFICIENT_BALANCE", message: "Insufficient balance" } })
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePaypalOrder(CTX, { amount: "5.00" });
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("400");
    expect(out).toContain("Insufficient balance");
    expect(orderPostCalls(fetchMock)).toHaveLength(1); // proof: no retry after failure
  });

  it("does not retry on transient 500 either (exactly one call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => res(500, "<html>bad gateway</html>"));
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCreatePaypalOrder(CTX, { amount: "5.00" });
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("500");
    expect(orderPostCalls(fetchMock)).toHaveLength(1);
  });

  describe("blocked category hard prohibition (refused BEFORE Sentinel)", () => {
    it("refuses a blocked category with NO Sentinel approval and NO order POST", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => {
        throw new Error("order POST must never happen for a blocked category");
      });
      const { listApprovals } = await import("../src/lib/sentinel");
      const mm = await import("../src/lib/connectors/moltmoney");

      const out = await mm.moltmoneyCreatePaypalOrder(CTX, {
        amount: "5.00",
        merchantName: "Liquor Store",
        merchantCategory: "alcohol",
      });

      expect(out).toContain("BLOCKED CATEGORY");
      expect(out).toContain("hard prohibition");
      expect(out).toContain("no Sentinel approval request was created");
      // Only the read-only policy GET happened.
      expect(orderPostCalls(fetchMock)).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // No approval request was created for the blocked intent.
      expect((listApprovals("pending") as any[]).length).toBe(0);
    });

    it("refuses a missing merchantCategory when blocked categories are configured (fail-closed)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => {
        throw new Error("order POST must never happen without a category");
      });
      const { listApprovals } = await import("../src/lib/sentinel");
      const mm = await import("../src/lib/connectors/moltmoney");

      const out = await mm.moltmoneyCreatePaypalOrder(CTX, {
        amount: "5.00",
        merchantName: "Some Store",
      });

      expect(out).toContain("merchantCategory");
      expect(out).toContain("NOT interpreted as allowed");
      expect(orderPostCalls(fetchMock)).toHaveLength(0);
      expect((listApprovals("pending") as any[]).length).toBe(0);
    });

    it("fails closed when the policy cannot be retrieved (no approval, no order)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(res(500, "<html>bad gateway</html>"));
      vi.stubGlobal("fetch", fetchMock);
      const { listApprovals } = await import("../src/lib/sentinel");
      const mm = await import("../src/lib/connectors/moltmoney");

      const out = await mm.moltmoneyCreatePaypalOrder(CTX, {
        amount: "5.00",
        merchantCategory: "books",
      });

      expect(out).toContain("POLICY UNAVAILABLE");
      expect(out).toContain("do not assume spending is permitted");
      expect(orderPostCalls(fetchMock)).toHaveLength(0);
      expect((listApprovals("pending") as any[]).length).toBe(0);
    });

    it("proceeds through Sentinel for an ALLOWED category and sends merchantCategory to MoltMoney", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => res(201, CREATE_OK));
      const mm = await import("../src/lib/connectors/moltmoney");

      const pending = mm.moltmoneyCreatePaypalOrder(CTX, {
        amount: "5.00",
        merchantName: "Book Store",
        merchantCategory: "books",
      });
      await settlePending(true);
      const out = await pending;

      expect(out).toContain("ORDER-XYZ");
      expect(orderPostCalls(fetchMock)).toHaveLength(1);
      const body = JSON.parse((orderPostCalls(fetchMock)[0] as any[])[1].body);
      expect(body.merchantCategory).toBe("books");
    });
  });
});

describe("moltmoney_capture_paypal_order (Sentinel-gated, idempotent)", () => {
  it("waits for Sentinel approval, then captures against the FIXED transaction id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, {
        transaction: {
          id: "tx-mm-123",
          amount: "5.00",
          currency: "USD",
          type: "OUTBOUND",
          status: "COMPLETED",
          providerName: "paypal",
          providerRefId: "ORDER-XYZ",
          createdAt: "2026-10-05T12:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCapturePaypalOrder(CTX, "tx-mm-123");
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("tx-mm-123");
    expect(out).toContain("COMPLETED");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_}/payments/paypal/orders/tx-mm-123/capture`);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body)).toEqual({});
  });

  it("does NOT call MoltMoney when capture approval is denied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCapturePaypalOrder(CTX, "tx-mm-123");
    await settlePending(false);
    const out = await pending;

    expect(out).toContain("NOT performed");
    expect(out).toContain("nothing was charged");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces capture failure without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        res(409, { error: { code: "INVALID_TRANSACTION_STATE", message: "Cannot capture transaction in PENDING status" } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneyCapturePaypalOrder(CTX, "tx-mm-123");
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("409");
    expect(out).toContain("moltmoney_get_payment");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for an already-completed capture: same transaction returned, no double-charge", async () => {
    // MoltMoney returns the same COMPLETED transaction when asked to re-capture.
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, {
        transaction: {
          id: "tx-mm-123",
          amount: "5.00",
          currency: "USD",
          type: "OUTBOUND",
          status: "COMPLETED",
          providerName: "paypal",
          providerRefId: "ORDER-XYZ",
          createdAt: "2026-10-05T12:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");

    const first = mm.moltmoneyCapturePaypalOrder(CTX, "tx-mm-123");
    await settlePending(true);
    const out1 = await first;

    const second = mm.moltmoneyCapturePaypalOrder(CTX, "tx-mm-123");
    await settlePending(true);
    const out2 = await second;

    expect(out1).toContain("COMPLETED");
    expect(out2).toContain("COMPLETED");
    expect(out2).toContain("tx-mm-123");
    // Two user-approved capture calls → two provider calls, but MoltMoney's
    // idempotency guarantees the SAME transaction/status (no double-deduct).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires a transaction id (no capture without the create-step identifier)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyCapturePaypalOrder(CTX, "");
    expect(out).toContain("transaction_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Phase 2A tool registration gating", () => {
  it("registers all 7 MoltMoney tools when MOLTMONEY_ENABLED=true and creds present", async () => {
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    for (const n of [
      "moltmoney_get_account",
      "moltmoney_get_balance",
      "moltmoney_get_transactions",
      "moltmoney_get_payment",
      "moltmoney_create_paypal_order",
      "moltmoney_capture_paypal_order",
      "moltmoney_send_payment",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("registers ONLY read-only tools when MOLTMONEY_ENABLED is unset", async () => {
    setEnv({ MOLTMONEY_ENABLED: undefined });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    expect(names).toContain("moltmoney_get_balance");
    expect(names).not.toContain("moltmoney_create_paypal_order");
    expect(names).not.toContain("moltmoney_capture_paypal_order");
    expect(names).not.toContain("moltmoney_get_payment");
  });

  it("registers NO MoltMoney tools when MOLTMONEY_ENABLED=false (kill switch)", async () => {
    setEnv({ MOLTMONEY_ENABLED: "false" });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    expect(names.filter((n) => n.startsWith("moltmoney_"))).toEqual([]);
  });
});

describe("Sentinel classification for finance actions", () => {
  it("finance.read is allow/low and finance.pay is ask/high", async () => {
    const { classify } = await import("../src/lib/sentinel");
    expect(classify("finance.read")).toMatchObject({ decision: "allow", risk: "low" });
    expect(classify("finance.pay")).toMatchObject({ decision: "ask", risk: "high" });
  });
});
