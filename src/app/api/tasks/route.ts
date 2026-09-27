import { NextResponse } from "next/server";
import { listTasks } from "@/lib/agent/runner";
import { ensureBoot } from "@/lib/boot";

export const runtime = "nodejs";

export async function GET() {
  ensureBoot();
  return NextResponse.json({ tasks: listTasks() });
}
