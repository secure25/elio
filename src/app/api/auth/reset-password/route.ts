import { NextResponse } from "next/server";
import { db, now, audit } from "@/lib/db";
import { verifyPassword, hashPassword, createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SEC } from "@/lib/auth";

// ── Reset password: consume a single-use token, set the new password ────────
// Also revokes every existing session for that user (a reset implies the old
// credential may be compromised), then logs the user in on this device.
export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();

    if (!token || typeof token !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ error: "Token and new password are required." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long." }, { status: 400 });
    }

    const row = db
      .prepare(
        "SELECT token, user_id, expires_at, used_at FROM password_resets WHERE token = ?"
      )
      .get(token) as { token: string; user_id: string; expires_at: number; used_at: number | null } | undefined;

    if (!row || row.used_at !== null || row.expires_at < now()) {
      return NextResponse.json({ error: "This reset link is invalid, already used, or expired." }, { status: 400 });
    }

    const user = db.prepare("SELECT id, email FROM users WHERE id = ?").get(row.user_id) as
      | { id: string; email: string }
      | undefined;
    if (!user) {
      return NextResponse.json({ error: "Account no longer exists." }, { status: 400 });
    }

    const { hash, salt } = hashPassword(password);
    db.prepare("UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?").run(
      hash,
      salt,
      now(),
      user.id
    );

    // Consume the token, revoke other sessions, start a fresh one here.
    db.prepare("UPDATE password_resets SET used_at = ? WHERE token = ?").run(now(), token);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    const newToken = createSession(user.id);

    audit(user.email, "password.reset_completed", {
      detail: `Password reset completed for ${user.email}`,
      target: user.id,
      risk: "high",
    });

    const response = NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });
    response.cookies.set(SESSION_COOKIE_NAME, newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SEC,
      path: "/",
    });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Reset failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
