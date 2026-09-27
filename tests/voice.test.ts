import { describe, it, expect } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { cleanVoiceText } from "../src/lib/voice";

describe("cleanVoiceText", () => {
  it("strips fenced code blocks entirely", () => {
    const out = cleanVoiceText("Here is the plan:\n```bash\nnpm install evil\n```\nDone!");
    expect(out).not.toContain("npm install");
    expect(out).toContain("Here is the plan");
    expect(out).toContain("Done");
  });

  it("unwraps inline code and markdown emphasis", () => {
    expect(cleanVoiceText("Run `npm run dev` with **care** and # flair")).toBe(
      "Run npm run dev with care and flair"
    );
  });

  it("collapses markdown links to their label and bare URLs to 'a link'", () => {
    expect(cleanVoiceText("See [the docs](https://example.com/x) now")).toBe("See the docs now");
    expect(cleanVoiceText("Open https://example.com/very/long/path now")).toBe(
      "Open a link now"
    );
  });

  it("removes emoji and zero-width joiners", () => {
    expect(cleanVoiceText("Working ✅ on it 👍‍👩")).toBe("Working on it");
  });

  it("truncates very long text at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(400);
    const out = cleanVoiceText(long);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out.endsWith("…")).toBe(true);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("never speaks raw approval-card syntax or table pipes", () => {
    const out = cleanVoiceText("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).not.toContain("|");
  });
});
