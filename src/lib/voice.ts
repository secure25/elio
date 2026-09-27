// ── Voice Engine for Elio: ElevenLabs Speech Engine + Local Fallbacks ──
// TTS server-side engine priority chain:
//   1. ElevenLabs Speech Engine (high-fidelity neural voice via official REST API, if ELEVENLABS_API_KEY is configured)
//   2. Piper CLI binary (fast neural TTS, MIT-era binaries; PIPER_BIN or setup script path)
//   3. `python -m piper` (OHF-Voice/piper1-gpl wheel, GPL-3.0)
//   4. Windows SAPI via PowerShell (built into OS — always available as local fallback)
// STT is handled in the browser with the Web Speech API, so the server never touches audio input.
// Synthesis is cached on disk (engine+voice+text keyed) — repeated phrases play instantly.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./db";

const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || "./data";
const CACHE_DIR = path.join(dataDir, "voice-cache");
const LOCAL_PIPER_DIR = path.join(dataDir, "piper");
const LOCAL_VOICE_DIR = path.join(dataDir, "voice");
const LOCAL_PIPER_VENV = path.join(dataDir, "piper-venv");

export const PIPER_VOICE_ID = "en_US-ryan-medium"; // male neural voice (offline default)
// Default premade voice — verified working on the FREE ElevenLabs plan (HTTP 200 test).
// (The classic default "Rachel" is a Voice Library voice, which free accounts
// cannot use via the API: HTTP 402 paid_plan_required.) Male by user preference:
// Roger — deep, resonant. Other male premades in the account: Brian, Daniel,
// Chris, Eric, Liam, Charlie, George, Will.
export const DEFAULT_ELEVENLABS_VOICE_ID = "CwhRBWXzGAHq8TQ4Fs17"; // Roger (male, verified free-tier-safe)
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

export function getElevenLabsApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

export function getElevenLabsVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
}

export function getElevenLabsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;
}

function piperModelPaths(): { model: string; conf: string } | null {
  const model =
    process.env.PIPER_VOICE || path.join(LOCAL_VOICE_DIR, `${PIPER_VOICE_ID}.onnx`);
  const conf = `${model}.json`;
  return existsSync(model) && existsSync(conf) ? { model, conf } : null;
}

function piperCliCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.PIPER_BIN) candidates.push(process.env.PIPER_BIN);
  if (process.platform === "win32") {
    candidates.push(path.join(LOCAL_PIPER_DIR, "piper.exe"));
    candidates.push(path.join(LOCAL_PIPER_DIR, "piper"));
  }
  candidates.push("piper");
  return candidates;
}

function pythonCandidates(): string[] {
  if (process.env.PIPER_PYTHON) return [process.env.PIPER_PYTHON];
  // The project-local venv created by `npm run setup:voice` comes first —
  // system Python usually does not have piper installed.
  const venvPy =
    process.platform === "win32"
      ? path.join(LOCAL_PIPER_VENV, "Scripts", "python.exe")
      : path.join(LOCAL_PIPER_VENV, "bin", "python");
  return process.platform === "win32"
    ? [venvPy, "python", "python3"]
    : [venvPy, "python3", "python"];
}

export type Engine = "elevenlabs" | "piper-cli" | "piper-python" | "sapi";

// Voice provider — where spoken text is synthesized:
//   "auto"  prefers the ElevenLabs cloud engine when a key is set (falls back local)
//   "local" forces fully-offline synthesis; the cloud key stays dormant
// Stored in the DB ("voice.provider") so /settings can switch it live; when no
// DB value is set, falls back to the TTS_PROVIDER env var ("auto" if unset).
export type VoiceProvider = "auto" | "local";

export function ttsProvider(): VoiceProvider {
  try {
    const stored = getSetting("voice.provider");
    if (stored === "auto" || stored === "local") return stored;
  } catch {}
  return (process.env.TTS_PROVIDER || "auto").trim().toLowerCase() === "local"
    ? "local"
    : "auto";
}

/** Switch the voice engine at runtime (Settings → Speech Engine). "" clears the override. */
export function setVoiceProvider(p: VoiceProvider | ""): void {
  setSetting("voice.provider", p);
  detection = null; // re-detect with the new provider immediately
}

