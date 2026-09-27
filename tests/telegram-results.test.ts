import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.ELIO_DATA_DIR = process.env.ELIO_DATA_DIR || "./data-test";
process.env.TELEGRAM_BOT_TOKEN = "test-token-for-vitest";

import { classify, guard } from "../src/lib/sentinel";
import { db } from "../src/lib/db";
import { putSecret, deleteSecret } from "../src/lib/vault";
import { notifyTaskResult } from "../src/lib/agent/runner";

function mockFetch(capture?: (url: string, body: any) => void) {
  return vi.fn(async (url: string | URL | Request, init?: any) => {
    if (capture && init?.body) capture(String(url), JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true }) } as any;
  });
}

const setToggle = (v: string) =>
  db
    .prepare(
      "INSERT INTO settings (key, value) VALUES ('telegram_results_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(v);
const clearToggle = () => db.prepare("DELETE FROM settings WHERE key = 'telegram_results_enabled'").run();

beforeAll(() => {
  clearToggle();
  db.prepare("DELETE FROM approvals").run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telegram result delivery", () => {
  it("classifies message.send_result as allow / low risk (owner-locked)", () => {
    const v = classify("message.send_result");
    expect(v.decision).toBe("allow");
    expect(v.risk).toBe("low");
  });

  it("guard() never creates an approval row for result delivery", () => {
    const before = (db.prepare("SELECT COUNT(*) c FROM approvals").get() as any).c;
    const verdict = guard({ action: "message.send_result", detail: "Deliver task result" });
    expect(verdict.decision).toBe("allow");
    const after = (db.prepare("SELECT COUNT(*) c FROM approvals").get() as any).c;
    expect(after.c).toBe(before.c);
  });

  it("sends via Telegram when enabled and connected (default ON)", async () => {
    putSecret("telegram_chat_id", "messaging", "424242");
    clearToggle(); // absent setting = enabled
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    await notifyTaskResult("The current Node.js LTS is 24.x.");
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.chat_id).toBe("424242");
    expect(body.text).toContain("Node.js LTS");
  });

  it("does not send when the toggle is off", async () => {
    setToggle("false");
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    await notifyTaskResult("should not arrive");
    expect(f).not.toHaveBeenCalled();
    clearToggle();
  });

  it("does not send when Telegram is unconfigured", async () => {
    deleteSecret("telegram_chat_id");
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    await notifyTaskResult("no chat id");
    expect(f).not.toHaveBeenCalled();
  });

  it("truncates very long results", async () => {
    putSecret("telegram_chat_id", "messaging", "424242");
    let capturedText = "";
    const f = mockFetch((_u, body) => {
      capturedText = body.text;
    });
    vi.stubGlobal("fetch", f);
    await notifyTaskResult("x".repeat(6000));
    expect(capturedText.length).toBeLessThanOrEqual(3200);
    expect(capturedText.endsWith("…")).toBe(true);
    deleteSecret("telegram_chat_id");
  });

  it("restores clean state", () => {
    clearToggle();
    deleteSecret("telegram_chat_id");
    expect(true).toBe(true);
  });
});
