import { describe, it, expect } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = process.env.MUSE_DATA_DIR || "./data-test";

import { gateDecision, toolsForStep } from "../src/lib/agent/loop";
import { toolDefs } from "../src/lib/agent/tools";
import { db, uuid, now } from "../src/lib/db";

// Inert conversation id: the DB has no tool activity for it → history passes.
const NO_HISTORY = "00000000-0000-4000-8000-000000000000";

describe("tool gate — NONE (clearly pure conversation)", () => {
  const cases = [
    "Hi",
    "Hello",
    "Hey",
    "How are you?",
    "Thanks",
    "Thank you",
    "Good morning",
    "Good night",
    "What is an API?",
    "Explain APIs to me",
    "What is machine learning?",
    "Explain how Docker works",
    "Tell me what a database is",
    "What did we talk about earlier?",
  ];
  for (const text of cases) {
    it(`NONE: "${text}"`, () => {
      expect(gateDecision(text, NO_HISTORY)).toBe("none");
    });
  }
});

describe("tool gate — FULL (task-shaped)", () => {
  const cases = [
    "What's the weather in Cape Town?",
    "Search the web for the latest AI news.",
    "Find the cheapest VPS for hosting Qwen.",
    "Send John a Telegram message saying hello.",
    "Remind me tomorrow at 9 AM.",
    "Create a calendar event for Monday.",
    "Open this website.",
    "Check my Gmail.",
    // Ambiguity → fail open to FULL
    "Send it.",
    "Do that.",
    "Check that.",
    "Find out more.",
  ];
  for (const text of cases) {
    it(`FULL: "${text}"`, () => {
      expect(gateDecision(text, NO_HISTORY)).toBe("full");
    });
  }
});

describe("tool gate — safety rules", () => {
  it("explicit tool name → FULL even inside pure-conversation wording", () => {
    expect(gateDecision("Hi, use web_search for me", NO_HISTORY)).toBe("full");
    expect(gateDecision("call task_complete", NO_HISTORY)).toBe("full");
  });

  it("prior tool activity in the conversation → FULL", () => {
    const conv = uuid();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)").run(
      conv, "gate-test", now(), now()
    );
    const taskId = uuid();
    db.prepare(
      "INSERT INTO tasks (id, conversation_id, goal, status, created_at, updated_at) VALUES (?,?,?,'done',?,?)"
    ).run(taskId, conv, "history seed", now(), now());
    db.prepare("INSERT INTO task_steps (task_id, seq, kind, detail, created_at) VALUES (?,?,?,?,?)").run(
      taskId, 0, "tool.web_search", "history seed step", now()
    );
    expect(gateDecision("Hi", conv)).toBe("full");
  });

  it("step >= 1 → FULL regardless of text", () => {
    expect(toolsForStep("Hi", NO_HISTORY, 0)).toEqual([]);
    expect(toolsForStep("Hi", NO_HISTORY, 1)).toEqual(toolDefs());
    expect(toolsForStep("What's the weather?", NO_HISTORY, 2)).toEqual(toolDefs());
  });

  it("step 0 FULL decisions return the complete 27-tool registry", () => {
    expect(toolsForStep("Send it.", NO_HISTORY, 0)).toEqual(toolDefs());
    expect(toolDefs().length).toBe(27);
  });
});
