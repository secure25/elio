import { NextResponse } from "next/server";
import { db, now, uuid, audit } from "@/lib/db";
import { getUserByEmail } from "@/lib/auth";

// ── Forgot password: mint a single-use reset token, email it to the owner ──
// Always returns ok:true (never reveals whether the email is registered).
// Token is emailed through the Gmail connector, hard-locked to the account
// owner's connected address — never to a caller-supplied address.
export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const user = getUserByEmail(email);
    audit("system", "password.reset_requested", {
      detail: user ? `Reset token issued for ${user.email}` : `Reset requested for unknown email`,
    });

    if (!user) {
      // Do not reveal account existence.
      return NextResponse.json({ ok: true });
    }

    const token = uuid() + uuid().replace(/-/g, "");
    const expiresAt = now() + 30 * 60 * 1000; // 30 minutes

    db.prepare(
      "INSERT INTO password_resets (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(token, user.id, expiresAt, now());

    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const resetUrl = `${base}/reset-password?token=${token}`;

    const { gmailSendDigest } = await import("@/lib/connectors/gmail");
    const result = await gmailSendDigest(
      "Reset your Elio password",
      [
        "Hi,",
        "",
        "We received a request to reset your Elio password.",
        "Open this link within 30 minutes to choose a new one:",
        "",
        resetUrl,
        "",
        "If you didn't request this, you can safely ignore this email —",
        "your current password still works.",
      ].join("\n")
    );

    if (result !== "sent") {
      // Token exists but couldn't be delivered — tell the user honestly.
      return NextResponse.json({
        ok: true,
        delivery: result,
        hint: "Reset link was generated but could not be emailed. Is Gmail connected in Settings → Connectors?",
      });
    }
    return NextResponse.json({ ok: true, delivery: "sent" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Reset request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
