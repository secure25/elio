import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";

import { configuredProviders, getAdapter } from "../src/lib/llm/index";
import { openAIResponsesAdapter } from "../src/lib/llm/responses";

// AgentRouter and APInex are both gateways whose host is account-specific, so
// the provider must read base URL + key from env instead of hardcoding a
// hostname.

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

// AgentRouter only serves /v1/responses (chat/completions answers "model does not
// support this endpoint") and wants a recognised client, so the adapter, the
// endpoint and the request shape all matter for a call to succeed at all.
describe("Responses API adapter (agentrouter)", () => {
  const fetchMock = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    fetchMock.mockReset();
  });

  const ok = (output: unknown[]) =>
    new Response(JSON.stringify({ status: "completed", output, usage: { input_tokens: 11, output_tokens: 7 } }), {
      status: 200,
    });

  const adapter = () =>
    openAIResponsesAdapter({
      provider: "agentrouter",
      apiKey: "ar_test_key",
      model: "gpt-test",
      baseUrl: "https://gateway.example.com/v1",
      headers: { "User-Agent": "claude-cli/test" },
    });

  it("posts to /responses with a client-recognisable User-Agent and flat tools", async () => {
    fetchMock.mockResolvedValue(ok([{ type: "message", content: [{ type: "output_text", text: "hi" }] }]));

    const res = await adapter().complete([{ role: "system", content: "be terse" }, { role: "user", content: "hello" }], {
      tools: [{ name: "list_files", description: "list", parameters: { type: "object", properties: {} } }],
      temperature: 0.4,
    });

    expect(res.text).toBe("hi");
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gateway.example.com/v1/responses");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("claude-cli/test");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ar_test_key");

    const body = JSON.parse(String(init.body));
    expect(body.instructions).toBe("be terse");
    expect(body.temperature).toBeUndefined(); // rejected by gpt-5*/gpt-6* models
    expect(body.tools).toEqual([
      { type: "function", name: "list_files", description: "list", parameters: { type: "object", properties: {} } },
    ]);
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hello" }] }]);
  });

  it("round-trips tool calls as function_call / function_call_output items", async () => {
    fetchMock.mockResolvedValue(
      ok([
        { type: "reasoning", summary: [] },
        { type: "function_call", call_id: "call_1", name: "list_files", arguments: '{"dir":"/etc"}' },
      ])
    );

    const first = await adapter().complete([{ role: "user", content: "list /etc" }], {});
    expect(first.toolCalls).toEqual([{ id: "call_1", name: "list_files", args: '{"dir":"/etc"}' }]);

    fetchMock.mockResolvedValue(ok([{ type: "message", content: [{ type: "output_text", text: "3 files" }] }]));
    const second = await adapter().complete(
      [
        { role: "user", content: "list /etc" },
        { role: "assistant", content: "", toolCalls: first.toolCalls },
        { role: "tool", content: "hosts\npasswd", toolCallId: "call_1", toolName: "list_files" },
      ],
      {}
    );

    expect(second.text).toBe("3 files");
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "list /etc" }] },
      { type: "function_call", call_id: "call_1", name: "list_files", arguments: '{"dir":"/etc"}' },
      { type: "function_call_output", call_id: "call_1", output: "hosts\npasswd" },
    ]);
  });

  it("appends a trailing turn after tool output when the gateway needs one", async () => {
    fetchMock.mockImplementation(async () => ok([{ type: "message", content: [{ type: "output_text", text: "hi" }] }]));

    // AgentRouter returns an empty message when function_call_output is last.
    const nudging = openAIResponsesAdapter({
      provider: "agentrouter",
      apiKey: "ar_test_key",
      model: "gpt-test",
      baseUrl: "https://gateway.example.com/v1",
      continueAfterToolOutput: true,
    });

    await nudging.complete([
      { role: "user", content: "search" },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "web_search", args: "{}" }] },
      { role: "tool", content: "[]", toolCallId: "call_1", toolName: "web_search" },
    ], {});

    const withTool = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(withTool.input.at(-1)).toEqual({ role: "user", content: [{ type: "input_text", text: "Continue." }] });

    // …but never on a turn that has no tool output to continue from.
    await nudging.complete([{ role: "user", content: "hello" }], {});
    const plain = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(plain.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hello" }] }]);
  });

  it("reports the HTTP status so a capacity wall can cascade to the next provider", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "no available channel" } }), { status: 503 })
    );

    await expect(adapter().complete([{ role: "user", content: "hi" }], {})).rejects.toThrow(
      /HTTP 503.*no available channel/
    );
  });
});
