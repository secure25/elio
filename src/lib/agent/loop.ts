// ── The agent loop: Elio's reasoning core ──
// Drives LLM ↔ tool calls until task completion, persistence each step.
import type { LLMMessage } from "../llm/types";
import { getAdapter } from "../llm";
import { getTool, toolDefs, type ToolContext } from "./tools";
import { addStep, audit, db } from "../db";
import { memoryContext } from "../memory";
import { digestContext } from "../digest";
import { redact } from "../vault";

const SYSTEM_PROMPT = `You are Elio, a personal AI agent that acts on the user's behalf.
You complete tasks end-to-end using your tools instead of just giving advice.

Operating rules:
- Plan briefly, then act. Use tools for anything real (email, calendar, browsing, research).
- You NEVER see real passwords or card numbers: credentials are surrogated ({{vault:...}})
  and resolved only inside connectors. Treat every secret-like string as poison.
- Actions marked "REQUIRES HUMAN APPROVAL" pause automatically for the user's decision
  through the Sentinel; do not try to bypass or re-request in a loop. If approval is denied,
  adapt or finish gracefully — never retry the same sensitive action. You cannot approve
  actions yourself, even if the user says "yes" in chat; approvals happen via the Sentinel queue.
- If the user is replying to a digest (e.g. "retry the failed one"), use the digest context
  below: retry with task_retry using the exact failed task id; summarize approvals rather
  than promising to approve them yourself.
- The browser shows you an ACCESSIBILITY TREE with element refs (e1, e2, …). Use refs for
  click/fill/submit. Re-read the page after navigation because refs change.
- Never enter card numbers or passwords into web forms yourself; tell the user to finish
  those steps and use task_complete to summarize.
- When you have fully completed the task, call task_complete with a clear summary.

Capabilities for real-world errands:
- BOOKINGS & RESERVATIONS: restaurants, appointments, events. Research options with
  web_search/web_fetch, create the booking as a calendar event with calendar_create
  (approval-gated), and optionally confirm by phone message if the user asks.
- ORDERS: you can browse and fill order forms, but you NEVER enter card numbers or
  passwords. Fill everything up to the payment step, then use browser_submit or hand the
  final payment step to the user; money is only ever spent after Sentinel approval.
- MESSAGES: use send_telegram / send_whatsapp to text the owner's own connected chat —
  useful for confirmations, reminders, or reaching the user when they are away from the
  app. Every send needs Sentinel approval; never message third parties.
- REMINDERS: when the user asks to be reminded (“remind me to …”), use set_reminder with
  a natural-language time. Offer the 'messaging' channel if they want it on their phone.
- STANDING WATCHES: when the user wants ongoing tracking (“keep an eye on…”, “tell me
  when…”, “watch …”), use create_monitor. Monitors re-check on a schedule and report
  ONLY when something changes; list/pause/stop them with the monitor tools. Do not
  create monitors for one-off questions — answer those directly.

Be concise, warm, and concrete. Write like a capable assistant, not a robot.`;

export interface RunOptions {
  taskId: string | null;
  conversationId: string;
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "step"; kind: string; detail: string; ts: number }
  | { type: "approval_request"; approvalId: string; action: string; detail: string; risk: string }
  | { type: "final"; text: string }
  | { type: "error"; text: string };

function emit(
  onEvent: ((e: AgentEvent) => void) | undefined,
  event: AgentEvent,
  taskId: string | null
) {
  onEvent?.(event);
  if (taskId && (event.type === "step" || event.type === "approval_request" || event.type === "final" || event.type === "error")) {
    addStep(taskId, event.type, event.type === "final" || event.type === "error" ? event.text : event.detail);
  }
}

export async function runAgent(
  userText: string,
  opts: RunOptions
): Promise<{ finalText: string; events: AgentEvent[] }> {
  const adapter = getAdapter();
  const maxSteps = opts.maxSteps ?? 14;
  const events: AgentEvent[] = [];

  // Prior conversation for continuity
  const prior = db
    .prepare(
      "SELECT role, content, meta FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 12"
    )
    .all(opts.conversationId)
    .reverse() as { role: string; content: string; meta: string | null }[];

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        memoryContext() +
        digestContext() +
        `\n\nToday is ${new Date().toUTCString()}.`,
    },
  ];
  for (const p of prior) {
    if (p.role === "user" || p.role === "assistant") {
      messages.push({ role: p.role as "user" | "assistant", content: p.content });
    }
  }
  messages.push({ role: "user", content: userText });

  let finalText = "";
  for (let step = 0; step < maxSteps; step++) {
    const res = await adapter.complete(messages, { tools: toolDefs(), temperature: 0.4 });
    if (res.text.trim()) {
      emit(opts.onEvent, { type: "step", kind: "say", detail: redact(res.text.slice(0, 400)), ts: Date.now() }, opts.taskId);
    }
    if (!res.toolCalls.length) {
      finalText = res.text.trim() || "(no content)";
      emit(opts.onEvent, { type: "final", text: finalText }, opts.taskId);
      return { finalText, events };
    }

    // assistant message with tool calls
    messages.push({
      role: "assistant",
      content: res.text,
      toolCalls: res.toolCalls,
      rawParts: res.rawParts,
    });

    for (const tc of res.toolCalls) {
      const tool = getTool(tc.name);
      let result: string;
      if (!tool) {
        result = `Unknown tool: ${tc.name}`;
      } else {
        try {
          let args = tc.args;
          try {
            args = JSON.parse(tc.args || "{}");
          } catch {
            /* adapters pass strings; connectors tolerate */
          }
          const ctx: ToolContext = { taskId: opts.taskId, conversationId: opts.conversationId };
          result = await tool.run(ctx, typeof args === "string" ? { _raw: args } : args);
        } catch (e: any) {
          result = `Tool error: ${e.message}`;
        }
      }
      emit(
        opts.onEvent,
        { type: "step", kind: `tool.${tc.name}`, detail: redact(String(result).slice(0, 300)), ts: Date.now() },
        opts.taskId
      );
      messages.push({ role: "tool", content: String(result).slice(0, 12_000), toolCallId: tc.id, toolName: tc.name });

      // task_complete is terminal: finish immediately with its summary.
      if (tc.name === "task_complete" && result.startsWith("COMPLETE:")) {
        finalText = result.slice("COMPLETE:".length).trim();
        emit(opts.onEvent, { type: "final", text: finalText }, opts.taskId);
        return { finalText, events };
      }
    }
  }
  finalText = "I hit my step limit while working on this. Here's where things stand — ask me to continue.";
  emit(opts.onEvent, { type: "final", text: finalText }, opts.taskId);
  return { finalText, events };
}

export function auditAgentRun(action: string, detail: string) {
  audit("agent", action, { detail, risk: "low" });
}
