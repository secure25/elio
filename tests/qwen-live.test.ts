import { describe, it, expect } from "vitest";

// Live integration test for the temporary Qwen provider (Kaggle + Cloudflare
// tunnel, OpenAI-compatible). Skips automatically when the token or base URL
// is not configured — CI and offline machines are unaffected.
process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";

import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import { openAICompatibleAdapter } from "../src/lib/llm/openai-compatible";
import { toolDefs } from "../src/lib/agent/tools";
import { configuredProviders, getAdapter } from "../src/lib/llm/index";

const liveReady = Boolean(process.env.QWEN_API_TOKEN && process.env.QWEN_BASE_URL);

describe("Qwen provider composition (offline, no network)", () => {
  it("is recognized by the existing provider selection/failover chain", () => {
    const providers = configuredProviders();
    if (liveReady) {
      expect(providers).toContain("qwen");
      // LLM_PROVIDER=qwen puts Qwen first, existing providers behind it.
      if ((process.env.LLM_PROVIDER || "").toLowerCase() === "qwen") {
        expect(providers[0]).toBe("qwen");
        expect(providers.length).toBeGreaterThanOrEqual(2); // failover intact
        const adapter = getAdapter();
        expect(adapter.provider).toContain("qwen");
        expect(adapter.model).toBe(process.env.QWEN_MODEL || "Qwen/Qwen3-8B");
      }
    } else {
      // Unconfigured (no token/base URL) → qwen is correctly absent, like
      // every other provider missing its key.
      expect(providers).not.toContain("qwen");
    }
  });
});

describe.skipIf(!liveReady)("Qwen live endpoint (tunnel)", () => {
  it("normalizes tool_calls into Elio's ToolCall representation via the shared adapter", async () => {
    const adapter = openAICompatibleAdapter({
      provider: "qwen",
      apiKey: process.env.QWEN_API_TOKEN!,
      model: process.env.QWEN_MODEL || "Qwen/Qwen3-8B",
      baseUrl: process.env.QWEN_BASE_URL!,
    });
    const defs = toolDefs();
    const search = defs.find((t) => t.name === "web_search") ?? defs[0];

    try {
      const res = await adapter.complete(
        [{ role: "user", content: `What is the weather in Cape Town today? Use the ${search.name} tool.` }],
        { tools: [search], temperature: 0.2, maxTokens: 2048 }
      );

      // The adapter must hand the loop normalized internal ToolCalls:
      expect(Array.isArray(res.toolCalls)).toBe(true);
      expect(res.toolCalls.length).toBeGreaterThan(0);
      for (const tc of res.toolCalls) {
        expect(typeof tc.id).toBe("string");
        expect(typeof tc.name).toBe("string");
        expect(typeof tc.args).toBe("string");
      }
      console.log("live tool_calls:", JSON.stringify(res.toolCalls, null, 2));
      console.log("usage:", JSON.stringify(res.usage));
    } catch (e: any) {
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|timeout/i.test(e.message)) {
        console.warn("Skipping live Qwen tunnel test: endpoint is currently offline/unreachable.");
        return;
      }
      throw e;
    }
  }, 120_000);
});
