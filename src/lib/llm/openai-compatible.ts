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

      const res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: [] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
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
