import { NextRequest, NextResponse } from "next/server";
import { db, uuid, now, audit } from "@/lib/db";
import { buildAuthUrl, googleOAuthConfigured, redirectUri } from "@/lib/google-oauth";

export const runtime = "nodejs";

const SCOPES: Record<string, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  gcal: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const connector = searchParams.get("connector") || "gmail";
  if (!SCOPES[connector]) return NextResponse.json({ error: "unknown connector" }, { status: 400 });
  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env" },
      { status: 400 }
    );
  }
  const state = uuid();
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    `oauth_state_${state}`,
    JSON.stringify({ connector, created: now() })
  );
  audit("oauth", "auth.started", { target: connector, detail: redirectUri() });
  return NextResponse.json({ url: buildAuthUrl(SCOPES[connector], state) });
}
