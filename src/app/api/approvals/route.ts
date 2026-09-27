import { NextRequest, NextResponse } from "next/server";
import { resolveApproval, listApprovals } from "@/lib/sentinel";
import { resumeTaskForApproval } from "@/lib/agent/runner";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  return NextResponse.json({ approvals: listApprovals(status) });
}

export async function POST(req: NextRequest) {
  const { approvalId, approve } = (await req.json()) as { approvalId: string; approve: boolean };
  if (!approvalId || typeof approve !== "boolean") {
    return NextResponse.json({ error: "approvalId and approve required" }, { status: 400 });
  }
  const resolved = resolveApproval(approvalId, approve);
  if (!resolved) return NextResponse.json({ error: "not pending" }, { status: 404 });
  void resumeTaskForApproval(approvalId);
  return NextResponse.json({ ok: true, resolved });
}
