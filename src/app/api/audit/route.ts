import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = db
    .prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT 300")
    .all();
  return NextResponse.json({ entries: rows });
}
