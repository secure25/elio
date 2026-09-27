import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, now, uuid } from "./db";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "elio_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url?: string | null;
  created_at: number;
  updated_at: number;
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const testHash = scryptSync(password, salt, 64);
    const originalHash = Buffer.from(hash, "hex");
    return timingSafeEqual(testHash, originalHash);
  } catch {
    return false;
  }
}

export function createUser(email: string, name: string, password?: string): User {
  const existing = getUserByEmail(email);
  if (existing) {
    throw new Error("User with this email already exists");
  }

  const id = uuid();
  const ts = now();
  let hash: string | null = null;
  let salt: string | null = null;

  if (password) {
    const res = hashPassword(password);
    hash = res.hash;
    salt = res.salt;
  }

  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, salt, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Member', ?, ?)`
  ).run(id, email.toLowerCase().trim(), name.trim(), hash, salt, ts, ts);

  return {
    id,
    email: email.toLowerCase().trim(),
    name: name.trim(),
    role: "Member",
    created_at: ts,
    updated_at: ts,
  };
}

export function getUserByEmail(email: string): (User & { password_hash?: string | null; salt?: string | null }) | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as
    | (User & { password_hash?: string | null; salt?: string | null })
    | undefined;
  return row || null;
}

export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT id, email, name, role, avatar_url, created_at, updated_at FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
  return row || null;
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const id = uuid();
  const ts = now();
  const expiresAt = ts + SESSION_MAX_AGE_SEC * 1000;

  db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, token, expiresAt, ts);

  return token;
}

export function validateSession(token: string): User | null {
  if (!token) return null;
  const ts = now();
  const row = db.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.created_at, u.updated_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, ts) as User | undefined;

  return row || null;
}

export function deleteSession(token: string) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return validateSession(sessionToken);
}

export function updateUser(id: string, updates: { name?: string; role?: string }) {
  const ts = now();
  if (updates.name && updates.role) {
    db.prepare("UPDATE users SET name = ?, role = ?, updated_at = ? WHERE id = ?").run(updates.name, updates.role, ts, id);
  } else if (updates.name) {
    db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(updates.name, ts, id);
  } else if (updates.role) {
    db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(updates.role, ts, id);
  }
}

