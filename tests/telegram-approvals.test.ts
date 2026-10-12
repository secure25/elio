// Telegram approval callbacks: owner can Approve/Decline via inline buttons;
// non-owner chats can never resolve an approval. Uses the real webhook POST
// handler with a stubbed fetch (as Bot API stand-in).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";
process.env.TELEGRAM_BOT_TOKEN = "mock-bot-token";

import { db, now, uuid } from "../src/lib/db";
import { putSecret } from "../src/lib/vault";
import { guard } from "../src/lib/sentinel";
import { POST } from "../src/app/api/telegram/webhook/route";

function mkPendingApproval(): string {
  const v = guard({ action: "test.sensitive", detail: "Sensitive test action" });
  expect(v.decision).toBe("ask");
  expect(v.approvalId).toBeTruthy();
  return v.approvalId!;
}

function approvalStatus(id: string): string {
  return (db.prepare("SELECT status FROM approvals WHERE id = ?").get(id) as any).status;
}

describe("Telegram approval inline buttons", () => {
  beforeAll(() => {
    db.prepare("DELETE FROM approvals WHERE action = 'test.sensitive'").run();
    db.prepare("DELETE FROM tasks").run();
  });

  it("approves from the owner chat via callback_query", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const id = mkPendingApproval();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 9001,
        callback_query: {
          id: "cb-approve-1",
          data: `approval:approve:${id}`,
          message: { chat: { id: 12345 } },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(approvalStatus(id)).toBe("approved");

    // The owner gets a confirmation message on the same chat (delivery is
    // async/fire-and-forget, so allow a beat for the void promise to run).
    // Look for the sendMessage body specifically — answerCallbackQuery bodies
    // carry toast text but no chat_id.
    await new Promise((r) => setTimeout(r, 400));
    const bodies = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1].body));
    const confirm = bodies.find((b: any) => "chat_id" in b && b.text && b.text.startsWith("✅ Approved"));
    expect(confirm?.chat_id).toBe(12345);
    vi.unstubAllGlobals();
  });

  it("declines from the owner chat via callback_query", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const id = mkPendingApproval();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 9002,
        callback_query: {
          id: "cb-decline-1",
          data: `approval:decline:${id}`,
          message: { chat: { id: 12345 } },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(approvalStatus(id)).toBe("denied");
    vi.unstubAllGlobals();
  });

  it("refuses a callback from a non-owner chat (approval stays pending)", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const id = mkPendingApproval();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 9003,
        callback_query: {
          id: "cb-intruder-1",
          data: `approval:approve:${id}`,
          message: { chat: { id: 99999 } },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(approvalStatus(id)).toBe("pending");

    // Intruder gets answered (alert) but nothing was approved
    const bodies = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1].body));
    expect(bodies.some((b: any) => b.callback_query_id === "cb-intruder-1" && b.text === "Not authorized")).toBe(true);
    const confirmations = bodies.filter((b: any) => b.text && b.text.startsWith("✅ Approved"));
    expect(confirmations.length).toBe(0);
    vi.unstubAllGlobals();
  });

  it("answers 'Already approved' when tapping a resolved button twice", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const id = mkPendingApproval();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const press = async (cbId: string) => {
      const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update_id: Math.floor(Math.random() * 1e9),
          callback_query: {
            id: cbId,
            data: `approval:approve:${id}`,
            message: { chat: { id: 12345 } },
          },
        }),
      });
      await POST(req);
    };
    await press("cb-tap-1");
    expect(approvalStatus(id)).toBe("approved");
    await press("cb-tap-2");
    const bodies = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1].body));
    expect(bodies.some((b: any) => b.callback_query_id === "cb-tap-2" && b.text === "Already approved")).toBe(true);
    vi.unstubAllGlobals();
  });
});
