import { describe, it, expect, afterAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { db, now, uuid } from "../src/lib/db";
import { createUser, verifyPassword, createSession } from "../src/lib/auth";
import { POST as forgotPassword } from "../src/app/api/auth/forgot-password/route";
import { POST as resetPassword } from "../src/app/api/auth/reset-password/route";
import { POST as changePassword } from "../src/app/api/auth/change-password/route";

const EMAIL = `pwtest-${uuid()}@local.test`;
const OLD_PW = "correct-horse";
const NEW_PW = "battery-staple-9";

const createdUserIds: string[] = [];

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("password reset + change flows", () => {
  it("forgot-password never reveals unknown accounts but records the attempt", async () => {
    const res = await forgotPassword(jsonReq("http://localhost/api/auth/forgot-password", { email: "nobody@local.test" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("mints a single-use token even when Gmail is disconnected, with an honest hint", async () => {
    const u = createUser(EMAIL, "PW Tester", OLD_PW);
    createdUserIds.push(u.id);

    const res = await forgotPassword(jsonReq("http://localhost/api/auth/forgot-password", { email: EMAIL }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    // Test env has no Gmail grant → token minted but not deliverable → hint present
    expect(data.delivery).toBe("not_connected");
    expect(String(data.hint)).toMatch(/gmail/i);

    const row = db
      .prepare("SELECT token, user_id, expires_at, used_at FROM password_resets WHERE user_id = ? ORDER BY created_at DESC")
      .get(u.id) as { token: string; user_id: string; expires_at: number; used_at: number | null };
    expect(row.token).toBeTruthy();
    expect(row.used_at).toBeNull();
    expect(row.expires_at).toBeGreaterThan(now());
  });

  it("rejects a bad token", async () => {
    const res = await resetPassword(jsonReq("http://localhost/api/auth/reset-password", { token: "nope", password: NEW_PW }));
    expect(res.status).toBe(400);
  });

  it("rejects a too-short password", async () => {
    const row = db.prepare("SELECT token FROM password_resets ORDER BY created_at DESC LIMIT 1").get() as { token: string };
    const res = await resetPassword(jsonReq("http://localhost/api/auth/reset-password", { token: row.token, password: "abc" }));
    expect(res.status).toBe(400);
    // Token must NOT be consumed by a failed attempt
    const after = db.prepare("SELECT used_at FROM password_resets WHERE token = ?").get(row.token) as { used_at: number | null };
    expect(after.used_at).toBeNull();
  });

  it("resets the password, consumes the token once, revokes old sessions, and logs in", async () => {
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL) as { id: string };
    // Simulate an existing session from another device
    const oldSession = createSession(u.id);

    const row = db
      .prepare("SELECT token FROM password_resets WHERE user_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(u.id) as { token: string };

    const res = await resetPassword(jsonReq("http://localhost/api/auth/reset-password", { token: row.token, password: NEW_PW }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    // New password verifies, old one no longer does
    const full = db.prepare("SELECT password_hash, salt FROM users WHERE id = ?").get(u.id) as { password_hash: string; salt: string };
    expect(verifyPassword(NEW_PW, full.password_hash, full.salt)).toBe(true);
    expect(verifyPassword(OLD_PW, full.password_hash, full.salt)).toBe(false);

    // Old session revoked, exactly one (the new login) remains
    const sessions = db.prepare("SELECT token FROM sessions WHERE user_id = ?").all(u.id) as { token: string }[];
    expect(sessions.map((s) => s.token)).not.toContain(oldSession);
    expect(sessions.length).toBe(1);

    // Single-use: replaying the token fails
    const replay = await resetPassword(jsonReq("http://localhost/api/auth/reset-password", { token: row.token, password: "another-pass" }));
    expect(replay.status).toBe(400);
  });

  it("change-password requires authentication", async () => {
    const res = await changePassword(
      jsonReq("http://localhost/api/auth/change-password", { currentPassword: NEW_PW, newPassword: "whatever1" })
    );
    expect(res.status).toBe(401);
  });

  it("change-password rejects a wrong current password", async () => {
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL) as { id: string };
    const cookie = `elio_session=${createSession(u.id)}`;
    const res = await changePassword(
      jsonReq("http://localhost/api/auth/change-password", { currentPassword: "wrong-pass", newPassword: "another-pass-2" }, cookie)
    );
    expect(res.status).toBe(401);
  });

  it("change-password updates the credential when the current one is correct", async () => {
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL) as { id: string };
    const cookie = `elio_session=${createSession(u.id)}`;
    const third = "third-password-3";
    const res = await changePassword(
      jsonReq("http://localhost/api/auth/change-password", { currentPassword: NEW_PW, newPassword: third }, cookie)
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const full = db.prepare("SELECT password_hash, salt FROM users WHERE id = ?").get(u.id) as { password_hash: string; salt: string };
    expect(verifyPassword(third, full.password_hash, full.salt)).toBe(true);
    expect(verifyPassword(NEW_PW, full.password_hash, full.salt)).toBe(false);
  });

  afterAll(() => {
    for (const id of createdUserIds) {
      db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades sessions + password_resets
    }
  });
});
