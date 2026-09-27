import type { LLMAdapter, LLMMessage, LLMResponse, ToolDef, ToolCall } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  thought_signature?: string;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; thought_signature?: string; thoughtSignature?: string };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toGeminiContents(messages: LLMMessage[]): {
  systemInstruction: { parts: [{ text: string }] } | undefined;
  contents: GeminiContent[];
} {
  let systemInstruction: { parts: [{ text: string }] } | undefined;
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemInstruction = { parts: [{ text: m.content }] };
      continue;
    }
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content || " " }] });
    } else if (m.role === "assistant") {
      if (m.rawParts && Array.isArray(m.rawParts) && m.rawParts.length > 0) {
        contents.push({ role: "model", parts: sanitizeParts(m.rawParts as GeminiPart[]) });
      } else {
        const parts: GeminiPart[] = [];
        if (m.content) parts.push({ text: m.content });
        const toolCalls = m.toolCalls ?? [];
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.args || "{}");
          } catch {
            args = { _raw: tc.args };
          }
          const sig = tc.thoughtSignature || (i === 0 ? "context_engineering_is_the_way_to_go" : undefined);
          // Signature goes at the PART level only — nesting it inside functionCall
          // makes the API reject the whole payload.
          parts.push({
            functionCall: { name: tc.name, args },
            ...(sig ? { thought_signature: sig } : {}),
          });
        }
        if (parts.length === 0) parts.push({ text: " " });
        contents.push({ role: "model", parts });
      }
    } else {
      // tool result → functionResponse part, in a user turn
      let out = m.content;
      try {
        const parsed = JSON.parse(m.content);
        out = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      } catch {
        /* keep as-is */
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.toolName || "tool",
              response: { result: out },
            },
          },
        ],
      });
    }
  }
  return { systemInstruction, contents };
}

/**
 * Sanitize model parts for replay: Gemini 3 rejects `thought_signature` when it
 * appears INSIDE a function_call object (it belongs at the part level). Strip
 * nested copies; keep the part-level signature, which is what multi-turn tool
 * replay actually needs.
 */
function sanitizeParts(parts: GeminiPart[]): GeminiPart[] {
  return parts
    .filter((p) => p && (typeof p.text === "string" || p.functionCall || p.functionResponse))
    .map((p) => {
      if (p.functionCall) {
        const fc: GeminiPart["functionCall"] = {
          name: p.functionCall.name,
          args: p.functionCall.args ?? {},
        };
        const partSig = p.thought_signature || p.thoughtSignature;
        return { functionCall: fc, ...(partSig ? { thought_signature: partSig } : {}) } as GeminiPart;
      }
      return p;
    });
}

function toGeminiTools(tools: ToolDef[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export function geminiAdapter(opts: { apiKey: string; model?: string }): LLMAdapter {
  const model = opts.model || "gemini-flash-latest";
  return {
    provider: "gemini",
    model,
    async complete(messages, { tools, temperature, maxTokens }): Promise<LLMResponse> {
      const { systemInstruction, contents } = toGeminiContents(messages);
      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: temperature ?? 0.4,
          maxOutputTokens: maxTokens ?? 8192,
        },
      };
      if (systemInstruction) body.systemInstruction = systemInstruction;
      if (tools && tools.length > 0) body.tools = toGeminiTools(tools);

      const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${opts.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        error?: { message?: string; status?: string };
      };
      if (!res.ok || json.error) {
        throw new Error(`Gemini API error: ${json.error?.message || res.status}`);
      }
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      const toolCalls: ToolCall[] = parts
        .filter((p) => p.functionCall)
        .map((p, i) => {
          const sig = p.thought_signature || p.thoughtSignature || (p.functionCall as any)?.thought_signature || (p.functionCall as any)?.thoughtSignature;
          return {
            id: `call_${Date.now()}_${i}`,
            name: p.functionCall!.name,
            args: JSON.stringify(p.functionCall!.args ?? {}),
            ...(sig ? { thoughtSignature: sig } : {}),
          };
        });
      return {
        text,
        toolCalls,
        rawParts: parts,
        usage: {
          promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}
