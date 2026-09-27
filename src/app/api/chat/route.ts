import { NextRequest, NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { createTask, enqueueTask, getTask, getSteps } from "@/lib/agent/runner";
import { extractMemories } from "@/lib/memory";
import { tryHandleDigestReply } from "@/lib/digest-commands";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { message: string; conversationId?: string };
  const message = (body.message || "").trim();
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  let conversationId = body.conversationId;
  if (!conversationId) {
    conversationId = uuid();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)").run(
      conversationId,
      message.slice(0, 60),
      now(),
      now()
    );
  } else {
    db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now(), conversationId);
  }

  // Store the user message
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
  ).run(uuid(), conversationId, "user", message, null, now());

  // Fast path: deterministic digest-reply commands (no LLM needed, free, instant).
  const command = tryHandleDigestReply(message, conversationId);
  if (command?.handled) {
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)"
    ).run(
      uuid(),
      conversationId,
      "assistant",
      command.reply,
      JSON.stringify({
        digestCommand: true,
        ...(command.newTaskId ? { taskId: command.newTaskId } : {}),
      }),
      now()
    );
    return NextResponse.json({ conversationId, taskId: command.newTaskId ?? null, digestCommand: true });
  }

  // Memory extraction (non-blocking for the response)
  void extractMemories(message).catch(() => {});

  const taskId = createTask(message, conversationId);
  enqueueTask(taskId, conversationId, message);

  return NextResponse.json({ conversationId, taskId });
}

export async function GET(req: NextRequest) {
  // Poll task status + steps
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  const task = getTask(taskId);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  const steps = getSteps(taskId);
  const messages = db
    .prepare(
      "SELECT id, role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at"
    )
    .all((task as any).conversation_id);
  const approvals = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC")
    .all(taskId);
  return NextResponse.json({ task, steps, messages, approvals });
}
