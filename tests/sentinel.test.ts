import { describe, it, expect, beforeAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { classify, guard, resolveApproval, listApprovals } from "../src/lib/sentinel";
import { db } from "../src/lib/db";
// note: db.ts uses node:sqlite (built-in) — no native build required

beforeAll(() => {
  db.prepare("DELETE FROM approvals").run();
});

describe("Sentinel classify", () => {
  it("allows read-only actions", () => {
    expect(classify("gmail.list").decision).toBe("allow");
    expect(classify("calendar.list").decision).toBe("allow");
    expect(classify("browser.goto").decision).toBe("allow");
    expect(classify("web.search").decision).toBe("allow");
  });

  it("requires approval for sending email", () => {
    const c = classify("gmail.send");
    expect(c.decision).toBe("ask");
    expect(c.risk).toBe("high");
  });

  it("requires approval for payments", () => {
    const c = classify("payment.charge");
    expect(c.decision).toBe("ask");
    expect(c.risk).toBe("high");
  });

  it("requires approval for form submission", () => {
    expect(classify("browser.submit").decision).toBe("ask");
  });

  it("denies permanent mail deletion", () => {
    expect(classify("gmail.delete").decision).toBe("deny");
  });

  it("fails closed on unknown actions", () => {
    const c = classify("brand.new.action");
    expect(c.decision).toBe("ask");
  });
});

describe("Sentinel guard", () => {
  it("allows without creating approval rows for low-risk", () => {
    const before = (db.prepare("SELECT COUNT(*) c FROM approvals").get() as any).c;
    const v = guard({ action: "browser.goto", detail: "test nav" });
    expect(v.decision).toBe("allow");
    const after = (db.prepare("SELECT COUNT(*) c FROM approvals").get() as any).c;
    expect(after).toBe(before);
  });

  it("creates a pending approval and resolves it", () => {
    const v = guard({ action: "gmail.send", detail: 'Send email to x@y.z — subject "hi"' });
    expect(v.decision).toBe("ask");
    expect(v.approvalId).toBeTruthy();
    const pending = listApprovals("pending") as any[];
    expect(pending.some((a) => a.id === v.approvalId)).toBe(true);

    const resolved = resolveApproval(v.approvalId!, false);
    expect(resolved?.status).toBe("denied");
    const gone = (listApprovals("pending") as any[]).some((a) => a.id === v.approvalId);
    expect(gone).toBe(false);
  });
});
