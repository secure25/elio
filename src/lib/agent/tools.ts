// ── Tool registry: schemas the model sees, wired to real connector functions ──
// Descriptions are intentionally terse: they are prefilled on every agent call
// (schema cost dominates CPU-only prefill), so keep only behaviorally load-bearing
// info — approval flags, owner-only scoping, time/enum syntax, the refs contract.
import type { ToolDef } from "../llm/types";

export interface ToolContext {
  taskId: string | null;
  conversationId: string | null;
}

export interface AgentTool {
  def: ToolDef;
  run: (ctx: ToolContext, args: any) => Promise<string>;
}

const str = (desc: string) => ({ type: "string", description: desc });
const s = () => ({ type: "string" });

export const TOOLS: AgentTool[] = [
  {
    def: {
      name: "web_search",
      description: "Search the public web; returns titles, URLs, and short excerpts.",
      parameters: { type: "object", properties: { query: s() }, required: ["query"] },
    },
    run: (ctx, a) => import("../connectors/web").then((m) => m.webSearch(ctx.taskId, a.query)),
  },
  {
    def: {
      name: "web_fetch",
      description: "Fetch a URL and return its readable text.",
      parameters: { type: "object", properties: { url: s() }, required: ["url"] },
    },
    run: (ctx, a) => import("../connectors/web").then((m) => m.webFetch(ctx.taskId, a.url)),
  },
  {
    def: {
      name: "browser_goto",
      description: "Open a URL in the sandboxed browser; returns the accessibility tree with element refs.",
      parameters: { type: "object", properties: { url: s() }, required: ["url"] },
    },
    run: (ctx, a) => import("../connectors/browser").then((m) => m.browserGoto(ctx.taskId, a.url)),
  },
  {
    def: {
      name: "browser_read",
      description: "Re-read the current page: title, URL, elements with refs.",
      parameters: { type: "object", properties: {} },
    },
    run: (ctx) => import("../connectors/browser").then((m) => m.browserRead(ctx.taskId)),
  },
  {
    def: {
      name: "browser_scroll",
      description: "Scroll the browser page down, up, top, or bottom to see more content.",
      parameters: {
        type: "object",
        properties: {
          direction: str("'down' (default), 'up', 'top', or 'bottom'"),
          amount: { type: "number", description: "Pixels to scroll, default 600" },
        },
      },
    },
    run: (ctx, a) =>
      import("../connectors/browser").then((m) =>
        m.browserScroll(ctx.taskId, a.direction, a.amount)
      ),
  },
  {
    def: {
      name: "browser_click",
      description: "Click an element by ref (e.g. e7) from the latest page state.",
      parameters: { type: "object", properties: { ref: s() }, required: ["ref"] },
    },
    run: (ctx, a) => import("../connectors/browser").then((m) => m.browserClick(ctx.taskId, a.ref)),
  },
  {
    def: {
      name: "browser_fill",
      description: "Type a value into an input by ref; value is redacted in logs.",
      parameters: { type: "object", properties: { ref: s(), value: s() }, required: ["ref", "value"] },
    },
    run: (ctx, a) => import("../connectors/browser").then((m) => m.browserFill(ctx.taskId, a.ref, a.value)),
  },
  {
    def: {
      name: "browser_submit",
      description: "Click a submit/checkout button. REQUIRES HUMAN APPROVAL.",
      parameters: { type: "object", properties: { ref: s() }, required: ["ref"] },
    },
    run: (ctx, a) =>
      import("../connectors/browser").then((m) =>
        m.browserSubmit(ctx.taskId, a.ref, ctx.conversationId)
      ),
  },
  {
    def: {
      name: "gmail_list",
      description: "List recent emails (OTP codes and reset links are filtered out).",
      parameters: {
        type: "object",
        properties: { query: str("Gmail query, e.g. from:boss@x.com is:unread"), max: { type: "number" } },
      },
    },
    run: (ctx, a) =>
      import("../connectors/gmail").then((m) =>
        m.gmailList(ctx.taskId, { query: a.query, max: a.max })
      ),
  },
  {
    def: {
      name: "gmail_read",
      description: "Read one email by id.",
      parameters: { type: "object", properties: { id: s() }, required: ["id"] },
    },
    run: (ctx, a) => import("../connectors/gmail").then((m) => m.gmailRead(ctx.taskId, a.id)),
  },
  {
    def: {
      name: "gmail_send",
      description: "Send an email from the user's Gmail. REQUIRES HUMAN APPROVAL.",
      parameters: {
        type: "object",
        properties: { to: s(), subject: s(), body: s() },
        required: ["to", "subject", "body"],
      },
    },
    run: (ctx, a) =>
      import("../connectors/gmail").then((m) =>
        m.gmailSend(ctx.taskId, ctx.conversationId, a.to, a.subject, a.body)
      ),
  },
  {
    def: {
      name: "calendar_list",
      description: "List calendar events for the next 14 days.",
      parameters: { type: "object", properties: {} },
    },
    run: (ctx) => import("../connectors/gcal").then((m) => m.calendarList(ctx.taskId)),
  },
  {
    def: {
      name: "calendar_create",
      description: "Create a calendar event. REQUIRES HUMAN APPROVAL.",
      parameters: {
        type: "object",
        properties: {
          summary: s(),
          start: str("Start ISO datetime, e.g. 2026-09-21T15:00:00"),
          end: s(),
          description: s(),
          location: s(),
          attendees: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "start", "end"],
      },
    },
    run: (ctx, a) =>
      import("../connectors/gcal").then((m) =>
        m.calendarCreate(ctx.taskId, ctx.conversationId, a)
      ),
  },
  {
    def: {
      name: "calendar_delete",
      description: "Delete a calendar event by id. REQUIRES HUMAN APPROVAL.",
      parameters: { type: "object", properties: { event_id: s() }, required: ["event_id"] },
    },
    run: (ctx, a) =>
      import("../connectors/gcal").then((m) => m.calendarDelete(ctx.taskId, ctx.conversationId, a.event_id)),
  },
  {
    def: {
      name: "send_telegram",
      description:
        "Message the owner's own connected Telegram chat. REQUIRES HUMAN APPROVAL; only for sends the user explicitly requested or confirmed.",
      parameters: { type: "object", properties: { text: s() }, required: ["text"] },
    },
    run: (ctx, a) =>
      import("../connectors/messaging").then((m) => m.sendTelegram(ctx.taskId, ctx.conversationId, a.text)),
  },
  {
    def: {
      name: "send_whatsapp",
      description:
        "Message the owner's own connected WhatsApp number. REQUIRES HUMAN APPROVAL; only for sends the user explicitly requested or confirmed.",
      parameters: { type: "object", properties: { text: s() }, required: ["text"] },
    },
    run: (ctx, a) =>
      import("../connectors/messaging").then((m) => m.sendWhatsApp(ctx.taskId, ctx.conversationId, a.text)),
  },
  {
    def: {
      name: "set_reminder",
      description: "Set a reminder; fires as a chat message (or Telegram/WhatsApp if channel='messaging').",
      parameters: {
        type: "object",
        properties: {
          content: s(),
          when: str("Natural time ('in 20 minutes', 'tomorrow 9am') or ISO datetime"),
          channel: str("'chat' (default) or 'messaging' to ping their phone"),
        },
        required: ["content", "when"],
      },
    },
    run: async (_ctx, a) => {
      const { createReminder } = await import("../reminders");
      const r = createReminder({
        content: a.content,
        when: a.when,
        channel: a.channel,
        conversationId: _ctx.conversationId,
      });
      return r.ok ? r.message : `Could not set reminder: ${r.message}`;
    },
  },
  {
    def: {
      name: "list_reminders",
      description: "List upcoming reminders.",
      parameters: { type: "object", properties: {} },
    },
    run: async () => {
      const { listReminders } = await import("../reminders");
      const rows = listReminders(false);
      if (!rows.length) return "No upcoming reminders.";
      return rows.map((r) => `${new Date(r.due_at).toLocaleString()} — ${r.content}`).join("\n");
    },
  },
  {
    def: {
      name: "cancel_reminder",
      description: "Cancel upcoming reminder(s) by id or matching text.",
      parameters: { type: "object", properties: { match: s() }, required: ["match"] },
    },
    run: async (_ctx, a) => {
      const { cancelReminder } = await import("../reminders");
      const n = cancelReminder(a.match);
      return n > 0 ? `Cancelled ${n} reminder(s).` : "No matching pending reminders.";
    },
  },
  {
    def: {
      name: "create_monitor",
      description:
        "Create a standing monitor: re-checks on a schedule, reports only on change, runs until paused or stopped. Embed the check in the prompt, e.g. 'watch the price of amazon.com/dp/B0XYZ and tell me when it drops under $30'.",
      parameters: {
        type: "object",
        properties: {
          prompt: s(),
          cadence: str("'hourly', 'every_6h' (default), or 'daily'"),
        },
        required: ["prompt"],
      },
    },
    run: async (_ctx, a) => {
      const { createMonitor } = await import("../monitors");
      const cadence = ["hourly", "every_6h", "daily"].includes(a.cadence) ? a.cadence : undefined;
      const r = createMonitor({ prompt: a.prompt, cadence, conversationId: _ctx.conversationId });
      return r.ok ? r.message : `Could not create monitor: ${r.message}`;
    },
  },
  {
    def: {
      name: "list_monitors",
      description: "List standing monitors with status.",
      parameters: { type: "object", properties: {} },
    },
    run: async () => {
      const { listMonitors } = await import("../monitors");
      const rows = listMonitors();
      if (!rows.length) return "No standing monitors yet.";
      return rows
        .map(
          (m) =>
            `[${m.status}] ${m.description} (checks ${m.cadence.replace("_", " ")}${
              m.last_run ? `, last checked ${new Date(m.last_run).toLocaleString()}` : ", not checked yet"
            }) id:${m.id}`
        )
        .join("\n");
    },
  },
  {
    def: {
      name: "pause_or_resume_monitor",
      description: "Pause or resume a monitor by id.",
      parameters: { type: "object", properties: { monitor_id: s(), action: str("'pause' or 'resume'") }, required: ["monitor_id", "action"] },
    },
    run: async (_ctx, a) => {
      const { setMonitorStatus } = await import("../monitors");
      const ok = setMonitorStatus(a.monitor_id, a.action === "pause" ? "paused" : "active");
      return ok ? `Monitor ${a.action}d.` : `No monitor with id ${a.monitor_id}.`;
    },
  },
  {
    def: {
      name: "stop_monitor",
      description: "Permanently stop and delete a monitor by id.",
      parameters: { type: "object", properties: { monitor_id: s() }, required: ["monitor_id"] },
    },
    run: async (_ctx, a) => {
      const { deleteMonitor } = await import("../monitors");
      const ok = deleteMonitor(a.monitor_id);
      return ok ? "Monitor stopped and removed." : `No monitor with id ${a.monitor_id}.`;
    },
  },
  {
    def: {
      name: "remember",
      description: "Save a durable fact or preference to long-term memory.",
      parameters: {
        type: "object",
        properties: { content: s(), category: str("One of: general, preferences, people, schedule, work, health, finance") },
      },
    },
    run: async (_ctx, a) => {
      const m = await import("../memory");
      m.remember(a.content, a.category || "general", "agent");
      return `Remembered: ${a.content}`;
    },
  },
  {
    def: {
      name: "forget",
      description: "Delete memories matching a phrase.",
      parameters: { type: "object", properties: { match: s() }, required: ["match"] },
    },
    run: async (_ctx, a) => {
      const m = await import("../memory");
      const n = m.forget(a.match);
      return `Forgot ${n} memor${n === 1 ? "y" : "ies"}.`;
    },
  },
  {
    def: {
      name: "task_retry",
      description: "Re-run a failed task by id (digest replies). Returns a new taskId.",
      parameters: { type: "object", properties: { task_id: s() }, required: ["task_id"] },
    },
    run: async (_ctx, a) => {
      const { retryTask, getTask } = await import("./runner");
      const { getAdapter } = await import("../llm");
      const original = getTask(a.task_id) as any;
      if (!original) return `No task found with id ${a.task_id}.`;
      if (original.status !== "failed") return `Task is not failed (status: ${original.status}); nothing to retry.`;
      const convId = original.conversation_id || _ctx.conversationId || "";
      const newId = retryTask(a.task_id, convId);
      void getAdapter(); // touch adapter to surface missing-LLM errors early in test setups
      return `Retrying task "${original.goal}" as task ${newId}. It runs in the background and will report back.`;
    },
  },
  {
    def: {
      name: "task_complete",
      description: "Mark the task complete with a final user-facing summary. Call when done.",
      parameters: { type: "object", properties: { summary: s() }, required: ["summary"] },
    },
    run: async (_ctx, a) => `COMPLETE: ${a.summary}`,
  },
];

export function getTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.def.name === name);
}

export function toolDefs(): ToolDef[] {
  return TOOLS.map((t) => t.def);
}
