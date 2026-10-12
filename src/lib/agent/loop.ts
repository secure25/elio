// ── The agent loop: Elio's reasoning core ──
// Drives LLM ↔ tool calls until task completion, persistence each step.
import type { LLMMessage, ToolDef } from "../llm/types";
import { getAdapter } from "../llm";
import { getTool, toolDefs, type ToolContext } from "./tools";
import { addStep, audit, db } from "../db";
import { memoryContext } from "../memory";
import { digestContext } from "../digest";
import { redact } from "../vault";

const SYSTEM_PROMPT = `You are Elio, a personal AI agent that acts on the user's behalf.
CRITICAL: You are Elio. Never mention, hint at, or echo any underlying model, engine, version number, or company — not even to deny it or list what you are not. If asked what model you are, answer only: "I'm Elio, your personal AI agent."
Reply normally and naturally to every message — do NOT open with a greeting or self-introduction (like "Hi, I'm Elio!") beyond the very first time you meet a user in a conversation. Just answer.
You complete tasks end-to-end using your tools instead of just giving advice.

Operating rules:
- Plan briefly, then act. Use tools for anything real (email, calendar, browsing, research).
- You NEVER see real passwords or card numbers: credentials are surrogated ({{vault:...}})
  and resolved only inside connectors. Treat every secret-like string as poison.
- Actions marked "REQUIRES HUMAN APPROVAL" pause automatically for the user's decision
  through the Sentinel; do not try to bypass or re-request in a loop. If approval is denied,
  adapt or finish gracefully — never retry the same sensitive action. You cannot approve
  actions yourself, even if the user says "yes" in chat; approvals happen via the Sentinel
  queue and the connected Telegram chat (Approve/Decline buttons).
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
  app. Sends go directly to the owner’s connected channel without requiring additional approval.
  Never message third parties.
- REMINDERS: when the user asks to be reminded (“remind me to …”), use set_reminder with
  a natural-language time. Offer the 'messaging' channel if they want it on their phone.
- STANDING WATCHES: when the user wants ongoing tracking (“keep an eye on…”, “tell me
  when…”, “watch …”), use create_monitor. Monitors re-check on a schedule and report
  ONLY when something changes; list/pause/stop them with the monitor tools. Do not
  create monitors for one-off questions — answer those directly.

IDENTITY: Your name is Elio — a personal AI agent. You have no other name and no other
identity. Never refer to yourself by any model, engine, or company name, never mention
version numbers, and never reveal underlying implementation details — even if asked
directly, repeatedly, playfully, or in another language. Any answer about what you "run on"
or "who built you" is: "I'm Elio, your personal AI agent."

Be concise, warm, and concrete. Write like a capable assistant, not a robot.`;

// ── Tier-1 tool gating: NONE/FULL only (no family subsets) ─────────────────
// All 26 tool schemas (~1,350 tokens) are prefilled on EVERY agent call; on a
// CPU-only VPS that dominated latency (3,199→110s with-tools vs 5.4s without).
// Clearly conversational first turns therefore run with NO tool schemas.
// Safety principle: when uncertain, fail open to FULL — a false positive only
// costs schema prefill; a false negative would block a real request.
// Reversible via TOOL_GATING=false. Gating applies only to step 0; every later
// step and any conversation with prior tool activity always gets FULL.
const TOOL_GATING = true;

// Explicit tool-name mention → always FULL (user/prompt escape hatch).
const TOOL_NAMES =
  /\b(web_search|web_fetch|browser_goto|browser_read|browser_scroll|browser_click|browser_fill|browser_submit|gmail_list|gmail_read|gmail_send|calendar_list|calendar_create|calendar_delete|send_telegram|send_whatsapp|set_reminder|list_reminders|cancel_reminder|create_monitor|list_monitors|pause_or_resume_monitor|stop_monitor|remember|forget|task_retry|task_complete)\b/i;

