import { NextRequest, NextResponse } from "next/server";
import {
  telegramResolveChat,
  sendTestMessage,
  telegramConfigured,
  whatsappConfigured,
  setTelegramWebhook,
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
} from "@/lib/connectors/messaging";
import { putSecret } from "@/lib/vault";
import { db, now, uuid, audit } from "@/lib/db";

export const runtime = "nodejs";

function upsertGrant(connector: string, accountEmail: string) {
  // Mirror the connector_grants row Google OAuth writes, with empty scopes/tokens.
  const existing = db.prepare("SELECT id FROM connector_grants WHERE connector = ?").get(connector) as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare(
      "UPDATE connector_grants SET status = 'connected', account_email = ?, updated_at = ? WHERE connector = ?"
    ).run(accountEmail, now(), connector);
  } else {
    db.prepare(
      "INSERT INTO connector_grants (id, connector, scopes, status, account_email, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(uuid(), connector, "", "connected", accountEmail, now(), now());
  }
  audit("connectors", `${connector}.connected`, { detail: "messaging channel connected", risk: "medium" });
}

export async function POST(req: NextRequest) {
  const { action, channel, token, webhookUrl } = (await req.json()) as {
    action: string;
    channel?: "telegram" | "whatsapp";
    token?: string;
    webhookUrl?: string;
  };

  if (action === "resolve_telegram_chat") {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set in .env" }, { status: 400 });
    }
    const result = await telegramResolveChat();
    if (result.ok) upsertGrant("telegram", "telegram: connected");
    return NextResponse.json(result);
  }

  if (action === "save_whatsapp") {
    if (!token || !/^\+?[0-9]{6,15}$/.test(token.replace(/[\s-]/g, ""))) {
      return NextResponse.json({ ok: false, message: "Enter a valid phone number including country code, e.g. +15551234567" }, { status: 400 });
    }
    putSecret("whatsapp_to", "messaging", token.replace(/[\s-]/g, ""));
    upsertGrant("whatsapp", "whatsapp: connected");
    return NextResponse.json({ ok: true, message: "WhatsApp number saved." });
  }

  if (action === "test") {
    if (channel !== "telegram" && channel !== "whatsapp") {
      return NextResponse.json({ ok: false, message: "channel must be telegram or whatsapp" }, { status: 400 });
    }
    const configured = channel === "telegram" ? telegramConfigured() : whatsappConfigured();
    if (!configured) {
      return NextResponse.json({ ok: false, message: `${channel} is not fully connected yet` }, { status: 400 });
    }
    const result = await sendTestMessage(channel);
    const ok = /Test sent/i.test(result);
    return NextResponse.json({ ok, message: result });
  }

  if (action === "disconnect") {
    if (channel !== "telegram" && channel !== "whatsapp") {
      return NextResponse.json({ ok: false, message: "channel must be telegram or whatsapp" }, { status: 400 });
    }
    const { deleteSecret } = await import("@/lib/vault");
    deleteSecret(channel === "telegram" ? "telegram_chat_id" : "whatsapp_to");
    db.prepare("DELETE FROM connector_grants WHERE connector = ?").run(channel);
    audit("connectors", `${channel}.disconnected`, { risk: "medium" });
    return NextResponse.json({ ok: true, message: `${channel} disconnected` });
  }

  if (action === "set_telegram_webhook") {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set in .env" }, { status: 400 });
    }
    let targetBase = webhookUrl || process.env.NEXT_PUBLIC_APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
    if (!targetBase) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") || "https";
      if (host) targetBase = `${proto}://${host}`;
    }
    if (!targetBase) {
      return NextResponse.json({
        ok: false,
        message: "Could not determine public app URL. Set NEXT_PUBLIC_APP_URL in Railway variables or pass webhookUrl.",
      }, { status: 400 });
    }
    const cleanBase = targetBase.replace(/\/$/, "");
    const fullWebhookUrl = `${cleanBase}/api/telegram/webhook`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const result = await setTelegramWebhook(fullWebhookUrl, secret);
    if (result.ok) {
      audit("connectors", "telegram.webhook_registered", { detail: fullWebhookUrl });
    }
    return NextResponse.json({ ...result, url: fullWebhookUrl });
  }

  if (action === "get_telegram_webhook") {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set in .env" }, { status: 400 });
    }
    const info = await getTelegramWebhookInfo();
    return NextResponse.json(info);
  }

  if (action === "delete_telegram_webhook") {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set in .env" }, { status: 400 });
    }
    const result = await deleteTelegramWebhook();
    return NextResponse.json(result);
  }

  return NextResponse.json({ ok: false, message: "unknown action" }, { status: 400 });
}
