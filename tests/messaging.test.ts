import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { classify } from "../src/lib/sentinel";
import { db, uuid, now } from "../src/lib/db";
import { putSecret, deleteSecret } from "../src/lib/vault";
import { sendTelegram, sendWhatsApp, telegramResolveChat, saveTelegramChat } from "../src/lib/connectors/messaging";

function approveAll() {
  db.prepare("UPDATE approvals SET status='approved', resolved_at=? WHERE status='pending'").run(now());
}

const withEnv = (vars: Record<string, string | undefined>, fn: () => void | Promise<void>) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(vars)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      vi.unstubAllGlobals();
    });
};

describe("Sentinel rules for messaging", () => {
  it("gates real sends behind approval but allows the owner test ping", () => {
    expect(classify("message.send")).toEqual({ risk: "high", decision: "ask", reason: expect.any(String) });
    expect(classify("message.send_test")).toEqual({ risk: "low", decision: "allow", reason: expect.any(String) });
  });
});

describe("Telegram send", () => {
  it("returns a clear setup message when not connected", async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: undefined }, async () => {
      deleteSecret("telegram_chat_id");
      const out = await sendTelegram(null, null, "hello");
      expect(out).toMatch(/not fully connected/i);
      // No approval should have been requested for a non-functional send.
      const pending = db.prepare("SELECT COUNT(*) as n FROM approvals WHERE action='message.send' AND status='pending'").get() as any;
      expect(pending.n).toBe(0);
    });
  });

  it("requires Sentinel approval and delivers after it is granted (mocked API)", async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: "test-token" }, async () => {
      saveTelegramChat(123456);
      const fetchMock = vi.fn(async (url: any, init?: any) => {
        const body = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } }), {
          status: 200,
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      // The guard runs synchronously inside sendTelegram → approval row exists immediately.
      const sendPromise = sendTelegram(null, null, "Dinner booked for 7pm ✅");
      await new Promise((r) => setTimeout(r, 50));
      approveAll();

      const out = await sendPromise;
      expect(out).toMatch(/Sent via Telegram/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const called = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
      expect(called.text).toContain("Dinner booked");
      expect(String(called.chat_id)).toBe("123456");
    });
  });

  it("does not send when approval is denied", async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: "test-token" }, async () => {
      saveTelegramChat(123456);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const sendPromise = sendTelegram(null, null, "should never send");
      await new Promise((r) => setTimeout(r, 50));
      db.prepare("UPDATE approvals SET status='denied', resolved_at=? WHERE status='pending'").run(now());

      const out = await sendPromise;
      expect(out).toMatch(/NOT sent/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("surfaces Telegram API errors", async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: "test-token" }, async () => {
      saveTelegramChat(123456);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 400 }))
      );
      const p = sendTelegram(null, null, "err case");
      await new Promise((r) => setTimeout(r, 50));
      approveAll();
      const out = await p;
      expect(out).toMatch(/Telegram send failed: chat not found/);
    });
  });
});

describe("WhatsApp send", () => {
  it("returns a clear setup message when not connected", async () => {
    await withEnv({ WHATSAPP_TOKEN: undefined, WHATSAPP_PHONE_ID: undefined }, async () => {
      deleteSecret("whatsapp_to");
      const out = await sendWhatsApp(null, null, "hello");
      expect(out).toMatch(/not fully connected/i);
    });
  });

  it("requires approval and sends after it is granted (mocked Graph API)", async () => {
    await withEnv({ WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_ID: "phone-123" }, async () => {
      putSecret("whatsapp_to", "messaging", "15551234567");
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "15551234567" }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const p = sendWhatsApp(null, null, "Your order is confirmed 🎉");
      await new Promise((r) => setTimeout(r, 50));
      approveAll();
      const out = await p;

      expect(out).toMatch(/Sent via WhatsApp/);
      const [url, init] = fetchMock.mock.calls[0] as any;
      expect(url).toContain("graph.facebook.com/v21.0/phone-123/messages");
      expect(JSON.parse(init.body).text.body).toContain("order is confirmed");
      deleteSecret("whatsapp_to");
    });
  });
});

describe("Telegram chat resolution (setup)", () => {
  it("maps getUpdates to a saved chat id", async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: "test-token" }, async () => {
      deleteSecret("telegram_chat_id");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({ ok: true, result: [{ message: { chat: { id: 777, first_name: "Taylor" } } }] }),
            { status: 200 }
          )
        )
      );
      const res = await telegramResolveChat();
      expect(res.ok).toBe(true);
      expect(res.message).toContain("Taylor");
      const { getSecret } = await import("../src/lib/vault");
      expect(getSecret("telegram_chat_id")).toBe("777");
    });
  });
});