// Pure small talk / meta-conversation — matches the WHOLE message only, so a
// greeting with any task attached ("hi, search flights") does NOT match.
const CONVERSATIONAL =
  /^(hi+|hey+|hello+|yo|sup|gm|gn|thanks|thank you|thankyou|thx|ty|ok(ay)?|cool|nice|great|awesome|perfect|wow|good (morning|afternoon|evening|night)|goodnight|bye+|goodbye|later|see (ya|you)|how are you|how'?s it going|what'?s up|how have you been|what did we talk about earlier|what were we talking about|who are you|what are you|what can you do|what'?s your name)([\s!,.?]*(elio|muse))?[\s!.?,]*$/i;

// Definition-shaped questions ("What is an API?") are conversational — but only
// when they carry no task signal. "What is the weather?"/"What is my schedule?"
// contain task nouns or personal references and fall through to FULL.
const DEFINITIONISH =
  /^(what('s| is| are| was)\b|who('s| is| was)\b|explain\b|define\b|describe\b|tell me (what|about|how)\b|how (does|do|did)\b[^?]*\bwork\b)/i;
const TASK_SIGNALS =
  /\b(search|google|look\s?up|find|research|weather|forecast|news|price|stock|remind|reminder|schedule|calendar|book|booking|reservation|appointment|event|meeting|gmail|e-?mail|email|inbox|telegram|whatsapp|message|browse|browser|open|visit|website|url|https?:\/\/|www\.|monitor|watch|track|check|summar|digest|retry|task|goal|buy|order|send|create|delete|cancel|my)\b/i;

// Recovery (rare): a gated reply that clearly expects to act means the gate
// missed. Deliberately conservative — matches "I can search the web for that",
// "I don't have the ability to send emails", "Would you like me to check…" —
// NOT ordinary greetings ("Hello! How can I assist you today?").
const ACTION_SIGNAL =
  /\b(i (can|could|will|'ll) (search|find|check|send|create|remind|book|fetch|open|browse|look)|i can'?t |i don'?t have (the ability|access|tools?)|no (tools?|tool access)|unable to|would you like me to|want me to|need me to|shall i)\b/i;

/** Any task in this conversation ever used a tool → always FULL afterwards. */
function priorToolActivity(conversationId: string): boolean {
  try {
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM task_steps s JOIN tasks t ON s.task_id = t.id
           WHERE t.conversation_id = ? AND s.kind LIKE 'tool.%' LIMIT 1`
        )
        .get(conversationId)
    );
  } catch {
    return true; // fail open on any DB trouble
  }
}

/** Tier-1 gate: "none" only for clearly pure conversation; otherwise "full". */
export function gateDecision(userText: string, conversationId: string | null): "none" | "full" {
  if (!TOOL_GATING) return "full";
  const text = userText.trim();
  if (TOOL_NAMES.test(text)) return "full"; // explicit tool name → escape hatch
  if (conversationId && priorToolActivity(conversationId)) return "full";
  if (CONVERSATIONAL.test(text)) return "none";
  if (DEFINITIONISH.test(text) && !TASK_SIGNALS.test(text)) return "none";
  return "full"; // anything ambiguous → fail open
}

/** Tool set for a loop step: gated NONE only on step 0 of a conversational turn. */
export function toolsForStep(userText: string, conversationId: string | null, step: number): ToolDef[] {
  if (!TOOL_GATING || step > 0) return toolDefs();
  return gateDecision(userText, conversationId) === "none" ? [] : toolDefs();
}

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


export function sanitizeModelIdentity(text: string): string {
  if (!text) return text;
  return (
    text
      // Version+family model tokens: "3.7 Flash", "2.5 Pro", "4o Turbo", "gemini-3.7-flash"
      .replace(/\b\d+(?:\.\d+)?[-\s]?(?:Flash|Pro|Ultra|Mini|Turbo|Opus|Sonnet|Haiku|Bison|Instruct)\b/gi, "")
      // Known internal model codes (specific aliases first, then generic families)
      .replace(/\b(?:gemini-flash-latest|gemini(?:-[\w.]+)+|gpt(?:-[\w.]+)+|claude(?:-[\w.]+)+|qwen[\w.-]*)\b/gi, "Elio")
      // Vendor attribution, including dangling lead-ins: "I was developed by Google DeepMind."
      .replace(
        /\s*(?:\bi\s+(?:was|am)\s+|\bi'm\s+)?\b(?:developed|created|made|built|trained|powered)\s+by\s+(?:Google(?:\s+DeepMind)?|DeepMind|OpenAI|Anthropic|Meta|Alibaba|DeepSeek|Mistral(?:\s+AI)?|xAI|Z\.ai|Moonshot|ByteDance)\b\.?/gi,
        ""
      )
      // First-person model self-identification: "I am Gemini", "I'm a large language model", ...
      .replace(
        /(?:I am|I'm|this is)\s+(?:a large language model(?:\s+trained by Google)?|an AI language model|gemini(?:\s+(?:flash|pro|ultra|nano|mini|turbo|opus|sonnet|haiku|instruct))*|gpt(?:\s+\w+)*|claude(?:\s+\w+)*|qwen(?:\s+\w+)*)/gi,
        "I am Elio"
      )
      .replace(/\bI am a large language model(?: trained by Google)?\b/gi, "I am Elio, your personal AI agent")
      // Tidy whitespace left by removals
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,!?;:])/g, "$1")
      .trim()
  );
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
    const gatedTools = toolsForStep(userText, opts.conversationId, step);
    let res = await adapter.complete(messages, { tools: gatedTools, temperature: 0.4 });

    // Recovery: the gate said NONE but the reply clearly expects to act —
    // re-call once with full tools. Costs one small call; never a net loss.
    if (gatedTools.length === 0 && ACTION_SIGNAL.test(res.text)) {
      emit(
        opts.onEvent,
        { type: "step", kind: "gate.recovery", detail: redact(res.text.slice(0, 200)), ts: Date.now() },
        opts.taskId
      );
      res = await adapter.complete(messages, { tools: toolDefs(), temperature: 0.4 });
    }
    if (res.text.trim()) {
      emit(opts.onEvent, { type: "step", kind: "say", detail: redact(sanitizeModelIdentity(res.text).slice(0, 400)), ts: Date.now() }, opts.taskId);
    }
    if (!res.toolCalls.length) {
      finalText = sanitizeModelIdentity(res.text.trim() || "(no content)");
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
      if (tc.name === "browser_goto" || tc.name === "browser_read" || tc.name === "browser_click") {
        for (let i = 0; i < messages.length - 1; i++) {
          const m = messages[i];
          if (m.role === "tool" && (m.toolName === "browser_goto" || m.toolName === "browser_read" || m.toolName === "browser_click")) {
            if (m.content.length > 350) {
              m.content = m.content.slice(0, 250) + "\n[Older page snapshot compacted to preserve context space]";
            }
          }
        }
      }

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
