import { NextRequest, NextResponse } from "next/server";
import { db, audit } from "@/lib/db";
import { exchangeCode, saveGrant, fetchAccountEmail } from "@/lib/google-oauth";

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
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3210";

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/connectors?error=${encodeURIComponent(error || "missing code/state")}`);
  }

  const key = `oauth_state_${state}`;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return NextResponse.redirect(`${base}/connectors?error=invalid+state`);
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);

  let connector = "gmail";
  try {
    connector = JSON.parse(row.value).connector;
  } catch {
    /* default */
  }
  const scopes = SCOPES[connector] || SCOPES.gmail;

  try {
    const tok = await exchangeCode(code, state);
    const email = await fetchAccountEmail(tok.access_token!);
    await saveGrant(connector, scopes, tok, email);
    return NextResponse.redirect(`${base}/connectors?connected=${connector}`);
  } catch (e: any) {
    audit("oauth", "callback.failed", { detail: String(e.message).slice(0, 300), risk: "medium" });
    return NextResponse.redirect(`${base}/connectors?error=${encodeURIComponent(String(e.message).slice(0, 200))}`);
  }
}
