import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import { googleOAuthConfigured } from "@/lib/google-oauth";
import { listSecretLabels, putSecret, surrogateFor } from "@/lib/vault";
import { setVoiceProvider, ttsProvider, voiceStatus, VoiceProvider } from "@/lib/voice";

export const runtime = "nodejs";

function publicConfig() {
  return {
    provider: process.env.LLM_PROVIDER || (process.env.CLEANAPIS_API_KEY ? "cleanapis" : process.env.GEMINI_API_KEY ? "gemini" : process.env.GROQ_API_KEY ? "groq" : process.env.OPENROUTER_API_KEY ? "openrouter" : process.env.QWEN_API_TOKEN ? "qwen" : null),
    model:
      process.env.CLEANAPIS_MODEL || process.env.GEMINI_MODEL || process.env.GROQ_MODEL || process.env.OPENROUTER_MODEL || process.env.QWEN_MODEL || null,
    llmConfigured: Boolean(
      process.env.CLEANAPIS_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.QWEN_API_TOKEN
    ),
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    telegramResultsEnabled: getSetting("telegram_results_enabled") !== "false",
    telegramApprovalsEnabled: getSetting("approval_telegram_enabled") !== "false",
    voiceProvider: ttsProvider(),
    voice: voiceStatus().tts,
    googleOAuthConfigured: googleOAuthConfigured(),
    vaultConfigured: Boolean(process.env.VAULT_SECRET),
    secrets: listSecretLabels(),
  };
}

export async function GET() {
  return NextResponse.json(publicConfig());
}

export async function POST(req: Request) {
  const { key, value } = (await req.json()) as { key: string; value: string };
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  // Live voice-engine switch (Settings → Speech Engine); takes effect immediately.
  if (key === "voice.provider") {
    if (value !== "auto" && value !== "local" && value !== "") {
      return NextResponse.json({ error: "voice.provider must be 'auto' or 'local'" }, { status: 400 });
    }
    setVoiceProvider(value as VoiceProvider | "");
    return NextResponse.json({ ok: true, voiceProvider: ttsProvider(), voice: voiceStatus().tts });
  }

  setSetting(key, value);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  // Store a secret into the vault (surrogate token returned; real value never echoed)
  const { label, kind, value } = (await req.json()) as { label: string; kind: string; value: string };
  if (!label || !value) return NextResponse.json({ error: "label and value required" }, { status: 400 });
  putSecret(label, kind || "credential", value);
  return NextResponse.json({ ok: true, surrogate: surrogateFor(label) });
}
