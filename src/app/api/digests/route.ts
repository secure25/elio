import { NextRequest, NextResponse } from "next/server";
import {
  listDigests,
  markDigestRead,
  digestConfig,
  setDigestConfig,
  unreadDigestCount,
  emailDigest,
} from "@/lib/digest";
import { getGrant } from "@/lib/google-oauth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const grant = getGrant("gmail");
  return NextResponse.json({
    digests: listDigests(),
    unread: unreadDigestCount(),
    config: digestConfig(),
    gmail: {
      connected: grant?.status === "connected",
      account: grant?.account_email ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    markRead?: string;
    config?: { hour?: number; enabled?: boolean; emailEnabled?: boolean };
  };
  if (body.markRead) {
    markDigestRead(body.markRead);
    return NextResponse.json({ ok: true, unread: unreadDigestCount() });
  }
  if (body.config) {
    setDigestConfig(body.config);
    // Opting in: immediately email the latest digest so the user can confirm delivery
    // works (explicit user action → self-addressed send is fine; meta records it).
    if (body.config.emailEnabled === true) {
      const latest = listDigests(1)[0];
      if (latest) {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(latest.meta || "{}");
        } catch {}
        if (meta.email !== "sent") {
          const status = await emailDigest(latest.body);
          meta.email = status;
          db.prepare("UPDATE digests SET meta = ? WHERE id = ?").run(JSON.stringify(meta), latest.id);
        }
      }
    }
    return NextResponse.json({ ok: true, config: digestConfig() });
  }
  return NextResponse.json({ error: "markRead or config required" }, { status: 400 });
}
