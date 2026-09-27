import { NextResponse } from "next/server";
import { voiceStatus } from "@/lib/voice";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(voiceStatus());
}
