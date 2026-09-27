import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import {
  synthAudio,
  detectEngine,
  voiceStatus,
  getElevenLabsApiKey,
  getElevenLabsVoiceId,
  getElevenLabsModelId,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_ELEVENLABS_MODEL_ID,
} from "../src/lib/voice";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join("./data-test", "voice-cache");
const isWin = process.platform === "win32";
const t = isWin ? it : it.skip; // local-fallback tests need a guaranteed local engine (SAPI)

// Keep every test self-restoring: env vars set here are removed afterwards,
// and fetch stubs are undone (the project's other tests use real state only).
const SAVED_ENV = { ...process.env };
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED_ENV)) delete process.env[k];
  }
  Object.assign(process.env, SAVED_ENV);
});

function keyForEnv(apiKey?: string, voiceId?: string, modelId?: string) {
  if (apiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = apiKey;
  if (voiceId === undefined) delete process.env.ELEVENLABS_VOICE_ID;
  else process.env.ELEVENLABS_VOICE_ID = voiceId;
  if (modelId === undefined) delete process.env.ELEVENLABS_MODEL_ID;
  else process.env.ELEVENLABS_MODEL_ID = modelId;
}

describe("ElevenLabs configuration", () => {
  it("is unconfigured by default and exposes documented defaults", () => {
    keyForEnv(undefined, undefined, undefined);
    expect(getElevenLabsApiKey()).toBeNull();
    expect(getElevenLabsVoiceId()).toBe(DEFAULT_ELEVENLABS_VOICE_ID);
    expect(getElevenLabsModelId()).toBe(DEFAULT_ELEVENLABS_MODEL_ID);
  });

  it("reads overrides from env", () => {
    keyForEnv("sk-test", "VOICE_X", "eleven_turbo_v2_5");
    expect(getElevenLabsApiKey()).toBe("sk-test");
    expect(getElevenLabsVoiceId()).toBe("VOICE_X");
    expect(getElevenLabsModelId()).toBe("eleven_turbo_v2_5");
  });
});

describe("ElevenLabs engine detection", () => {
  it("prefers ElevenLabs when a key is set", () => {
    keyForEnv("sk-test");
    const det = detectEngine(true);
    expect(det.engine).toBe("elevenlabs");
    expect(det.reason).toContain("ElevenLabs");
    expect(voiceStatus().tts.isElevenLabs).toBe(true);
  });

  it("excludes ElevenLabs when asked, degrading to the best local engine", () => {
    keyForEnv("sk-test");
    const det = detectEngine(true, "elevenlabs");
    expect(det.engine).not.toBe("elevenlabs");
    // Windows has SAPI as the guaranteed local floor.
    if (isWin) expect(det.engine).toBe("sapi");
  });

  it("stays on the local engine without a key, and detection results carry a timestamp for the TTL", () => {
    keyForEnv(undefined);
    const det = detectEngine(true);
    expect(det.engine).not.toBe("elevenlabs");
    expect(typeof det.at).toBe("number");
    expect(Date.now() - det.at).toBeLessThan(5_000);
  });

  it("TTS_PROVIDER=local forces offline synthesis even with an ElevenLabs key present", () => {
    keyForEnv("sk-test");
    process.env.TTS_PROVIDER = "local";
    const det = detectEngine(true);
    expect(det.engine).not.toBe("elevenlabs");
    expect(det.reason).toContain("Offline");
    const status = voiceStatus().tts;
    expect(status.offline).toBe(true);
    expect(status.isElevenLabs).toBe(false);
  });

  it("reports the offline flag when running on a local engine in auto mode", () => {
    keyForEnv(undefined);
    const status = voiceStatus().tts;
    expect(status.offline).toBe(true);
  });
});

describe("ElevenLabs synthesis", () => {
  // Unique text per test: the disk cache is keyed by voice+model+text, so a
  // shared phrase would let one test's cached file satisfy another's (and a
  // previous run's). Each test also starts from an empty cache directory.
  let runId = "";
  const TEXT = () => `Eleven labs engine verification phrase ${runId}.`;

  beforeEach(() => {
    rmSync(CACHE_DIR, { recursive: true, force: true });
    runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  });

  it("synthesizes via the REST API, writes an mp3, and serves repeats from disk cache", async () => {
    keyForEnv("sk-test");
    detectEngine(true); // refresh detection cache for this test's env

    const mp3Bytes = Buffer.alloc(2048, 7);
    const fetchMock = vi.fn(async () => new Response(mp3Bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await synthAudio(TEXT());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    expect(first!.mimeType).toBe("audio/mpeg");
    expect(existsSync(first!.filePath)).toBe(true);
    expect(first!.filePath.endsWith(".mp3")).toBe(true);

    // REST call shape matches the official docs
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.elevenlabs.io/v1/text-to-speech/");
    expect(url).toContain("output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe(TEXT());
    expect(body.model_id).toBe(DEFAULT_ELEVENLABS_MODEL_ID);

    // Second call: served from disk cache, zero network
    const second = await synthAudio(TEXT());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second!.filePath).toBe(first!.filePath);
  });

  t("falls back to a local engine when the API rejects the key", async () => {
    keyForEnv("sk-dead");
    detectEngine(true);

    const fetchMock = vi.fn(async () => new Response("detail: invalid_api_key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await synthAudio(TEXT());
    expect(fetchMock).toHaveBeenCalledTimes(1); // tried the cloud first
    expect(out).not.toBeNull();
    expect(out!.mimeType).toBe("audio/wav");
    expect(out!.filePath.endsWith(".wav")).toBe(true);
  });

  t("treats a suspiciously small success response as failure and falls back", async () => {
    keyForEnv("sk-test");
    detectEngine(true);

    const fetchMock = vi.fn(async () => new Response(Buffer.alloc(10, 1), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await synthAudio(TEXT());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out!.mimeType).toBe("audio/wav");
  });

  t("never calls the network when no key is configured", async () => {
    keyForEnv(undefined);
    detectEngine(true);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await synthAudio(TEXT());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).not.toBeNull();
    expect(out!.mimeType).toBe("audio/wav");
  });

  it("returns null for text that cleans to nothing", async () => {
    keyForEnv("sk-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await synthAudio("```js\nnothing but code\n```")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the ElevenLabs failure reason via voiceStatus() so a local fallback is never mysterious", async () => {
    keyForEnv("sk-test");
    detectEngine(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            detail: {
              type: "payment_required",
              code: "paid_plan_required",
              message: "Free users cannot use library voices via the API.",
            },
          }),
          { status: 402 }
        )
      )
    );

    await synthAudio(TEXT());
    const status = voiceStatus().tts;
    expect(status.note).toContain("Free users cannot use library voices via the API.");
    expect(status.note).toContain("ELEVENLABS_VOICE_ID");
  });
});
