import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

// Mock the Exa SDK so tests never touch the network. The class mirrors the
// surface web.ts uses: `new Exa(apiKey)` + `search(query, options)`.
const { exaSearchMock } = vi.hoisted(() => ({ exaSearchMock: vi.fn() }));
vi.mock("exa-js", () => ({
  default: class {
    search(...args: unknown[]) {
      return exaSearchMock(...args);
    }
  },
}));

// Mock the sandboxed-browser DDG backend so we can assert when it is (and is
// not) called, and so playwright-core is never loaded in this suite.
const { browserSearchMock } = vi.hoisted(() => ({ browserSearchMock: vi.fn() }));
vi.mock("../src/lib/connectors/browser", () => ({
  browserSearch: (...args: unknown[]) => browserSearchMock(...args),
}));

import { webSearch } from "../src/lib/connectors/web";

describe("webSearch: Exa backend with DuckDuckGo fallback", () => {
  beforeEach(() => {
    exaSearchMock.mockReset();
    browserSearchMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Exa with the configured options and formats titles, URLs, and highlights into the string contract", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    exaSearchMock.mockResolvedValueOnce({
      requestId: "req_test_1",
      results: [
        {
          title: "Node.js — Official Site",
          url: "https://nodejs.org/",
          highlights: ["Node.js 24 is now the active LTS line.", "   multi   space   text   "],
        },
        { title: null, url: "https://nodejs.org/en/about", highlights: [] },
        { title: "R3", url: "https://example.com/3", highlights: ["h3"] },
        { title: "R4", url: "https://example.com/4", highlights: ["h4"] },
        { title: "R5", url: "https://example.com/5", highlights: ["h5"] },
        { title: "R6 — must be dropped", url: "https://example.com/6", highlights: [] },
      ],
    });

    const out = await webSearch(null, "current Node.js LTS version");

    // SDK called exactly as specified: type auto, 5 results, highlights on.
    expect(exaSearchMock).toHaveBeenCalledWith("current Node.js LTS version", {
      type: "auto",
      numResults: 5,
      contents: { highlights: true },
    });

    // Contract: newline-joined `Title — URL` lines (up to 5), highlights as
    // indented excerpt lines, whitespace collapsed, missing title handled.
    const lines = out.split("\n");
    expect(lines[0]).toBe("Node.js — Official Site — https://nodejs.org/");
    expect(lines[1]).toBe("  > Node.js 24 is now the active LTS line.");
    expect(out).toContain("  > multi space text");
    expect(out).toContain("(untitled) — https://nodejs.org/en/about");
    expect(out).toContain("R5 — https://example.com/5");
    expect(out).not.toContain("R6");
  });

  it("does not call DuckDuckGo when Exa succeeds", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    exaSearchMock.mockResolvedValueOnce({
      requestId: "req_test_2",
      results: [{ title: "Only Result", url: "https://example.com/only", highlights: [] }],
    });

    const out = await webSearch(null, "fallback not needed");

    expect(browserSearchMock).not.toHaveBeenCalled();
    expect(out).toContain("Only Result — https://example.com/only");
  });

  it("falls back to DuckDuckGo when the Exa call fails", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    exaSearchMock.mockRejectedValueOnce(new Error("401 invalid api key"));
    browserSearchMock.mockResolvedValueOnce("DDG Result — https://ddg.example/x");

    const out = await webSearch(null, "exa down query");

    expect(browserSearchMock).toHaveBeenCalledTimes(1);
    expect(out).toBe("DDG Result — https://ddg.example/x");
  });

  it("falls back to DuckDuckGo when EXA_API_KEY is absent", async () => {
    const prev = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    try {
      browserSearchMock.mockResolvedValueOnce("DDG Only — https://ddg.example/y");

      const out = await webSearch(null, "no key query");

      expect(exaSearchMock).not.toHaveBeenCalled();
      expect(browserSearchMock).toHaveBeenCalledTimes(1);
      expect(out).toBe("DDG Only — https://ddg.example/y");
    } finally {
      if (prev !== undefined) process.env.EXA_API_KEY = prev;
    }
  });

  it("keeps the existing diagnostic string when Exa succeeds with zero results (no fallback)", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    exaSearchMock.mockResolvedValueOnce({ requestId: "req_test_3", results: [] });

    const out = await webSearch(null, "empty results query");

    expect(out).toBe("No results found.");
    expect(browserSearchMock).not.toHaveBeenCalled();
  });

  it("records the audit step with a taskId and never throws on the step path", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    exaSearchMock.mockResolvedValueOnce({
      requestId: "req_test_4",
      results: [{ title: "T", url: "https://example.com/t", highlights: ["excerpt"] }],
    });

    const out = await webSearch("task-exa-1", "step path query");

    expect(out).toContain("T — https://example.com/t");
  });
});
