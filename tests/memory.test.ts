import { describe, it, expect } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { remember, forget, listMemories } from "../src/lib/memory";

describe("memory store", () => {
  it("remembers, lists, and forgets user facts", () => {
    const marker = "memtest-" + Date.now();
    remember(marker + " prefers window seats", "preferences", "user");

    const found = listMemories().find((m) => m.content.includes(marker));
    expect(found).toBeDefined();
    expect(found!.category).toBe("preferences");

    const n = forget(marker);
    expect(n).toBeGreaterThan(0);
    expect(listMemories().find((m) => m.content.includes(marker))).toBeUndefined();
  });
});
