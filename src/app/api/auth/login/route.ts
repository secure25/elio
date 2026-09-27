import { NextResponse } from "next/server";
import { getUserByEmail, verifyPassword, createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SEC } from "@/lib/auth";
import { audit } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const user = getUserByEmail(email);
    if (!user || !user.password_hash || !user.salt) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const valid = verifyPassword(password, user.password_hash, user.salt);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const token = createSession(user.id);
    audit(user.name, "user.login", { detail: `User logged in from ${user.email}`, target: user.id });

    const response = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SEC,
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

