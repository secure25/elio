import { NextResponse } from "next/server";
import { runMorningDigest, isDue, digestConfig } from "@/lib/digest";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/digests/run → generate (or force-regenerate with {"force":true}) the digest now.
export async function POST(req: Request) {
  const { force } = await req.json().catch(() => ({ force: false }));
  const digest = await runMorningDigest(Boolean(force));
  return NextResponse.json({ digest, wasDue: isDue(), config: digestConfig() });
}
