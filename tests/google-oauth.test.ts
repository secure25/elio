import { describe, it, expect, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { saveGrant, getGrant, getAccessToken } from "../src/lib/google-oauth";
import { db } from "../src/lib/db";

describe("Google OAuth token encryption & refresh lifecycle", () => {
  it("encrypts access and refresh tokens with their own IV and auth tags", async () => {
    const connector = "test_gmail";
    await saveGrant(
      connector,
      ["email", "profile"],
      {
        access_token: "test_access_token_12345",
        refresh_token: "test_refresh_token_67890",
        expires_in: 3600,
      },
      "user@example.com"
    );

    const grant = getGrant(connector);
    expect(grant).not.toBeNull();
    expect(grant?.status).toBe("connected");
    expect(grant?.account_email).toBe("user@example.com");

    // Both tokens are stored in self-contained JSON format:
    const parsedAccess = JSON.parse(grant?.access_token_enc || "{}");
    const parsedRefresh = JSON.parse(grant?.refresh_token_enc || "{}");
    expect(parsedAccess.ciphertext).toBeDefined();
    expect(parsedAccess.iv).toBeDefined();
    expect(parsedAccess.tag).toBeDefined();
    expect(parsedRefresh.ciphertext).toBeDefined();
    expect(parsedRefresh.iv).toBeDefined();
    expect(parsedRefresh.tag).toBeDefined();

    // Verify IVs are distinct (each call to encrypt generates its own random IV):
    expect(parsedAccess.iv).not.toBe(parsedRefresh.iv);

    // Retrieve active access token:
    const tok = await getAccessToken(connector);
    expect(tok).toBe("test_access_token_12345");
  });
});
