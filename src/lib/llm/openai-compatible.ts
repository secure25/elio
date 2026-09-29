// OpenAI-compatible chat-completions adapter (works for Groq and OpenRouter free models).
import type { LLMAdapter, LLMMessage, LLMResponse, ToolDef, ToolCall } from "./types";

export function openAICompatibleAdapter(opts: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}): LLMAdapter {
  return {
    provider: opts.provider,
    model: opts.model,
    async complete(messages, { tools, temperature, maxTokens }): Promise<LLMResponse> {
      const wire = messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === "assistant" && m.toolCalls?.length) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.args },
            })),
          };
        }
        return { role: m.role, content: m.content };
      });

      const body: Record<string, unknown> = {
        model: opts.model,
        messages: wire,
        temperature: temperature ?? 0.4,
        max_tokens: maxTokens ?? 8192,
      };
      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      // Resilience: (a) retry once on transient transport failures (a dropped
      // connection to a self-hosted endpoint killed the whole task otherwise);
      // (b) a 300s hard timeout so a hung endpoint fails cleanly instead of
      // hanging forever. Retries only the POST — never the response parsing —
      // and is safe because these requests are idempotent completions calls.
      const post = () =>
        fetch(`${opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000),
        });
      let res: Response;
      try {
        res = await post();
      } catch (e: unknown) {
        const transient = e instanceof Error && /fetch failed|network|ECONN|terminated|timeout|aborted/i.test(String(e.message));
        if (!transient) throw e;
        await new Promise((r) => setTimeout(r, 2000));
        res = await post();
      }

      // If rate-limited (429), respect retry headers and retry once before erroring or failing over.
      if (res.status === 429) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryTokensHeader = res.headers.get("x-ratelimit-reset-tokens");
        let delayMs = 3000;
        if (retryAfterHeader) {
          const parsed = parseFloat(retryAfterHeader);
          if (!isNaN(parsed) && parsed > 0) delayMs = Math.min(Math.ceil(parsed * 1000) + 500, 10_000);
        } else if (retryTokensHeader) {
          const parsed = parseFloat(retryTokensHeader.replace("s", ""));
          if (!isNaN(parsed) && parsed > 0) delayMs = Math.min(Math.ceil(parsed * 1000) + 500, 10_000);
        }
        await new Promise((r) => setTimeout(r, delayMs));
        res = await post();
      }

      const rawText = await res.text();
      let json: {
        choices?: { message?: { content?: string | null; tool_calls?: [] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(
          `${opts.provider} returned non-JSON response (HTTP ${res.status}): ${
            res.statusText || rawText.slice(0, 100).replace(/\s+/g, " ")
          }`
        );
      }

      if (!res.ok || json.error) {
        throw new Error(`${opts.provider} API error: ${json.error?.message || res.status}`);
      }
      const msg = json.choices?.[0]?.message ?? {};
      const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any, i: number) => ({
        id: tc.id || `call_${Date.now()}_${i}`,
        name: tc.function?.name,
        args: tc.function?.arguments || "{}",
      }));
      return {
        text: msg.content ?? "",
        toolCalls,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
