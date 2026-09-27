import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBoot } from "@/lib/boot";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  ensureBoot();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    const messages = db
      .prepare("SELECT id, role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at")
      .all(id);
    return NextResponse.json({ conversation: conv, messages });
  }
  const conversations = db
    .prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50")
    .all();
  return NextResponse.json({ conversations });
}
