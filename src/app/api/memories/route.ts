import { NextRequest, NextResponse } from "next/server";
import { listMemories, forget, remember } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ memories: listMemories() });
}

export async function POST(req: NextRequest) {
  // User-added facts go into the real memories table so the page can read them back.
  const { content, category } = (await req.json()) as { content?: string; category?: string };
  if (!content || !content.trim()) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  remember(content.trim(), category || "general", "user");
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const match = searchParams.get("match");
  if (!match) return NextResponse.json({ error: "match required" }, { status: 400 });
  const n = forget(match);
  return NextResponse.json({ deleted: n });
}
