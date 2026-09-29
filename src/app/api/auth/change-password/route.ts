import { NextResponse } from "next/server";
import { now, audit } from "@/lib/db";
import { validateSession, getUserByEmail, verifyPassword, hashPassword } from "@/lib/auth";

// Read the session token from request headers (not next/headers `cookies()`),
// so the handler works both in production and when invoked directly in tests.
function sessionTokenFrom(req: Request): string | null {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(/(?:^|;\s*)elio_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── Change password (logged-in user, Settings → Security) ──────────────────
// Requires the CURRENT password — proves identity like a re-auth check.
export async function POST(req: Request) {
  try {
    const token = sessionTokenFrom(req);
    const user = token ? validateSession(token) : null;
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword || typeof newPassword !== "string") {
      return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters long." }, { status: 400 });
    }

    const full = getUserByEmail(user.email);
    if (!full || !full.password_hash || !full.salt) {
      return NextResponse.json({ error: "Account has no password set." }, { status: 400 });
    }
    if (!verifyPassword(currentPassword, full.password_hash, full.salt)) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const { hash, salt } = hashPassword(newPassword);
    const { db } = await import("@/lib/db");
    db.prepare("UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?").run(
      hash,
      salt,
      now(),
      user.id
    );

    audit(user.email, "password.changed", {
      detail: `Password changed for ${user.email}`,
      target: user.id,
      risk: "high",
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Password change failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
