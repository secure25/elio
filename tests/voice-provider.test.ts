import { describe, it, expect, beforeAll, afterAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import { setVoiceProvider, ttsProvider, detectEngine, voiceStatus } from "../src/lib/voice";
import { db } from "../src/lib/db";

beforeAll(() => {
  db.prepare("DELETE FROM settings WHERE key = 'voice.provider'").run();
  delete process.env.TTS_PROVIDER;
});

afterAll(() => {
  db.prepare("DELETE FROM settings WHERE key = 'voice.provider'").run();
  delete process.env.TTS_PROVIDER;
});

describe("voice provider switch (Settings → Speech Engine)", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(ttsProvider()).toBe("auto");
  });

  it("switches to local and back at runtime, persisting the choice", () => {
    setVoiceProvider("local");
    expect(ttsProvider()).toBe("local");
    expect(db.prepare("SELECT value FROM settings WHERE key='voice.provider'").get()).toMatchObject({
      value: "local",
    });

    setVoiceProvider("auto");
    expect(ttsProvider()).toBe("auto");
  });

  it("clearing the override falls back to the env/default chain", () => {
    setVoiceProvider("local");
    process.env.TTS_PROVIDER = "local";
    setVoiceProvider(""); // clear DB override
    expect(ttsProvider()).toBe("local"); // env still forces local

    delete process.env.TTS_PROVIDER;
    expect(ttsProvider()).toBe("auto"); // default
  });

  it("a live switch re-detects the engine immediately, ignoring the TTL cache", () => {
    process.env.ELEVENLABS_API_KEY = "sk-test-switch";
    setVoiceProvider("auto");
    expect(detectEngine(true).engine).toBe("elevenlabs");

    setVoiceProvider("local"); // must not wait 5 minutes for the TTL
    const det = detectEngine();
    expect(det.engine).not.toBe("elevenlabs");
    expect(det.reason).toContain("Offline");

    setVoiceProvider("auto");
    expect(detectEngine().engine).toBe("elevenlabs"); // instantly back

    delete process.env.ELEVENLABS_API_KEY;
    setVoiceProvider(""); // restore default state for other tests
  });

  it("voiceStatus() reports the provider alongside the engine", () => {
    setVoiceProvider("local");
    expect(voiceStatus().tts.provider).toBe("local");
    setVoiceProvider("auto");
    expect(voiceStatus().tts.provider).toBe("auto");
  });
});
