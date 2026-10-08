// ── MoltMoney connector + tool registration tests (all network mocked) ──
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

describe("moltmoney connector (read-only, Phase 1)", () => {
  it("fails closed with a clear message and zero fetch calls when not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    setEnv({ MOLTMONEY_API_URL: "" });
    const out = await mm.moltmoneyGetBalance();
    expect(out).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kill switch MOLTMONEY_ENABLED=false disables the connector even with creds", async () => {
    setEnv({ MOLTMONEY_ENABLED: "false" });
    const mm = await import("../src/lib/connectors/moltmoney");
    expect(mm.moltmoneyConfigured()).toBe(false);
  });

  it("moltmoneyConfigured is true when creds present and no kill switch", async () => {
    const mm = await import("../src/lib/connectors/moltmoney");
    expect(mm.moltmoneyConfigured()).toBe(true);
  });

  it("get_account sends Bearer auth to /accounts/{id} and formats the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, {
        id: ACC,
        type: "AGENT",
        balance: "0",
        currency: "USD",
        status: "ACTIVE",
        spendingRules: null,
        accountNumber: "MOLT-C7B93537-0D25524F-F14E35E8",
        agentId: "ee7f7847-be73-40be-9836-480b7e0df8ed",
        createdAt: "2026-10-05T09:31:43.383Z",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetAccount();
    expect(out).toContain("AGENT");
    expect(out).toContain("ACTIVE");
    expect(out).toContain("MOLT-C7B93537-0D25524F-F14E35E8");
    expect(out).toContain(`balance: 0 USD`);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(`${URL_}/accounts/${ACC}`);
    expect((init as any).headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("get_balance uses the dedicated balance endpoint and keeps amounts as strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, { accountId: ACC, balance: "0.00", currency: "USD", status: "ACTIVE" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetBalance();
    expect(out).toContain("0.00 USD");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_}/accounts/${ACC}/balance`);
  });

  it("get_transactions hits /transactions with accountId + pageSize, empty list message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, { data: [], total: 0, page: 1, pageSize: 10, hasMore: false })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetTransactions();
    expect(out).toMatch(/No MoltMoney transactions yet\./);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain(`${URL_}/transactions?`);
    expect(calledUrl).toContain(`accountId=${ACC}`);
    expect(calledUrl).toContain("pageSize=10");
  });

  it("get_transactions lists rows when data exists and clamps limit to 1..50", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res(200, {
        data: [
          {
            id: "tx_1",
            direction: "DEBIT",
            amount: "5.00",
            currency: "USD",
            status: "COMPLETED",
            createdAt: "2026-10-05T10:00:00Z",
            description: "sandbox test payment",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 5,
        hasMore: false,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetTransactions(500);
    expect(out).toContain("tx_1");
    expect(out).toContain("5.00 USD");
    expect(out).toContain("sandbox test payment");
    expect(String(fetchMock.mock.calls[0][0])).toContain("pageSize=50");
  });

  it("401 → fail-closed error that never contains the API key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetAccount();
    expect(out).toContain("401");
    expect(out).toContain("Invalid token");
    expect(out).not.toContain(KEY);
  });

  it("500 with non-JSON body → fail-closed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500, "<html>gateway error</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetBalance();
    expect(out).toContain("500");
    expect(out).not.toContain(KEY);
  });

  it("200 with non-JSON body → fail-closed (unexpected response)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, "ok"));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetBalance();
    expect(out).toContain("unexpected");
  });

  it("network failure / abort → fail-closed 'unreachable', never throws", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);
    const mm = await import("../src/lib/connectors/moltmoney");
    const out = await mm.moltmoneyGetBalance();
    expect(out).toContain("unreachable");
    expect(out).not.toContain(KEY);
  });
});

describe("moltmoney tool registration gating", () => {
  it("registers the three read-only tools when configured", async () => {
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    expect(names).toContain("moltmoney_get_account");
    expect(names).toContain("moltmoney_get_balance");
    expect(names).toContain("moltmoney_get_transactions");
    expect(names).toContain("moltmoney_get_spending_rules");
  });

  it("does not register them when MOLTMONEY_ENABLED=false", async () => {
    setEnv({ MOLTMONEY_ENABLED: "false" });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    expect(names).not.toContain("moltmoney_get_account");
    expect(names).not.toContain("moltmoney_get_balance");
    expect(names).not.toContain("moltmoney_get_transactions");
    expect(names).not.toContain("moltmoney_get_spending_rules");
  });

  it("does not register them when creds are missing", async () => {
    setEnv({ MOLTMONEY_API_KEY: "" });
    const { toolDefs } = await import("../src/lib/agent/tools");
    const names = toolDefs().map((d) => d.name);
    expect(names).not.toContain("moltmoney_get_account");
    expect(names).not.toContain("moltmoney_get_balance");
    expect(names).not.toContain("moltmoney_get_transactions");
    expect(names).not.toContain("moltmoney_get_spending_rules");
  });
});
