import { describe, it, expect, beforeAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { tryHandleDigestReply } from "../src/lib/digest-commands";
import { db, uuid, now } from "../src/lib/db";
import { guard } from "../src/lib/sentinel";
import { whenIdle } from "../src/lib/agent/runner";

function seedTask(goal: string, status: string): string {
  const id = uuid();
  db.prepare(
    "INSERT INTO tasks (id, conversation_id, goal, status, created_at, updated_at) VALUES (?,?,?,?,?,?)"
  ).run(id, null, goal, status, now(), now());
  return id;
}

function seedApproval(action: string): string {
  const v = guard({ action, detail: `test ${action} for ${uuid().slice(0, 8)}` });
  return v.approvalId!;
}

beforeAll(async () => {
  await whenIdle(); // let any background retry runs finish before cleaning tables
  db.prepare("DELETE FROM tasks").run();
  db.prepare("DELETE FROM approvals").run();
  db.prepare("DELETE FROM digests").run();
  db.prepare("DELETE FROM messages").run();
});

describe("retry the failed one", () => {
  it("retries failed tasks and reports them", async () => {
    const id1 = seedTask("Watch flights AUS→JFK", "failed");
    seedTask("Find a road bike", "failed");
    seedTask("Unrelated done task", "done"); // must NOT be retried

    const r = tryHandleDigestReply("Retry the failed one", "conv1");
    expect(r).not.toBeNull();
    expect(r!.handled).toBe(true);
    expect(r!.reply).toContain("Restarted 2 failed tasks");
    expect(r!.reply).toContain("Watch flights AUS→JFK");
    expect(r!.newTaskId).toBeTruthy();

    // original failed tasks untouched (retry creates NEW tasks with the same goal)
    const orig = db.prepare("SELECT status FROM tasks WHERE id = ?").get(id1) as any;
    expect(orig.status).toBe("failed");
    // two fresh rows exist for the retried goals (2 original + 2 retries)
    const rows = db
      .prepare(
        "SELECT COUNT(*) c FROM tasks WHERE goal IN ('Watch flights AUS→JFK','Find a road bike')"
      )
      .get() as any;
    expect(rows.c).toBe(4);

    // let the background queue drain: retried tasks fail fast (no LLM key in tests)
    await whenIdle();
    const retriedFailed = (
      db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='failed'").get() as any
    ).c;
    expect(retriedFailed).toBeGreaterThanOrEqual(2);
  });

  it("reports when there is nothing to retry", () => {
    db.prepare("DELETE FROM tasks").run();
    const r = tryHandleDigestReply("retry the failed one", "conv1");
    expect(r!.handled).toBe(true);
    expect(r!.reply).toContain("no failed tasks");
  });

  it("accepts phrasing variants", () => {
    seedTask("Another goal", "failed");
    expect(tryHandleDigestReply("run it again", "conv1")!.handled).toBe(true);
    expect(tryHandleDigestReply("Please retry the failed tasks!", "conv1")!.handled).toBe(true);
    db.prepare("DELETE FROM tasks").run();
  });

  it("does not match 'approve' commands", () => {
    const r = tryHandleDigestReply("approve all", "conv1");
    // approve path handles it (empty approvals) — not the retry path
    expect(r!.reply).not.toContain("Restarted");
  });
});

describe("approve all (safety-critical)", () => {
  it("resolves only pending approvals, only on explicit command", () => {
    const a1 = seedApproval("calendar.create");
    const a2 = seedApproval("browser.submit");

    const r = tryHandleDigestReply("approve all", "conv1");
    expect(r!.handled).toBe(true);
    expect(r!.reply).toContain("Approved 2 pending actions");

    for (const id of [a1, a2]) {
      const row = db.prepare("SELECT status FROM approvals WHERE id = ?").get(id) as any;
      expect(row.status).toBe("approved");
    }
  });

  it("NEVER approves on bare affirmation — falls through to the agent", () => {
    seedApproval("gmail.send");
    seedApproval("browser.submit");
    for (const text of ["yes", "ok", "ok cool", "yep go ahead", "sure thing", "yes please"]) {
      expect(tryHandleDigestReply(text, "conv1")).toBeNull();
    }
    // the seeded approvals must still be pending
    const pending = db.prepare("SELECT COUNT(*) c FROM approvals WHERE status='pending'").get() as any;
    expect(pending.c).toBe(2);
  });

  it("reports when nothing is pending", () => {
    db.prepare("DELETE FROM approvals").run();
    const r = tryHandleDigestReply("approve all", "conv1");
    expect(r!.reply).toContain("Nothing is waiting");
  });
});

describe("what's next / status", () => {
  it("summarizes approvals, running tasks, and failures", () => {
    seedApproval("calendar.create");
    seedTask("Active goal", "running");
    seedTask("Broken goal", "failed");
    const r = tryHandleDigestReply("what's next", "conv1");
    expect(r!.handled).toBe(true);
    expect(r!.reply).toContain("Waiting on you (1)");
    expect(r!.reply).toContain("In progress");
    expect(r!.reply).toContain("Broken goal");
    expect(r!.reply).toContain("approve all");
  });

  it("says when all clear", () => {
    db.prepare("DELETE FROM tasks").run();
    db.prepare("DELETE FROM approvals").run();
    const r = tryHandleDigestReply("status", "conv1");
    expect(r!.reply).toContain("All clear");
  });
});

describe("show the digest", () => {
  it("re-displays the latest digest and marks it read", () => {
    db.prepare(
      "INSERT INTO digests (id, ts, kind, body, read, meta) VALUES (?,?,?,?,0,'{}')"
    ).run("d1", now(), "morning", "DIGEST_BODY_MARKER");
    const r = tryHandleDigestReply("show the digest", "conv1");
    expect(r!.handled).toBe(true);
    expect(r!.reply).toContain("DIGEST_BODY_MARKER");
    const d = db.prepare("SELECT read FROM digests WHERE id='d1'").get() as any;
    expect(d.read).toBe(1);
  });
});

describe("non-commands fall through", () => {
  it("returns null for normal goals", () => {
    expect(tryHandleDigestReply("Find me a used road bike under $800", "conv1")).toBeNull();
    expect(tryHandleDigestReply("What's the weather tomorrow?", "conv1")).toBeNull();
    expect(tryHandleDigestReply("Email Dana the meeting notes", "conv1")).toBeNull();
  });
});
