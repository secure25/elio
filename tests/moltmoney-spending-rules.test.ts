// ── Option A: moltmoney_get_spending_rules (fail-closed policy view) ──────
// All network mocked via fetch stub; no DB, no PayPal, no MoltMoney server.
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

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}) {
  process.env.MOLTMONEY_API_URL = overrides.MOLTMONEY_API_URL ?? URL_;
  process.env.MOLTMONEY_API_KEY = overrides.MOLTMONEY_API_KEY ?? KEY;
  process.env.MOLTMONEY_ACCOUNT_ID = overrides.MOLTMONEY_ACCOUNT_ID ?? ACC;
  process.env.MOLTMONEY_ENABLED = overrides.MOLTMONEY_ENABLED;
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function accountBody(spendingRules: unknown) {
  return {
    id: ACC,
    type: "AGENT",
    balance: "5.00",
    currency: "USD",
    status: "ACTIVE",
    spendingRules,
    accountNumber: "MOLT-C7B93537-0D25524F-F14E35E8",
    agentId: "ee7f7847-be73-40be-9836-480b7e0df8ed",
    createdAt: "2026-10-05T09:31:43.383Z",
  };
}

/** GET /accounts/{id}/spending-policy response (Option B). */
function policyBody(spendingRules: unknown, usage: { spentToday?: string; remainingToday?: string | null; serverTime?: string } = {}) {
  return {
    accountId: ACC,
    currency: "USD",
    rules: spendingRules,
    spentToday: usage.spentToday ?? "5.00",
    remainingToday: usage.remainingToday !== undefined ? usage.remainingToday : "45.00",
    serverTime: usage.serverTime ?? "2026-10-08T15:30:00.000Z",
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  setEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("moltmoneyGetSpendingRules (Option A, read-only)", () => {
  it("formats the full policy + server-computed daily usage from GET /accounts/{id}/spending-policy with Bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(
        200,
        policyBody(
          {
            perTransactionLimit: 5,
            dailyLimit: 5,
            requireApprovalAbove: 6,
            blockedCategories: ["gambling", "alcohol", "dangerous goods"],
          },
          { spentToday: "2.50", remainingToday: "2.50", serverTime: "2026-10-08T15:30:00.000Z" }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain(`Spending policy (MoltMoney, account ${ACC})`);
    expect(out).toContain("- per-transaction limit: 5 USD");
    expect(out).toContain("- daily limit: 5 USD");
    expect(out).toContain("- requires owner approval above: 6 USD");
    expect(out).toContain("- blocked categories: gambling, alcohol, dangerous goods");
    // server-computed daily usage (authoritative — Elio must not derive it itself)
    expect(out).toContain("- spent today: 2.50 USD (server-computed by MoltMoney — authoritative)");
    expect(out).toContain("- remaining today: 2.50 USD");
    expect(out).toContain("- server time: 2026-10-08T15:30:00.000Z");
    expect(out).toContain("Fail-closed");
    // policy semantics: blocked categories = hard prohibition (never approval);
    // monetary rules = soft approval policy. Wording must not conflate them.
    expect(out).toContain("HARD PROHIBITION");
    expect(out).toContain("hard stops, NOT approval cases");
    expect(out).toContain("no Sentinel approval request, no MoltMoney call, no PayPal order");
    expect(out).toContain("REQUIRES a merchantCategory on every PayPal order");
    expect(out).toContain("SOFT APPROVAL POLICY");
    expect(out).toContain("owner approval before capture");
    expect(out).toContain("not the security control");
    // hits the dedicated authenticated endpoint with the agent's own key
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(`${URL_}/accounts/${ACC}/spending-policy`);
    expect((init as any).headers.Authorization).toBe(`Bearer ${KEY}`);
    // nothing sensitive echoed; accountNumber deliberately omitted
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("MOLT-C7B93537-0D25524F-F14E35E8");
  });

  it("null remainingToday → reports unlimited without inventing a number", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, policyBody({ dailyLimit: 5 }, { spentToday: "1.00", remainingToday: null }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("- remaining today: unlimited (no daily limit configured server-side)");
    expect(out).not.toMatch(/remaining today: \d/);
  });

  it("shows only the fields present (partial rules) and invents nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, policyBody({ perTransactionLimit: 25 }, { spentToday: "3.00", remainingToday: null }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("- per-transaction limit: 25 USD");
    expect(out).not.toContain("daily limit:");
    expect(out).not.toContain("blocked categories:");
    expect(out).not.toContain("requires owner approval above:");
    expect(out).toContain("- spent today: 3.00 USD");
  });

  it("no rules configured → says so without implying 'everything is allowed'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, policyBody(null)));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("No spending rules configured");
    expect(out).toContain("Sentinel approval is still required");
    expect(out).toContain("Fail-closed");
  });

  it("empty rules object → same as no rules configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, policyBody({})));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("No spending rules configured");
  });

  it("falls back to GET /accounts/{id} (daily usage NOT computed) when the policy endpoint 404s", async () => {
    const fetchMock = vi.fn().mockImplementation((url: any) => {
      const u = String(url);
      if (u.endsWith(`/accounts/${ACC}/spending-policy`)) {
        return Promise.resolve(res(404, { error: { code: "NOT_FOUND", message: "Route not found: 404" } }));
      }
      if (u.endsWith(`/accounts/${ACC}`)) {
        return Promise.resolve(res(200, accountBody({ perTransactionLimit: 25 })));
      }
      return Promise.resolve(res(404, { message: `unexpected fetch: ${u}` }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("- per-transaction limit: 25 USD");
    // fallback view explicitly says daily usage was NOT computed server-side
    expect(out).toContain("NOT computed");
    expect(out).toContain("moltmoney_get_transactions");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("401 → POLICY UNAVAILABLE, explicitly forbids assuming permission, never leaks the key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("POLICY UNAVAILABLE");
    expect(out).toContain("Do NOT assume spending is permitted");
    expect(out).toContain("401");
    expect(out).not.toContain(KEY);
  });

  it("500 with non-JSON body → POLICY UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500, "<html>gateway error</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("POLICY UNAVAILABLE");
    expect(out).not.toContain(KEY);
  });

  it("network failure / timeout → POLICY UNAVAILABLE (fail-closed), never throws", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("POLICY UNAVAILABLE");
    expect(out).toContain("unreachable");
    expect(out).not.toContain(KEY);
  });

  it("malformed rules payload (non-object) → POLICY UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, policyBody("oops")));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetSpendingRules();
    expect(out).toContain("POLICY UNAVAILABLE");
    expect(out).toContain("unparseable");
  });

  it("is registered as a read-only tool; create-order description points at it", async () => {
    // The money tool gate requires MOLTMONEY_ENABLED === "true" explicitly.
    setEnv({ MOLTMONEY_ENABLED: "true" });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const defs = toolDefs();
    const def = defs.find((d) => d.name === "moltmoney_get_spending_rules");
    expect(def).toBeTruthy();
    expect(def?.description).toContain("BEFORE");
    expect(def?.description).toContain("Read-only");
    // constraint 6: the money tool instructs checking the policy tool first
    const create = defs.find((d) => d.name === "moltmoney_create_paypal_order");
    expect(create?.description).toContain("moltmoney_get_spending_rules");
    // constraint 7: the policy tool stays outside the finance.pay approval gate
    expect(def?.description).not.toContain("HUMAN APPROVAL");
  });
});
