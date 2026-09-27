import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

// Fake LLM adapter returns a canned digest.
const fakeAdapter = {
  provider: "fake",
  model: "fake-1",
  complete: vi.fn().mockResolvedValue({
    text:
      "## Morning\n\nYou made progress on the bike hunt. " +
      "**Suggested next actions:**\n- Approve the email draft\n- Re-check prices tonight",
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 20 },
  }),
};

vi.mock("../src/lib/llm", () => ({ getAdapter: () => fakeAdapter }));

import { runMorningDigest, listDigests } from "../src/lib/digest";
import { db } from "../src/lib/db";

beforeAll(() => {
  db.prepare("DELETE FROM digests").run();
});

describe("digest LLM path", () => {
  it("uses the LLM to compose when a key is configured", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const d = await runMorningDigest(true);
    expect(fakeAdapter.complete).toHaveBeenCalledTimes(1);
    expect(d.body).toContain("Suggested next actions");
    expect(JSON.parse(d.meta || "{}").source).toBe("llm");
    process.env.GEMINI_API_KEY = "";
    expect(listDigests().length).toBe(1);
  });
});
