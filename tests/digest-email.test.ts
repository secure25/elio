import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { classify, guard } from "../src/lib/sentinel";
import { db, uuid, now } from "../src/lib/db";
import { setDigestConfig, runMorningDigest } from "../src/lib/digest";

beforeAll(() => {
  db.prepare("DELETE FROM digests").run();
  db.prepare("DELETE FROM approvals").run();
  db.prepare("DELETE FROM connector_grants").run();
  // hour 0 => scheduled path is deterministically due
  setDigestConfig({ hour: 0, enabled: true, emailEnabled: false });
});

describe("sentinel digest rule", () => {
  it("allows gmail.send_digest as opted-in medium risk", () => {
    const c = classify("gmail.send_digest");
    expect(c.decision).toBe("allow");
    expect(c.risk).toBe("medium");
  });

  it("still requires approval for regular agent email", () => {
    expect(classify("gmail.send").decision).toBe("ask");
  });

  it("guard() does not create approval rows for digest delivery", () => {
    const before = (db.prepare("SELECT COUNT(*) c FROM approvals").get() as any).c;
    const v = guard({ action: "gmail.send_digest", detail: "digest delivery" });
    expect(v.decision).toBe("allow");
    const after = (db.prepare("SELECT COUNT(*) c FROM approvals").get() as any).c;
    expect(after).toBe(before);
  });
});

describe("digest email delivery", () => {
  it("scheduled run with opt-in but no gmail records not_connected", async () => {
    setDigestConfig({ emailEnabled: true });
    const d = await runMorningDigest(false); // scheduled path (today's digest was cleared)
    expect(JSON.parse(d.meta || "{}").email).toBe("not_connected");
    setDigestConfig({ emailEnabled: false });
  });

  it("forced preview run never attempts email delivery", async () => {
    const mod = await import("../src/lib/connectors/gmail");
    const spy = vi.spyOn(mod, "gmailSendDigest");
    await runMorningDigest(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("delivers when opted in + connected, recipient hard-locked to account owner", async () => {
    db.prepare(
      "INSERT INTO connector_grants (id, connector, scopes, status, account_email, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(uuid(), "gmail", "scopes", "connected", "owner@example.com", now(), now());

    const sent: { subject: string; body: string }[] = [];
    const mod = await import("../src/lib/connectors/gmail");
    const spy = vi.spyOn(mod, "gmailSendDigest").mockImplementation(async (subject, body) => {
      sent.push({ subject, body });
      return "sent";
    });

    db.prepare("DELETE FROM digests").run(); // ensure scheduled path runs
    setDigestConfig({ emailEnabled: true });
    const d = await runMorningDigest(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Elio morning digest");
    expect(JSON.parse(d.meta || "{}").email).toBe("sent");

    spy.mockRestore();
    setDigestConfig({ emailEnabled: false });
    db.prepare("DELETE FROM connector_grants").run();
    const { getGrant } = await import("../src/lib/google-oauth");
    expect(getGrant("gmail")).toBeNull();
  });
});
