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

// ── MoltMoney financial tools (Phase 1: READ-ONLY) ──────────────────────
// Registered only when the MoltMoney connector is fully configured via env
// (MOLTMONEY_API_URL + MOLTMONEY_API_KEY + MOLTMONEY_ACCOUNT_ID) and not
// kill-switched with MOLTMONEY_ENABLED=false. Phase 2 money-moving tools will
// additionally require MOLTMONEY_ENABLED="true" explicitly and Sentinel
// approval before any money can move. Missing config → tools absent → the
// model never sees them (fail closed by non-registration).
function moltmoneyReadonlyEnabled(): boolean {
  if ((process.env.MOLTMONEY_ENABLED || "").trim().toLowerCase() === "false") return false;
  return Boolean(
    (process.env.MOLTMONEY_API_URL || "").trim() &&
      (process.env.MOLTMONEY_API_KEY || "").trim() &&
      (process.env.MOLTMONEY_ACCOUNT_ID || "").trim()
  );
}

if (moltmoneyReadonlyEnabled()) {
  TOOLS.push(
    {
      def: {
        name: "moltmoney_get_account",
        description:
          "Show the connected MoltMoney account: type, status, currency, balance, account number. Read-only.",
        parameters: { type: "object", properties: {} },
      },
      run: () => import("../connectors/moltmoney").then((m) => m.moltmoneyGetAccount()),
    },
    {
      def: {
        name: "moltmoney_get_balance",
        description: "Show the current MoltMoney balance. Read-only.",
        parameters: { type: "object", properties: {} },
      },
      run: () => import("../connectors/moltmoney").then((m) => m.moltmoneyGetBalance()),
    },
    {
      def: {
        name: "moltmoney_get_transactions",
        description: "List recent MoltMoney transactions. Read-only.",
        parameters: {
          type: "object",
          properties: { limit: { type: "number", description: "Max transactions (default 10, max 50)" } },
        },
      },
      run: (_ctx, a) =>
        import("../connectors/moltmoney").then((m) => m.moltmoneyGetTransactions(a?.limit)),
    },
    {
      def: {
        name: "moltmoney_get_spending_rules",
        description:
          "Retrieve Elio's CURRENT spending policy from MoltMoney (single source of truth): per-transaction limit, daily limit, require-approval-above threshold, blocked categories, plus server-computed daily usage (spent today, remaining today, server time). Call this BEFORE attempting any purchase. Blocked categories are HARD prohibitions: refuse them before any approval request or order — never route them into approval. Limit/threshold violations are different: soft, may still need owner approval at capture. Read-only.",
        parameters: { type: "object", properties: {} },
      },
      run: () => import("../connectors/moltmoney").then((m) => m.moltmoneyGetSpendingRules()),
    },
    {
      def: {
        name: "moltmoney_list_cards",
        description:
          "List Elio's virtual cards on MoltMoney (masked numbers, no CVV, status, spend limit). Read-only. Card issuing, freezing and cancelling are owner-only operations in the MoltMoney dashboard — Elio cannot do them.",
        parameters: { type: "object", properties: {} },
      },
      run: () => import("../connectors/moltmoney").then((m) => m.moltmoneyListCards()),
    },
    {
      def: {
        name: "moltmoney_list_payment_requests",
        description:
          "List MoltMoney payment requests: this agent's outgoing payments/fund requests to the owner and any peer requests addressed to this account (id, amount, status, expiry). Read-only.",
        parameters: {
          type: "object",
          properties: {
            status: str("Optional filter: PENDING, PAID, DECLINED or EXPIRED"),
          },
        },
      },
      run: (_ctx, a) =>
        import("../connectors/moltmoney").then((m) => m.moltmoneyListPaymentRequests(a?.status)),
    }
  );
}

// ── MoltMoney money-moving tools (Phase 2A: PayPal purchase flow) ────────
// Registered ONLY when MOLTMONEY_ENABLED is explicitly "true" (stricter than
// the read-only gate) AND full creds are present. Every money-moving call is
// Sentinel-gated inside the connector (finance.pay → human approval card);
// the human decision happens before any HTTP request reaches MoltMoney.
// The tool surface stays READ-ONLY toward PayPal: Elio never sees or handles
// PayPal credentials, card data, or webhooks — MoltMoney owns all of that.
function moltmoneyMoneyEnabled(): boolean {
  if ((process.env.MOLTMONEY_ENABLED || "").trim().toLowerCase() !== "true") return false;
  return Boolean(
    (process.env.MOLTMONEY_API_URL || "").trim() &&
      (process.env.MOLTMONEY_API_KEY || "").trim() &&
      (process.env.MOLTMONEY_ACCOUNT_ID || "").trim()
  );
}

