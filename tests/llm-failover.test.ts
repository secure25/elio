import { beforeEach, describe, expect, it, vi } from "vitest";

// A depleted provider account (no tokens / no balance) must cascade like a
// quota wall instead of failing every task — the hosted demo hit exactly this:
// CodeCraft returned "Insufficient plan tokens or account balance" and the
// whole agent stopped answering even though another provider was configured.

const state = vi.hoisted(() => ({ codecraftError: "" }));

vi.mock("../src/lib/llm/gemini", () => ({
  geminiAdapter: () => ({
    provider: "gemini",
    model: "gemini-test",
    complete: async () => ({
      text: "answer from gemini",
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1 },
    }),
  }),
}));

vi.mock("../src/lib/llm/openai-compatible", () => ({
  openAICompatibleAdapter: (cfg: { provider: string; model: string }) => ({
    provider: cfg.provider,
    model: cfg.model,
    complete: async () => {
      throw new Error(state.codecraftError);
    },
  }),
}));

import { getAdapter } from "../src/lib/llm";

const messages = [{ role: "user" as const, content: "hi" }];

beforeEach(() => {
  process.env.LLM_PROVIDER = "codecraft";
  process.env.CODECRAFT_API_KEY = "cc_test_key";
  process.env.GEMINI_API_KEY = "gemini_test_key";
  delete process.env.CLEANAPIS_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.QWEN_API_TOKEN;
  delete process.env.QWEN_BASE_URL;
  state.codecraftError = "";
});

describe("LLM failover chain", () => {
  it("cascades to the next provider when the primary account is out of balance", async () => {
    state.codecraftError =
      "codecraft API error: Insufficient plan tokens or account balance. Please upgrade your plan or top up your balance at https://codecraftapi.com/dashboard/billing/plan.";

    const response = await getAdapter().complete(messages, {});

    expect(response.text).toBe("answer from gemini");
  });

  it("treats 'payment required' and quota walls as failover-worthy too", async () => {
    for (const message of [
      "402 Payment Required: account balance exhausted",
      "insufficient_quota: you have no credits remaining",
    ]) {
      state.codecraftError = message;
      const response = await getAdapter().complete(messages, {});
      expect(response.text).toBe("answer from gemini");
    }
  });

  it("does not hide a genuine request error behind another provider", async () => {
    state.codecraftError = "invalid_request_error: messages must not be empty";

    await expect(getAdapter().complete(messages, {})).rejects.toThrow(
      /messages must not be empty/
    );
  });
});
