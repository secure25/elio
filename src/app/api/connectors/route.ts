import { NextRequest, NextResponse } from "next/server";
import { listGrants, disconnectGrant } from "@/lib/google-oauth";
import { telegramConfigured, whatsappConfigured, telegramRecipientHint, whatsappRecipientHint } from "@/lib/connectors/messaging";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    grants: listGrants(),
    messaging: {
      telegram: {
        configured: telegramConfigured(),
        recipient: telegramRecipientHint(),
      },
      whatsapp: {
        configured: whatsappConfigured(),
        recipient: whatsappRecipientHint(),
      },
    },
  });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const connector = searchParams.get("connector");
  if (!connector) return NextResponse.json({ error: "connector required" }, { status: 400 });
  disconnectGrant(connector);
  return NextResponse.json({ ok: true });
}
