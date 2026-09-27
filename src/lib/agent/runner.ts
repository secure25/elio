// ── Task runner: queue + background execution ──
// Tasks persist in SQLite and continue server-side even if the tab closes.
import { db, now, uuid, audit, addStep } from "../db";
import { runAgent, type AgentEvent } from "./loop";
import { guard, listApprovals } from "../sentinel";

interface QueueItem {
  taskId: string;
  conversationId: string | null;
  goal: string;
  onEvent?: (e: AgentEvent) => void;
}

const queue: QueueItem[] = [];
let processing = false;

/** Resolves when the background queue is fully drained (used by tests). */
export function whenIdle(): Promise<void> {
  if (!processing && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      if (!processing && queue.length === 0) {
        clearInterval(iv);
        resolve();
      }
    }, 25);
  });
}

export function createTask(goal: string, conversationId: string | null): string {
  const id = uuid();
  db.prepare(
    "INSERT INTO tasks (id, conversation_id, goal, status, created_at, updated_at) VALUES (?,?,?,'pending',?,?)"
  ).run(id, conversationId ?? null, goal, now(), now());
  audit("runner", "task.created", { target: id, detail: goal.slice(0, 200) });
  return id;
}

export function enqueueTask(taskId: string, conversationId: string | null, goal: string) {
  queue.push({ taskId, conversationId, goal });
  void processQueue();
}

export function getTask(id: string) {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}

/** Create a fresh task from a failed one's goal and enqueue it. Returns the new task id. */
export function retryTask(failedTaskId: string, conversationId: string | null): string {
  const original = db.prepare("SELECT * FROM tasks WHERE id = ?").get(failedTaskId) as any;
  if (!original) throw new Error(`Task ${failedTaskId} not found`);
  // FK safety: only attach a conversation that actually exists (else NULL).
  let convId: string | null = conversationId || original.conversation_id || null;
  if (convId) {
    const exists = db.prepare("SELECT id FROM conversations WHERE id = ?").get(convId);
    if (!exists) convId = null;
  }
  const newId = createTask(original.goal, convId);
  audit("runner", "task.retried", { target: newId, detail: `retry of ${failedTaskId}: ${original.goal.slice(0, 120)}` });
  enqueueTask(newId, convId || "", original.goal);
  return newId;
}

export function listTasks() {
  return db
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50")
    .all();
}

export function getSteps(taskId: string) {
  return db.prepare("SELECT * FROM task_steps WHERE task_id = ? ORDER BY seq").all(taskId);
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await runTask(item);
    }
  } finally {
    processing = false;
  }
}

export async function runTask(item: QueueItem) {
  const { taskId, goal } = item;
  const conversationId = item.conversationId;
  // Keep the Secure Workspace panel live for the duration of the task
  // (frames refresh every 2.5s while the browser VM is in use).
  const { noteTaskActive } = await import("../connectors/browser");
  noteTaskActive();
  // Conversation may be null (headless retry tasks); the agent still runs and
  // records steps, we just can't post chat messages without a conversation.
  db.prepare("UPDATE tasks SET status='running', updated_at=? WHERE id=?").run(now(), taskId);
  try {
    const { finalText } = await runAgent(goal, {
      taskId,
      conversationId: conversationId || "",
      onEvent: item.onEvent,
    });
    db.prepare("UPDATE tasks SET status='done', updated_at=? WHERE id=?").run(now(), taskId);
    if (conversationId) {
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
      ).run(
        uuid(),
        conversationId,
        "assistant",
        finalText,
        JSON.stringify({ taskId }),
        now()
      );
    }
    notifyTaskResult(finalText);
  } catch (e: any) {
    db.prepare("UPDATE tasks SET status='failed', last_error=?, updated_at=? WHERE id=?").run(
      String(e.message || e),
      now(),
      taskId
    );
    addStep(taskId, "error", String(e.message || e));
    notifyTaskResult(`Something went wrong while working on this: ${e.message}`);
    if (!conversationId) return; // headless task: outcome visible in Tasks/Digest, no chat post
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
    ).run(
      uuid(),
      conversationId,
      "assistant",
      `Something went wrong while working on this: ${e.message}`,
      JSON.stringify({ taskId }),
      now()
    );
  }
}

// ── Telegram result delivery (owner's own chat, toggle-controlled) ──────
// When enabled (Settings → Behavior; default ON) and Telegram is connected,
// every finished task's final answer also goes to the owner's phone. Uses the
// non-interactive sender: the Sentinel classifies message.send_result as allow
// because the recipient is locked to the owner's vaulted chat and the content
// is Elio's own reply to the owner. Approvals intentionally stay in-app.
export async function notifyTaskResult(text: string): Promise<void> {
  try {
    const { getSetting } = await import("../db");
    if (getSetting("telegram_results_enabled") === "false") return;
    const { telegramConfigured, deliverTelegram } = await import("../connectors/messaging");
    if (!telegramConfigured()) return;
    const verdict = guard({ action: "message.send_result", detail: "Deliver task result to the owner's Telegram chat" });
    if (verdict.decision !== "allow") return;
    const body = text.length > 3000 ? text.slice(0, 2999) + "…" : text;
    await deliverTelegram(`📩 Elio — task result:\n\n${body}`);
  } catch {
    // never let a delivery hiccup affect the task outcome
  }
}

/** Called when an approval is resolved: if its task was waiting, resume the agent loop. */
export async function resumeTaskForApproval(approvalId: string) {
  const approval = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as any;
  if (!approval?.task_id) return;
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(approval.task_id) as any;
  if (!task) return;
  // The waitForApproval poll inside the connector sees the DB change; nothing else to do.
  // We just mark the task running again for UI freshness.
  if (task.status === "waiting_approval") {
    db.prepare("UPDATE tasks SET status='running', updated_at=? WHERE id=?").run(now(), task.id);
  }
}

export function pendingApprovalCount(): number {
  return (listApprovals("pending") as any[]).length;
}