// Cached detection self-heals: after a fallback to a local engine we re-probe
// the preferred engine (e.g. ElevenLabs) after this TTL, so a transient
// failure doesn't downgrade voice quality until the next server restart.
const DETECT_TTL_MS = 5 * 60_000;
let detection: {
  engine: Engine | null;
  reason: string;
  at: number;
  provider: VoiceProvider;
} | null = null;

/** Detect voice engine; checks ElevenLabs first, then local fallback engines.
 *  `exclude` lets the fallback chain skip an engine that just failed (e.g. a
 *  dead ElevenLabs key) so we degrade to local engines instead of retrying it. */
export function detectEngine(
  force = false,
  exclude?: Engine
): { engine: Engine | null; reason: string; at: number } {
  const cur = ttsProvider();
  if (
    detection &&
    !force &&
    detection.provider === cur && // provider switched live → re-detect immediately
    detection.engine !== exclude &&
    Date.now() - detection.at < DETECT_TTL_MS
  )
    return detection;

  // 1. Check ElevenLabs Speech Engine (skipped entirely in local/offline mode)
  if (getElevenLabsApiKey() && cur === "auto" && exclude !== "elevenlabs") {
    detection = {
      engine: "elevenlabs",
      reason: `ElevenLabs Speech Engine (voice: ${getElevenLabsVoiceId()}, model: ${getElevenLabsModelId()})`,
      at: Date.now(),
      provider: cur,
    };
    return detection;
  }

  // 2. Check local engines
  const model = piperModelPaths();
  const localPrefix =
    cur === "local" ? "Offline (local) engine" : "Local engine";

  for (const bin of piperCliCandidates()) {
    const r = spawnSync(bin, ["-h"], { timeout: 10_000, encoding: "utf8" });
    if (!r.error && (r.status === 0 || /piper/i.test(r.stdout + r.stderr))) {
      if (!model) break; // CLI present but no model on disk
      detection = {
        engine: "piper-cli",
        reason: `${localPrefix}: Piper CLI (${PIPER_VOICE_ID}) at ${bin}`,
        at: Date.now(),
        provider: cur,
      };
      return detection;
    }
  }

  for (const py of pythonCandidates()) {
    const r = spawnSync(py, ["-m", "piper", "-h"], { timeout: 15_000, encoding: "utf8" });
    if (!r.error && r.status === 0 && !model) break;
    if (!r.error && r.status === 0) {
      detection = {
        engine: "piper-python",
        reason: `${localPrefix}: Piper (${PIPER_VOICE_ID}) via ${py} -m piper`,
        at: Date.now(),
        provider: cur,
      };
      return detection;
    }
  }

  if (process.platform === "win32") {
    detection = {
      engine: "sapi",
      reason:
        (cur === "local" ? "Offline (local) engine" : "Local engine") +
        ": Windows built-in voice (System.Speech)",
      at: Date.now(),
      provider: cur,
    };
    return detection;
  }

  detection = {
    engine: null,
    reason:
      "No TTS engine configured. Set ELEVENLABS_API_KEY in .env, or install Piper (`npm run setup:voice`).",
    at: Date.now(),
    provider: cur,
  };
  return detection;
}

/**
 * Clean text for natural speech synthesis: strip code blocks, raw URLs, Markdown formatting, emoji.
 */
export function cleanVoiceText(raw: string): string {
  let t = raw;
  t = t.replace(/```[\s\S]*?(```|$)/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\[([^\]]{1,80})\]\((https?:\/\/[^)]+)\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " a link ");
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,
    " "
  );
  t = t.replace(/[*_#>|~]+/g, " ");
  t = t.replace(/\s*([;:!,.)\]}])\s*/g, "$1 ");
  t = t.replace(/[ \t]+/g, " ").trim();
  if (t.length > 700) t = t.slice(0, 697).replace(/\s+\S*$/, "") + "…";
  return t;
}

function escapePs(s: string): string {
  return s.replace(/'/g, "''");
}

// Last cloud-synthesis failure, persisted next to the audio cache and surfaced
// via /api/voice/status so a silent local fallback is never mysterious (e.g.
// ElevenLabs 402 paid_plan_required). On disk rather than module state because
// Next's per-route bundles each get their own copy of this module.
const CLOUD_ERROR_FILE = path.join(CACHE_DIR, "cloud-error.json");

function writeCloudErrorNote(message: string) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CLOUD_ERROR_FILE, JSON.stringify({ message, at: Date.now() }));
  } catch {}
}

