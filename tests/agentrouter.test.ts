import { beforeEach, describe, expect, it } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";

import { configuredProviders, getAdapter } from "../src/lib/llm/index";

// AgentRouter and APInex are both OpenAI-compatible gateways whose host is
// account-specific, so the provider must read base URL + key from env instead
// of hardcoding a hostname.

describe("gateway providers (agentrouter / apinex)", () => {
  beforeEach(() => {
    delete process.env.CODECRAFT_API_KEY;
    delete process.env.CLEANAPIS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.QWEN_API_TOKEN;
    delete process.env.QWEN_BASE_URL;
    delete process.env.APINEX_API_KEY;
    delete process.env.AGENTROUTER_API_KEY;
    delete process.env.AGENTROUTER_BASE_URL;
  });

  it("selects agentrouter when its key and base URL are configured", () => {
    process.env.LLM_PROVIDER = "agentrouter";
    process.env.AGENTROUTER_API_KEY = "ar_test_key";
    process.env.AGENTROUTER_BASE_URL = "https://gateway.example.com/v1/";
    process.env.AGENTROUTER_MODEL = "claude-test-model";

    expect(configuredProviders()).toEqual(["agentrouter"]);

    const adapter = getAdapter();
    expect(adapter.provider).toBe("agentrouter");
    expect(adapter.model).toBe("claude-test-model");
  });

  it("skips agentrouter until the base URL is supplied", () => {
    process.env.LLM_PROVIDER = "agentrouter";
    process.env.AGENTROUTER_API_KEY = "ar_test_key";

    expect(configuredProviders()).not.toContain("agentrouter");
  });

  it("defaults APInex to the documented OpenAI-compatible base URL", () => {
    process.env.LLM_PROVIDER = "apinex";
    process.env.APINEX_API_KEY = "sk-apx-test";

    expect(configuredProviders()).toEqual(["apinex"]);
    const adapter = getAdapter();
    expect(adapter.provider).toBe("apinex");
    expect(adapter.model).toBe("claude-sonnet-4-5");
  });

  it("orders gateways ahead of the free-tier providers in the failover chain", () => {
    process.env.LLM_PROVIDER = "codecraft";
    process.env.CODECRAFT_API_KEY = "cc_test";
    process.env.AGENTROUTER_API_KEY = "ar_test";
    process.env.AGENTROUTER_BASE_URL = "https://gateway.example.com/v1";
    process.env.GEMINI_API_KEY = "gemini_test";

    expect(configuredProviders()).toEqual(["codecraft", "agentrouter", "gemini"]);
  });
});
