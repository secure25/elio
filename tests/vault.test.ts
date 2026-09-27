import { describe, it, expect, beforeAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import {
  encrypt,
  decrypt,
  putSecret,
  getSecret,
  surrogateFor,
  resolveSurrogates,
  redact,
  deleteSecret,
} from "../src/lib/vault";

beforeAll(() => {
  try {
    deleteSecret("test_label");
  } catch {
    /* ignore */
  }
});

describe("vault encryption", () => {
  it("round-trips a secret", () => {
    const enc = encrypt("hunter2!");
    expect(enc.ciphertext).not.toContain("hunter2");
    expect(decrypt(enc)).toBe("hunter2!");
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe("surrogation", () => {
  it("stores + resolves surrogates without exposing real values", () => {
    putSecret("test_label", "card", "4111-1111-1111-1111");
    const surrogate = surrogateFor("test_label");
    expect(surrogate).toBe("{{vault:test_label}}");
    expect(surrogate).not.toContain("4111");

    const resolved = resolveSurrogates(`Pay with ${surrogate} please`);
    expect(resolved).toContain("4111-1111-1111-1111");

    // text containing the surrogate alone reveals nothing
    const shownToModel = `I'll pay with ${surrogate}`;
    expect(shownToModel).not.toContain("4111");
    deleteSecret("test_label");
  });
});

describe("redaction", () => {
  it("redacts common secret shapes", () => {
    const out = redact("my key sk-abcdef12345678901234 and card 4111111111111111 mail me@x.com");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("sk-abcdef12345678901234");
    expect(out).not.toContain("me@x.com");
  });
});
