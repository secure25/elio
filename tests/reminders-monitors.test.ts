import { describe, it, expect, beforeAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { db, uuid, now } from "../src/lib/db";
import {
  parseWhen,
  createReminder,
  listReminders,
  cancelReminder,
  fireDueReminders,
} from "../src/lib/reminders";
import { createMonitor, listMonitors, setMonitorStatus, deleteMonitor, dueMonitors } from "../src/lib/monitors";
import { classify } from "../src/lib/sentinel";

beforeAll(() => {
  db.prepare("DELETE FROM reminders").run();
  db.prepare("DELETE FROM monitors").run();
});

describe("parseWhen", () => {
  it("parses relative, tonight, tomorrow, and bare times", () => {
    const in20 = parseWhen("in 20 minutes");
    expect(in20).toBeGreaterThan(Date.now() + 19 * 60_000);
    expect(in20).toBeLessThan(Date.now() + 21 * 60_000);

    const tonight = parseWhen("tonight");
    expect(new Date(tonight!).getHours()).toBe(20);

    const tomorrow9 = parseWhen("tomorrow 9am");
    const d = new Date(tomorrow9!);
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(new Date(Date.now() + 864e5).getDate());

    const evening = parseWhen("tomorrow 7:30pm");
    expect(new Date(evening!).getHours()).toBe(19);
    expect(new Date(evening!).getMinutes()).toBe(30);

    const pastSafe = parseWhen("5am"); // already past → tomorrow
    expect(pastSafe).toBeGreaterThan(Date.now());
  });

  it("rejects gibberish", () => {
    expect(parseWhen("sometime maybe")).toBeNull();
  });
});

describe("reminders lifecycle", () => {
  it("creates, lists, and fires due reminders into chat", async () => {
    const convId = uuid();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, 'test', ?, ?)").run(
      convId,
      now(),
      now()
    );
    const r = createReminder({ content: "Call the dentist", when: "in 0 minutes", conversationId: convId });
    expect(r.ok).toBe(true);
    const id = r.id as string;
    const due = listReminders(false);
    expect(due.length).toBeGreaterThan(0);

    // Force it due, then fire.
    db.prepare("UPDATE reminders SET due_at = ? WHERE id = ?").run(now() - 1000, id);
    const fired = await fireDueReminders();
    expect(fired).toBe(1);

    const msgs = db
      .prepare("SELECT content FROM messages WHERE conversation_id = ? AND role='assistant'")
      .all(convId) as any[];
    expect(msgs.some((m) => m.content.includes("Call the dentist"))).toBe(true);

    // No approval rows should be created for owner-only reminder delivery.
    const pend = db.prepare("SELECT COUNT(*) n FROM approvals WHERE action='message.send_reminder' AND status='pending'").get() as any;
    expect(pend.n).toBe(0);
  });

  it("cancels by id and by text match", () => {
    const a = createReminder({ content: "Water the plants", when: "tomorrow 9am" });
    const b = createReminder({ content: "Water the ferns", when: "tomorrow 9am" });
    expect(a.ok && b.ok).toBe(true);
    expect(cancelReminder("Water the")).toBe(2);
    expect(listReminders(false).length).toBe(0);
  });

  it("rejects unparseable times", () => {
    const r = createReminder({ content: "x", when: "sometime" });
    expect(r.ok).toBe(false);
  });
});

describe("monitors lifecycle", () => {
  it("creates with cadence, becomes due per cadence, pauses and deletes", () => {
    const m = createMonitor({ prompt: "watch the price of the Anker charger under $30", cadence: "hourly" });
    expect(m.ok).toBe(true);
    const rows = listMonitors("active");
    expect(rows.length).toBe(1);
    expect(rows[0].cadence).toBe("hourly");

    // Never run yet → immediately due.
    expect(dueMonitors().length).toBe(1);

    // Simulate a fresh run → not due within the hour.
    db.prepare("UPDATE monitors SET last_run = ? WHERE id = ?").run(now(), rows[0].id);
    expect(dueMonitors().length).toBe(0);

    // Old run → due again.
    db.prepare("UPDATE monitors SET last_run = ? WHERE id = ?").run(now() - 2 * 3600_000, rows[0].id);
    expect(dueMonitors().length).toBe(1);

    expect(setMonitorStatus(rows[0].id, "paused")).toBe(true);
    expect(dueMonitors().length).toBe(0); // paused monitors never due
    expect(deleteMonitor(rows[0].id)).toBe(true);
    expect(listMonitors().length).toBe(0);
  });

  it("refuses empty watch prompts", () => {
    expect(createMonitor({ prompt: "watch" }).ok).toBe(false);
  });
});

describe("sentinel classes", () => {
  it("classifies scheduled delivery as allow and owner sends as allow", () => {
    expect(classify("message.send_reminder").decision).toBe("allow");
    expect(classify("monitor.run").decision).toBe("allow");
    expect(classify("message.send").decision).toBe("allow");
  });
});
