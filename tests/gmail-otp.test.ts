import { describe, it, expect, beforeAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { filterOtpContent } from "../src/lib/connectors/gmail";

beforeAll(() => {
  // importing gmail.ts pulls google-oauth → db; just ensure env is set
});

describe("gmail OTP filter", () => {
  it("filters one-time codes", () => {
    const out = filterOtpContent("Your verification code is 482913. Do not share it.");
    expect(out).not.toContain("482913");
    expect(out).toContain("[filtered");
  });

  it("filters Google-style codes", () => {
    const out = filterOtpContent("G-284913 is your Google verification code");
    expect(out).not.toContain("G-284913");
  });

  it("filters password-reset links", () => {
    const out = filterOtpContent("Reset here: https://accounts.example.com/reset?token=abc123");
    expect(out).not.toContain("reset?token=abc123");
  });

  it("leaves normal email text alone", () => {
    const text = "Lunch tomorrow at noon? The meeting moved to 3pm, see you then.";
    expect(filterOtpContent(text)).toBe(text);
  });
});
