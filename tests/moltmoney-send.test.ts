// ── MoltMoney Phase 2A tests: internal transfer via POST /payments/send ──
// All network mocked; Sentinel approvals settled inline like the pay tests.
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
const CTX = { taskId: null, conversationId: "conv-mm-send-tests" };

/** Sentinel approvals FK-reference conversations; create the test conversation once. */
async function ensureConversation() {
  const { db, now } = await import("../src/lib/db");
  db.prepare(
    "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)"
  ).run(CTX.conversationId, "MoltMoney send tests", now(), now());
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

const SEND_OK = {
  transaction: {
    id: "tx-send-1",
    amount: "5.00",
    type: "OUTBOUND",
    status: "PENDING",
    approvalRequired: false,
    description: "rent share",
    merchantName: null,
    createdAt: "2026-10-08T12:00:00Z",
  },
};

/** Route the pre-Sentinel policy GET (GET /accounts/{id}) and the send POST to different payloads. */
function routeFetch(fetchMock: any, account: unknown, send: () => any) {
  fetchMock.mockImplementation((url: any, init: any) => {
    const u = String(url);
    if (u.includes("/payments/send")) return Promise.resolve(send());
    if (u.includes(`/accounts/${ACC}`)) return Promise.resolve(res(200, account));
    return Promise.resolve(res(404, { message: `unexpected fetch: ${u}` }));
  });
}

function sendPostCalls(fetchMock: any): any[] {
  return fetchMock.mock.calls.filter(
    (c: any[]) => String(c[0]).includes("/payments/send") && (c[1] as any)?.method === "POST"
  );
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

describe("moltmoney_send_payment (Sentinel-gated internal transfer, no retry)", () => {
  it("waits for Sentinel approval, then POSTs /payments/send exactly once with the correct body", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => res(201, SEND_OK));
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneySendPayment(CTX, {
      amount: "5.00",
      toAccountId: "a1b2c3d4-0000-0000-0000-000000000000",
      description: "rent share",
    });
    await settlePending(true); // human approves via the approval card
    const out = await pending;

    expect(out).toContain("tx-send-1");
    expect(out).toContain("PENDING");
    expect(out).toContain("5.00");
    expect(out).toContain("moltmoney_get_payment");

    // 2 calls total: the pre-Sentinel policy GET + exactly one send POST (no retries, ever).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendPostCalls(fetchMock)).toHaveLength(1);
    const [calledUrl, init] = sendPostCalls(fetchMock)[0];
    expect(String(calledUrl)).toBe(`${URL_}/payments/send`);
    expect((init as any).method).toBe("POST");
    expect(JSON.parse((init as any).body)).toEqual({
      amount: "5.00", // string, not float
      toAccountId: "a1b2c3d4-0000-0000-0000-000000000000",
      description: "rent share",
    });
    expect((init as any).headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("does NOT call MoltMoney when the human denies the approval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () => res(201, SEND_OK));
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneySendPayment(CTX, { amount: "5.00" });
    await settlePending(false); // human denies
    const out = await pending;

    expect(out).toContain("NOT started");
    expect(out).toContain("No money moved");
    // Only the read-only policy GET happened; the send was NEVER attempted.
    expect(sendPostCalls(fetchMock)).toHaveLength(0);
  });

  it("rejects invalid amounts BEFORE Sentinel with zero network calls and no approval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    expect(await mm.moltmoneySendPayment(CTX, { amount: "-1" })).toContain("Invalid amount");
    expect(await mm.moltmoneySendPayment(CTX, { amount: "abc" })).toContain("Invalid amount");
    expect(await mm.moltmoneySendPayment(CTX, { amount: "1e9" })).toContain("Invalid amount");
    expect(await mm.moltmoneySendPayment(CTX, {})).toContain("Invalid amount");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("refuses a blocked merchantCategory BEFORE Sentinel: no approval request, no send POST", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => {
      throw new Error("send POST must never happen for a blocked category");
    });
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneySendPayment(CTX, {
      amount: "5.00",
      merchantCategory: "gambling",
    });

    expect(out).toContain("BLOCKED CATEGORY");
    expect(out).toContain("hard prohibition");
    expect(out).toContain("no Sentinel approval request was created");
    // Only the read-only policy GET happened.
    expect(sendPostCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("does NOT require merchantCategory for internal transfers even when blocked categories are configured", async () => {
    // Unlike the PayPal purchase flow, an internal transfer has no merchant:
    // a missing category is NOT a policy failure here.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_WITH_BLOCKED), () => res(201, SEND_OK));
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneySendPayment(CTX, { amount: "5.00", description: "no merchant exists" });
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("tx-send-1");
    expect(sendPostCalls(fetchMock)).toHaveLength(1);
    const body = JSON.parse((sendPostCalls(fetchMock)[0] as any[])[1].body);
    expect(body.merchantCategory).toBeUndefined();
  });

  it("fails closed when the policy cannot be retrieved (no approval, no send)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500, "<html>bad gateway</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const { listApprovals } = await import("../src/lib/sentinel");
    const mm = await import("../src/lib/connectors/moltmoney");

    const out = await mm.moltmoneySendPayment(CTX, { amount: "5.00" });

    expect(out).toContain("POLICY UNAVAILABLE");
    expect(out).toContain("do not assume spending is permitted");
    expect(sendPostCalls(fetchMock)).toHaveLength(0);
    expect((listApprovals("pending") as any[]).length).toBe(0);
  });

  it("maps a SPENDING_RULE_VIOLATION 400 to a fail-closed result and NEVER retries (exactly one call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(
      fetchMock,
      accountPayload(RULES_NO_BLOCKED),
      () => res(400, { error: { code: "SPENDING_RULE_VIOLATION", message: "Spending rule violation: daily limit exceeded" } })
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneySendPayment(CTX, { amount: "5.00" });
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("400");
    expect(out).toContain("Spending rule violation");
    expect(out).toContain("NOT completed");
    expect(sendPostCalls(fetchMock)).toHaveLength(1); // proof: no retry after failure
  });

  it("surfaces MoltMoney's server-side owner approval hold instead of treating the send as complete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    routeFetch(fetchMock, accountPayload(RULES_NO_BLOCKED), () =>
      res(201, { ...SEND_OK, transaction: { ...SEND_OK.transaction, approvalRequired: true } })
    );
    const mm = await import("../src/lib/connectors/moltmoney");

    const pending = mm.moltmoneySendPayment(CTX, { amount: "5.00" });
    await settlePending(true);
    const out = await pending;

    expect(out).toContain("OWNER APPROVAL REQUIRED");
    expect(out).toContain("NOT complete yet");
    expect(out).toContain("do not re-send");
  });
});