function clearCloudErrorNote() {
  try {
    unlinkSync(CLOUD_ERROR_FILE);
  } catch {}
}

function readCloudErrorNote(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CLOUD_ERROR_FILE, "utf8")) as {
      message?: string;
      at?: number;
    };
    if (!parsed.message || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at >= DETECT_TTL_MS) return null;
    return parsed.message;
  } catch {
    return null;
  }
}

function describeElevenLabsError(status: number, body: string): string {
  let msg: string | null = null;
  try {
    const detail = JSON.parse(body)?.detail;
    if (detail && typeof detail === "object" && detail.message)
      msg = `${detail.message} (ElevenLabs HTTP ${status})`;
    else if (typeof detail === "string") msg = `${detail} (ElevenLabs HTTP ${status})`;
  } catch {}
  if (!msg) msg = `ElevenLabs API error (HTTP ${status})`;
  if (/library voices|paid_plan_required/i.test(body))
    msg +=
      " — free ElevenLabs accounts can only use voices you create yourself: make one in your Voice Lab, then set ELEVENLABS_VOICE_ID in .env to its voice ID.";
  return msg;
}

/** Synthesize speech using ElevenLabs Text-to-Speech REST API. */
async function synthWithElevenLabs(
  apiKey: string,
  voiceId: string,
  modelId: string,
  text: string,
  outMp3: string
): Promise<boolean> {
  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      writeCloudErrorNote(describeElevenLabsError(res.status, err));
      console.error(`ElevenLabs TTS API error (${res.status}):`, err);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      writeCloudErrorNote(`ElevenLabs returned a suspiciously small audio response (${buffer.length} bytes).`);
      return false;
    }

    clearCloudErrorNote();
    writeFileSync(outMp3, buffer);
    return true;
  } catch (err) {
    writeCloudErrorNote(
      `ElevenLabs request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("ElevenLabs TTS request failed:", err);
    return false;
  }
}

function synthWithPiperCli(
  bin: string,
  text: string,
  outWav: string
): boolean {
  const model = piperModelPaths();
  if (!model) return false;
  const r = spawnSync(
    bin,
    ["-m", model.model, "-c", model.conf, "-f", outWav],
    { input: text, timeout: 90_000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  return !r.error && r.status === 0 && existsSync(outWav) && statSync(outWav).size > 44;
}

function synthWithPiperPython(
  py: string,
  text: string,
  outWav: string
): boolean {
  const model = piperModelPaths();
  if (!model) return false;
  const r = spawnSync(
    py,
    ["-m", "piper", "-m", model.model, "-c", model.conf, "-f", outWav],
    { input: text, timeout: 120_000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  return !r.error && r.status === 0 && existsSync(outWav) && statSync(outWav).size > 44;
}

function synthWithSapi(text: string, outWav: string): boolean {
  const dir = path.dirname(outWav);
  const stem = path.basename(outWav, ".wav");
  const ps1 = path.join(dir, `sapi-${stem}.ps1`);
  writeFileSync(
    ps1,
    [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "$s.Rate = 0",
      `$s.SetOutputToWaveFile('${escapePs(outWav)}')`,
      `$s.Speak('${escapePs(text)}')`,
      "$s.Dispose()",
    ].join("\r\n"),
    "utf8"
  );
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1],
      { timeout: 90_000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
    );
    return !r.error && r.status === 0 && existsSync(outWav) && statSync(outWav).size > 44;
  } finally {
    try {
      unlinkSync(ps1);
    } catch {}
  }
}

export interface AudioSynthesisResult {
  filePath: string;
  mimeType: string;
}

/** Synthesize `text` to an audio file. Returns null when no engine can. */
export async function synthAudio(text: string): Promise<AudioSynthesisResult | null> {
  const cleaned = cleanVoiceText(text);
  if (!cleaned) return null;

  let det = detectEngine();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!det.engine) return null;

    mkdirSync(CACHE_DIR, { recursive: true });

    if (det.engine === "elevenlabs") {
      const apiKey = getElevenLabsApiKey();
      const voiceId = getElevenLabsVoiceId();
      const modelId = getElevenLabsModelId();
      if (apiKey) {
        const key = createHash("sha1")
          .update(`elevenlabs|${voiceId}|${modelId}|${cleaned}`)
          .digest("hex");
        const outMp3 = path.join(CACHE_DIR, `${key}.mp3`);
        if (existsSync(outMp3) && statSync(outMp3).size > 100) {
          return { filePath: outMp3, mimeType: "audio/mpeg" };
        }

        const ok = await synthWithElevenLabs(apiKey, voiceId, modelId, cleaned, outMp3);
        if (ok) return { filePath: outMp3, mimeType: "audio/mpeg" };
      }
      // If ElevenLabs fails or the key is invalid, fall back to local engines.
      // Exclude the cloud engine so re-detection picks the best LOCAL engine
      // (piper → sapi) instead of looping back to the same failing provider.
      det = detectEngine(true, "elevenlabs");
      continue;
    }

    const key = createHash("sha1")
      .update(`${det.engine}|${PIPER_VOICE_ID}|${cleaned}`)
      .digest("hex");
    const outWav = path.join(CACHE_DIR, `${key}.wav`);
    if (existsSync(outWav) && statSync(outWav).size > 44) {
      return { filePath: outWav, mimeType: "audio/wav" };
    }

    let ok = false;
    if (det.engine === "piper-cli" && process.env.PIPER_BIN) {
      ok = synthWithPiperCli(process.env.PIPER_BIN, cleaned, outWav);
    } else if (det.engine === "piper-cli") {
      for (const bin of piperCliCandidates()) {
        if (existsSync(bin) || !path.isAbsolute(bin)) {
          ok = synthWithPiperCli(bin, cleaned, outWav);
          if (ok) break;
        }
      }
    } else if (det.engine === "piper-python") {
      for (const py of pythonCandidates()) {
        ok = synthWithPiperPython(py, cleaned, outWav);
        if (ok) break;
      }
    } else if (det.engine === "sapi") {
      ok = synthWithSapi(cleaned, outWav);
    }

    if (ok) return { filePath: outWav, mimeType: "audio/wav" };

    det = detectEngine(true);
  }
  return null;
}

/** Synchronous backwards-compatibility wrapper for existing callers */
export function synthToFile(text: string): string | null {
  const cleaned = cleanVoiceText(text);
  if (!cleaned) return null;

  let det = detectEngine();
  mkdirSync(CACHE_DIR, { recursive: true });

  const key = createHash("sha1")
    .update(`${det.engine}|${PIPER_VOICE_ID}|${cleaned}`)
    .digest("hex");
  const outWav = path.join(CACHE_DIR, `${key}.wav`);
  if (existsSync(outWav) && statSync(outWav).size > 44) return outWav;

  if (det.engine === "sapi") {
    if (synthWithSapi(cleaned, outWav)) return outWav;
  }
  return null;
}

export function voiceStatus() {
  const det = detectEngine();
  let cached = 0;
  try {
    cached = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".wav") || f.endsWith(".mp3")).length;
  } catch {}

  const isEleven = det.engine === "elevenlabs";
  const tts: {
    available: boolean;
    engine: Engine | null;
    voice: string | null;
    reason: string;
    isElevenLabs: boolean;
    offline: boolean;
    provider: VoiceProvider;
    note?: string;
  } = {
    available: det.engine !== null,
    engine: det.engine,
    voice: isEleven
      ? getElevenLabsVoiceId()
      : det.engine === "sapi"
      ? "windows-built-in"
      : det.engine
      ? PIPER_VOICE_ID
      : null,
    reason: det.reason,
    isElevenLabs: isEleven,
    offline: ttsProvider() === "local" || (!isEleven && det.engine !== null),
    provider: ttsProvider(),
  };
  // If an ElevenLabs key is configured but synthesis recently failed, say why —
  // otherwise a silent downgrade to a local voice looks like a bug.
  if (getElevenLabsApiKey()) {
    const note = readCloudErrorNote();
    if (note) tts.note = note;
  }

  return {
    tts,
    stt: { available: true, engine: "browser-web-speech" },
    cacheEntries: cached,
  };
}
