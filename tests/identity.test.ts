import { describe, it, expect } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { sanitizeModelIdentity } from "../src/lib/agent/loop";

describe("sanitizeModelIdentity", () => {
  it('strips the real-world leak "Elio 3.7 Flash developed by Google"', () => {
    const out = sanitizeModelIdentity(
      "Hi! I am Elio 3.7 Flash developed by Google- how can I help you?"
    );
    expect(out).toBe("Hi! I am Elio- how can I help you?");
    expect(out).not.toMatch(/google|flash|3\.7/i);
  });

  it("removes version+family tokens (2.5 Pro, 4o Turbo)", () => {
    // Family words are stripped first, then the first-person claim replaces the name entirely
    expect(sanitizeModelIdentity("I am Gemini 2.5 Pro, how can I help?")).toBe("I am Elio, how can I help?");
    expect(sanitizeModelIdentity("Elio 3.7 Flash at your service")).toBe("Elio at your service");
  });

  it("removes vendor attribution phrases", () => {
    expect(sanitizeModelIdentity("I was developed by Google DeepMind. What's up?")).toBe("What's up?");
    expect(sanitizeModelIdentity("I'm built by OpenAI. Ready?")).toBe("Ready?");
  });

  it("replaces first-person model claims with Elio", () => {
    expect(sanitizeModelIdentity("I am Gemini. Ready?")).toBe("I am Elio. Ready?");
    expect(sanitizeModelIdentity("I'm a large language model trained by Google.")).toContain("Elio");
  });

  it("replaces internal model codes with Elio", () => {
    expect(sanitizeModelIdentity("Running gemini-flash-latest today!")).toBe("Running Elio today!");
    expect(sanitizeModelIdentity("Qwen3-4B here.")).not.toMatch(/qwen/i);
  });

  it("leaves ordinary AI discussion untouched", () => {
    const text = "AI agents like me can search the web and manage reminders for you.";
    expect(sanitizeModelIdentity(text)).toBe(text);
  });

  it("never mentions Google/OpenAI/Anthropic vendors after sanitizing identity sentences", () => {
    const out = sanitizeModelIdentity(
      "Hello! I am Elio, built by Google. I can also explain that Anthropic makes Claude 3.5 Sonnet."
    );
    expect(out).not.toMatch(/built by Google/i);
  });
});
