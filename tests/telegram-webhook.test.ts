import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";
process.env.TELEGRAM_BOT_TOKEN = "mock-bot-token";

import { db } from "../src/lib/db";
import { putSecret } from "../src/lib/vault";
import { GET, POST } from "../src/app/api/telegram/webhook/route";

describe("Telegram Webhook API", () => {
  beforeAll(() => {
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM conversations").run();
    db.prepare("DELETE FROM tasks").run();
  });

  it("handles GET healthcheck", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe("Elio Telegram Webhook");
  });

  it("rejects unauthorized secret token when TELEGRAM_WEBHOOK_SECRET is set", async () => {
    const prevSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      process.env.TELEGRAM_WEBHOOK_SECRET = "supersecret";
      const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "wrongsecret",
        },
        body: JSON.stringify({ update_id: 1, message: { text: "hello" } }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.TELEGRAM_WEBHOOK_SECRET;
      } else {
        process.env.TELEGRAM_WEBHOOK_SECRET = prevSecret;
      }
    }
  });

  it("rejects message from unauthorized chat when owner chat is configured", async () => {
    putSecret("telegram_chat_id", "messaging", "99999");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 100,
        message: {
          message_id: 1,
          chat: { id: 11111 },
          from: { id: 11111, first_name: "Intruder" },
          text: "Hack Elio",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const callBody = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(callBody.text).toContain("private");
    expect(callBody.chat_id).toBe(11111);
    vi.unstubAllGlobals();
  });

  it("responds to /start command for the owner", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 101,
        message: {
          message_id: 2,
          chat: { id: 12345 },
          from: { id: 12345, first_name: "Owner" },
          text: "/start",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const callBody = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(callBody.text).toContain("Elio");
    vi.unstubAllGlobals();
  });

  it("responds to /status command with system summary", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 102,
        message: {
          message_id: 3,
          chat: { id: 12345 },
          from: { id: 12345, first_name: "Owner" },
          text: "/status",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const callBody = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(callBody.text).toContain("Elio Status Overview");
    vi.unstubAllGlobals();
  });

  it("responds to /new command by creating a fresh conversation", async () => {
    putSecret("telegram_chat_id", "messaging", "12345");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 103,
        message: {
          message_id: 4,
          chat: { id: 12345 },
          from: { id: 12345, first_name: "Owner" },
          text: "/new",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const callBody = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(callBody.text).toContain("fresh conversation");
    vi.unstubAllGlobals();
  });
});
