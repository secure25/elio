// Shared LLM types. Every provider adapter implements this same interface.
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  args: string; // raw JSON string as returned by the model
  thoughtSignature?: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[]; // assistant messages may carry requested calls
  rawParts?: unknown[];
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
  rawParts?: unknown[];
  raw?: unknown;
}

export interface LLMAdapter {
  readonly provider: string;
  readonly model: string;
  complete(
    messages: LLMMessage[],
    opts: { tools?: ToolDef[]; temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse>;
}
