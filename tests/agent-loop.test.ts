import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { db, uuid, now } from "../src/lib/db";

// Fake adapter: first call requests a tool, second call returns final text.
const fakeAdapter = {
  provider: "fake",
  model: "fake-1",
  complete: vi
    .fn()
    .mockResolvedValueOnce({
      text: "",
      toolCalls: [{ id: "t1", name: "web_search", args: JSON.stringify({ query: "best coffee austin" }) }],
      usage: { promptTokens: 10, completionTokens: 5 },
    })
    .mockResolvedValueOnce({
      text: "All done! Here is your summary.",
      toolCalls: [{ id: "t2", name: "task_complete", args: JSON.stringify({ summary: "All done!" }) }],
      usage: { promptTokens: 20, completionTokens: 10 },
    }),
};

vi.mock("../src/lib/llm", () => ({
  getAdapter: () => fakeAdapter,
}));

import { runAgent } from "../src/lib/agent/loop";

beforeAll(() => {
  db.prepare("DELETE FROM task_steps").run();
  db.prepare("DELETE FROM tasks").run();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM audit_log").run();
});

describe("agent loop with fake LLM", () => {
  it("executes tool calls, records steps, and finishes with a final message", async () => {
    const convId = uuid();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)").run(
      convId,
      "test",
      now(),
      now()
    );

    const events: any[] = [];
    const { finalText } = await runAgent("find coffee", {
      taskId: null,
      conversationId: convId,
      maxSteps: 5,
      onEvent: (e) => events.push(e),
    });

    expect(finalText).toContain("All done");
    expect(fakeAdapter.complete).toHaveBeenCalledTimes(2);

    const kinds = events.map((e) => e.type);
    expect(kinds).toContain("final");

    const toolSteps = events.filter((e) => e.type === "step" && e.kind === "tool.web_search");
    expect(toolSteps.length).toBe(1);
    expect(events.some((e) => e.type === "step" && e.kind === "tool.task_complete")).toBe(true);
  });

  it("handles unknown tools gracefully", async () => {
    fakeAdapter.complete
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "u1", name: "does_not_exist", args: "{}" }],
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        text: "done anyway",
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1 },
      });

    const convId = uuid();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)").run(
      convId,
      "test2",
      now(),
      now()
    );
    const { finalText } = await runAgent("x", { taskId: null, conversationId: convId, maxSteps: 3 });
    expect(finalText).toBe("done anyway");
  });
});
