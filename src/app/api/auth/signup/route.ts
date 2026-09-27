import { NextResponse } from "next/server";
import { createUser, createSession, getUserByEmail, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SEC } from "@/lib/auth";
import { audit } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long." }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Please provide your name." }, { status: 400 });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists. Please log in." }, { status: 409 });
    }

    const user = createUser(email, name, password);
    const token = createSession(user.id);

    audit(user.name, "user.signup", { detail: `Account created for ${user.email}`, target: user.id });

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
    const message = err instanceof Error ? err.message : "Signup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

