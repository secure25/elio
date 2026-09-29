import { describe, it, expect } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.CLEANAPIS_API_KEY = "cc_test_key_for_unit_tests";
process.env.CLEANAPIS_MODEL = "kimi-k2.6";

import { configuredProviders, getAdapter } from "../src/lib/llm/index";
import { openAICompatibleAdapter } from "../src/lib/llm/openai-compatible";

describe("Clean APIs provider configuration", () => {
  it("is recognized by the provider selection chain", () => {
    const providers = configuredProviders();
    expect(providers).toContain("cleanapis");
  });

  it("builds an adapter targeting https://cleanapis.com/v1 with the cheapest tools+web model", () => {
    const adapter = openAICompatibleAdapter({
      provider: "cleanapis",
      apiKey: "cc_test_key",
      model: "kimi-k2.6",
      baseUrl: "https://cleanapis.com/v1",
    });
    expect(adapter.provider).toBe("cleanapis");
    expect(adapter.model).toBe("kimi-k2.6");
  });
});
