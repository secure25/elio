import { describe, it, expect, beforeAll, afterEach } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import {
  digestConfig,
  setDigestConfig,
  isDue,
  runMorningDigest,
  listDigests,
  markDigestRead,
  unreadDigestCount,
} from "../src/lib/digest";
import { db, now, uuid } from "../src/lib/db";

beforeAll(() => {
  db.prepare("DELETE FROM digests").run();
  db.prepare("DELETE FROM tasks").run();
  db.prepare("DELETE FROM approvals").run();
  setDigestConfig({ hour: 0, enabled: true, emailEnabled: false });
});

// Restore canonical config after every test so failures can't cascade.
afterEach(() => {
  setDigestConfig({ hour: 0, enabled: true, emailEnabled: false });
});

describe("digest config", () => {
  it("exposes hour + enabled + emailEnabled", () => {
    const c = digestConfig();
    expect(c).toMatchObject({ hour: 0, enabled: true, emailEnabled: false });
  });

  it("persists config changes", () => {
    setDigestConfig({ hour: 7, enabled: false });
    expect(digestConfig()).toMatchObject({ hour: 7, enabled: false });
  });

  it("rejects invalid hours", () => {
    setDigestConfig({ hour: 99 });
    expect(digestConfig().hour).toBe(0);
  });
});

describe("isDue", () => {
  it("is not due when disabled", () => {
    setDigestConfig({ enabled: false });
    expect(isDue()).toBe(false);
  });

  it("is due after the hour when no digest exists today", () => {
    db.prepare("DELETE FROM digests").run();
    setDigestConfig({ hour: 0, enabled: true });
    expect(isDue()).toBe(true); // 00:00 today has passed (except within midnight second)
  });

  it("is not due when today's digest already exists", async () => {
    await runMorningDigest(true); // create one now
    expect(isDue()).toBe(false);
  });
});

describe("runMorningDigest", () => {
  it("produces a fallback digest with goal + suggestion sections", async () => {
    db.prepare(
      "INSERT INTO tasks (id, conversation_id, goal, status, created_at, updated_at) VALUES (?,?,?,?,?,?)"
    ).run(uuid(), null, "Watch flights AUS→JFK", "done", now() - 3600e3, now() - 1800e3);
    const d = await runMorningDigest(true);
    expect(d.body).toContain("Background goals");
    expect(d.body).toContain("Watch flights AUS→JFK");
    expect(d.body).toContain("Suggested next actions");
    expect(JSON.parse(d.meta || "{}").source).toBe("fallback");
    expect(d.meta).not.toContain("email"); // email off by default
  });

  it("is idempotent per day without force", async () => {
    await runMorningDigest(true);
    const before = listDigests().length;
    await runMorningDigest(false); // today's already exists → returns it unchanged
    expect(listDigests().length).toBe(before);
  });

  it("marks unread and supports markRead", async () => {
    const d = await runMorningDigest(true);
    expect(unreadDigestCount()).toBeGreaterThan(0);
    markDigestRead(d.id);
    expect(
      (db.prepare("SELECT read FROM digests WHERE id = ?").get(d.id) as any).read
    ).toBe(1);
  });
});
