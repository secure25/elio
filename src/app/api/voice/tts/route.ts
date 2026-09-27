import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { statSync } from "node:fs";
import { synthAudio } from "@/lib/voice";

export const runtime = "nodejs";

// POST { text } → audio stream (audio/mpeg for ElevenLabs, audio/wav for Piper/SAPI).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "text too long" }, { status: 400 });
  }

  const result = await synthAudio(text);
  if (!result) {
    return NextResponse.json(
      {
        error: "No TTS engine available",
        hint: "Set ELEVENLABS_API_KEY in .env, or install Piper (`npm run setup:voice`).",
      },
      { status: 503 }
    );
  }

  const size = statSync(result.filePath).size;
  const stream = createReadStream(result.filePath) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