if (moltmoneyMoneyEnabled()) {
  TOOLS.push(
    {
      def: {
        name: "moltmoney_get_payment",
        description:
          "Get one MoltMoney transaction by id (status, amount, currency, merchant). Read-only.",
        parameters: {
          type: "object",
          properties: { transaction_id: str("MoltMoney transaction id (or PayPal order id)") },
          required: ["transaction_id"],
        },
      },
      run: (_ctx, a) =>
        import("../connectors/moltmoney").then((m) => m.moltmoneyGetPayment(a.transaction_id)),
    },
    {
      def: {        name: "moltmoney_create_paypal_order",
        description:
          "Start a PayPal purchase via MoltMoney. Check moltmoney_get_spending_rules FIRST. HARD PROHIBITION: if the purchase falls in a blocked category, or you cannot determine a category while blocked categories are configured, REFUSE — never create a Sentinel approval request and never call this tool; blocked categories must never reach any approval mechanism. SOFT POLICY: if the amount may exceed a limit or the require-approval-above threshold, tell the user MoltMoney may require additional owner approval before capture. ALWAYS classify the purchase and pass merchant_category (required whenever blocked categories are configured; MoltMoney rejects orders without one; Elio's classification is advisory — MoltMoney is the enforcement layer). REQUIRES HUMAN APPROVAL via Sentinel. Returns a transaction id and a PayPal approval URL the USER must open and approve before capture.",
        parameters: {
          type: "object",
          properties: {
            amount: str("Amount as a decimal string, e.g. \"5.00\" (never a float)"),
            currency: str("ISO currency code, e.g. USD (default USD)"),
            description: str("What is being purchased (max 500 chars)"),
            merchant_name: str("Merchant name (max 100 chars)"),
            merchant_category: str("Purchase category as classified by Elio, e.g. books, groceries (max 50 chars). REQUIRED when the account has blocked categories; MoltMoney rejects orders without one."),
            return_url: str("Optional URL PayPal returns to after approval"),
            cancel_url: str("Optional URL PayPal returns to on cancel"),
          },
          required: ["amount"],
        },
      },
      run: (ctx, a) =>
        import("../connectors/moltmoney").then((m) =>
          m.moltmoneyCreatePaypalOrder(ctx, {
            amount: a.amount,
            currency: a.currency,
            description: a.description,
            merchantName: a.merchant_name,
            merchantCategory: a.merchant_category,
            returnUrl: a.return_url,
            cancelUrl: a.cancel_url,
          })
        ),
    },
    {
      def: {
        name: "moltmoney_capture_paypal_order",
        description:
          "Capture an APPROVED PayPal order via MoltMoney. REQUIRES HUMAN APPROVAL. Use only after the user confirmed they approved it on PayPal; the id must be the transaction/order id from the create step.",
        parameters: {
          type: "object",
          properties: {
            transaction_id: str("MoltMoney transaction id (or PayPal order id) from moltmoney_create_paypal_order"),
          },
          required: ["transaction_id"],
        },
      },
      run: (ctx, a) =>
        import("../connectors/moltmoney").then((m) =>
          m.moltmoneyCapturePaypalOrder(ctx, a.transaction_id)
        ),
    },
    {
      def: {
        name: "moltmoney_send_payment",
        description:
          "Send money from Elio's MoltMoney account to another MoltMoney account (INTERNAL transfer between MoltMoney accounts — NOT for buying things; use moltmoney_create_paypal_order for purchases). REQUIRES HUMAN APPROVAL via Sentinel — the transfer moves money immediately once approved. Pass to_account_id (MoltMoney account UUID or account number) when the user specifies a destination. Do NOT invent a merchant_category; if you classify the transfer as a blocked category it will be refused before approval. MoltMoney enforces spending rules server-side and may hold the transfer for owner approval. Never retry or duplicate a send.",
        parameters: {
          type: "object",
          properties: {
            amount: str("Amount as a decimal string, e.g. \"5.00\" (never a float)"),
            to_account_id: str("Destination MoltMoney account id (UUID or account number); omit only if the user explicitly wants an unspecified destination"),
            description: str("What the transfer is for (max 500 chars)"),
            merchant_category: str("Optional category ONLY if the user explicitly states one (max 50 chars)"),
          },
          required: ["amount"],
        },
      },
      run: (ctx, a) =>
        import("../connectors/moltmoney").then((m) =>
          m.moltmoneySendPayment(ctx, {
            amount: a.amount,
            toAccountId: a.to_account_id,
            description: a.description,
            merchantCategory: a.merchant_category,
          })
        ),
    },
    {
      def: {
        name: "moltmoney_create_payout",
        description:
          "Send money OUT of Elio's MoltMoney account to an external bank account (a real-world payout). Check moltmoney_get_spending_rules FIRST. HARD PROHIBITION: refuse a blocked-category classification before any approval request. Bank details (9-digit routing number, 8-17 digit account number, account holder name) must come from THE USER in this conversation — never invent, guess or reuse stored details. REQUIRES HUMAN APPROVAL via Sentinel, AND MoltMoney may additionally hold the payout for owner approval. Moves money immediately once approved. Never retry or duplicate a payout.",
        parameters: {
          type: "object",
          properties: {
            amount: str("Amount as a decimal string, e.g. \"5.00\" (never a float)"),
            routing_number: str("9-digit US routing number, provided by the user"),
            account_number: str("8-17 digit bank account number, provided by the user"),
            account_holder: str("Account holder name as the bank knows it (2-100 chars), provided by the user"),
            description: str("What the payout is for (max 500 chars)"),
            merchant_category: str("Optional category ONLY if the user explicitly states one (max 50 chars)"),
          },
          required: ["amount", "routing_number", "account_number", "account_holder"],
        },
      },
      run: (ctx, a) =>
        import("../connectors/moltmoney").then((m) =>
          m.moltmoneyCreatePayout(ctx, {
            amount: a.amount,
            routingNumber: a.routing_number,
            accountNumber: a.account_number,
            accountHolder: a.account_holder,
            description: a.description,
            merchantCategory: a.merchant_category,
          })
        ),
    },
    {
      def: {
        name: "moltmoney_create_payment_request",
        description:
          "Create a MoltMoney payment request. WITHOUT to_account_id this is a FUND REQUEST to the owner: money arrives only after the owner approves it in the MoltMoney dashboard (owner-only — Elio can never approve its own fund request). With to_account_id it asks a specific MoltMoney account for money; the recipient pays it via moltmoney_pay_payment_request. Check moltmoney_get_spending_rules FIRST; refuse blocked-category classifications before requesting approval. Receiving money only (creating a request never moves money out), but still Sentinel-gated since it initiates money flow.",
        parameters: {
          type: "object",
          properties: {
            amount: str("Amount as a decimal string, e.g. \"5.00\" (never a float)"),
            description: str("What the request is for (required, max 500 chars)"),
            to_account_id: str("Omit for a fund request to the owner; or a MoltMoney account id (UUID/account number) to bill a peer"),
            generate_link: { type: "boolean", description: "Also generate a shareable payment link" },
            expires_in_hours: { type: "number", description: "Expiry in hours (default 24, max 720)" },
            merchant_category: str("Optional category ONLY if the user explicitly states one (max 50 chars)"),
          },
          required: ["amount", "description"],
        },
      },
      run: (ctx, a) =>
        import("../connectors/moltmoney").then((m) =>
          m.moltmoneyCreatePaymentRequest(ctx, {
            amount: a.amount,
            description: a.description,
            toAccountId: a.to_account_id,
            generateLink: a.generate_link,
            expiresInHours: a.expires_in_hours,
            merchantCategory: a.merchant_category,
          })
        ),
    },
    {
      def: {
        name: "moltmoney_pay_payment_request",
        description:
          "Pay a MoltMoney payment request that is addressed TO this account (only the recipient can pay; Elio refuses other targets before any approval). REQUIRES HUMAN APPROVAL via Sentinel — paying moves money immediately. Do not use for peer-to-peer transfers without an existing request (use moltmoney_send_payment) or for purchases (use moltmoney_create_paypal_order). Never retry or duplicate.",
        parameters: {
          type: "object",
          properties: {
            request_id: str("MoltMoney payment request id, from moltmoney_list_payment_requests"),
          },
          required: ["request_id"],
        },
      },
      run: (ctx, a) =>
        import("../connectors/moltmoney").then((m) =>
          m.moltmoneyPayPaymentRequest(ctx, a.request_id)
        ),
    }
  );
}
