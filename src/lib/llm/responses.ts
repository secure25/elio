// OpenAI *Responses* API adapter (`POST {baseUrl}/responses`).
//
// Needed because some gateways only expose their models through /v1/responses:
// AgentRouter answers every /v1/chat/completions request with
// "model X does not support /v1/chat/completions — use /v1/responses", and
// /v1/messages has no channel for the models the account can actually reach.
//
// The agent loop is unchanged: this adapter maps Elio's LLMMessage[] onto
// Responses `input` items and maps the response's `output` items back onto the
// same { text, toolCalls } shape the chat-completions adapter returns.
import type { LLMAdapter, LLMMessage, LLMResponse, ToolCall } from "./types";

export function openAIResponsesAdapter(opts: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Extra headers — gateways with a client gate need a recognised User-Agent. */
  headers?: Record<string, string>;
  /**
   * Gateways in front of reasoning models (AgentRouter's gpt-5.6-sol / gpt-6-*)
   * answer a request whose last input item is a `function_call_output` with an
   * empty message (reasoning tokens spent, zero text, no tool call) — which
   * reads to the agent loop as "(no content)" and kills every tool-using task.
   * A trailing user turn makes the same request return a normal answer, so we
   * append one after tool output when the gateway needs it.
   */
  continueAfterToolOutput?: boolean;
}): LLMAdapter {
  return {
    provider: opts.provider,
    model: opts.model,
    async complete(messages, { tools, maxTokens }): Promise<LLMResponse> {
      // System prompts ride in `instructions`; the Responses API treats them the
      // same as a system message and it keeps the `input` items uniform.
      const instructions = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");

      const input: Record<string, unknown>[] = [];
      for (const m of messages) {
        if (m.role === "system") continue;
        if (m.role === "user") {
          input.push({ role: "user", content: [{ type: "input_text", text: m.content }] });
        } else if (m.role === "assistant") {
          if (m.content.trim()) {
            input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
          }
          // Calls are replayed as their own items, in order, so the following
          // function_call_outputs can pair with them by call_id.
          for (const tc of m.toolCalls ?? []) {
            input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: tc.args });
          }
        } else if (m.role === "tool") {
          input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
        }
      }

      // See continueAfterToolOutput: without a trailing turn some gateways
      // answer a tool result with an empty message and no tool call.
      if (opts.continueAfterToolOutput && input.at(-1)?.type === "function_call_output") {
        input.push({ role: "user", content: [{ type: "input_text", text: "Continue." }] });
      }

      const body: Record<string, unknown> = {
        model: opts.model,
        input,
        max_output_tokens: maxTokens ?? 8192,
        // NOTE: no temperature — reasoning-style models (gpt-5*/gpt-6*) reject it
        // with "Unsupported parameter: 'temperature' is not supported".
      };
      if (instructions) body.instructions = instructions;
      if (tools && tools.length > 0) {
        // Responses takes tools flat: { type: "function", name, description, parameters }.
        body.tools = tools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        body.tool_choice = "auto";
      }

      const post = () =>
        fetch(`${opts.baseUrl}/responses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
            ...opts.headers,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000),
        });

      // Same resilience as the chat-completions adapter: one retry on a dropped
      // connection, plus a hard timeout so a hung gateway fails cleanly.
      let res: Response;
      try {
        res = await post();
      } catch (e: unknown) {
        const transient =
          e instanceof Error && /fetch failed|network|ECONN|terminated|timeout|aborted/i.test(String(e.message));
        if (!transient) throw e;
        await new Promise((r) => setTimeout(r, 2000));
        res = await post();
      }

      const rawText = await res.text();
      let json: {
        status?: string;
        output?: any[];
        usage?: { input_tokens?: number; output_tokens?: number };
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

      // The status is part of the message so the failover chain can tell a
      // capacity/quota wall (429/5xx → try the next provider) from a bad request.
      if (!res.ok || json.error) {
        throw new Error(`${opts.provider} API error (HTTP ${res.status}): ${json.error?.message || res.statusText}`);
      }

      const output = json.output ?? [];
      const text = output
        .filter((item) => item?.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((part: any) => part?.type === "output_text" || part?.type === "text")
        .map((part: any) => part.text ?? "")
        .join("\n")
        .trim();

      const toolCalls: ToolCall[] = output
        .filter((item) => item?.type === "function_call")
        .map((item, i) => ({
          id: item.call_id || item.id || `call_${Date.now()}_${i}`,
          name: item.name,
          args: item.arguments || "{}",
        }));

      return {
        text,
        toolCalls,
        usage: {
          promptTokens: json.usage?.input_tokens ?? 0,
          completionTokens: json.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
