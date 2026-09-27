// One-time installer for the voice stack: Piper TTS (free, local, offline).
// - Windows: installs the piper-tts Python wheel into a project-local venv
//   (kept out of git) + the male en_US `ryan` medium voice model (~63 MB).
//   Override with VOICE_MODEL=en_US-joe-medium npm run setup:voice
// - Also works on Linux/macOS (same wheel plus platform variants).
// Everything lands in ./data so the app stays self-contained; re-running is safe.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || "./data";
const voiceDir = path.join(dataDir, "voice");
const piperDir = path.join(dataDir, "piper");
const venvDir = path.join(dataDir, "piper-venv");

// Male voice by preference (ryan = warm American male). Name parts: lang/region/speaker/quality.
const [MODEL_ID, VOICE_PATH] = (() => {
  const requested = process.env.VOICE_MODEL || "en_US-ryan-medium";
  const m = requested.match(/^(en(?:_[A-Z]{2})?)-([a-z_]+)-(low|medium|high)$/);
  if (!m) throw new Error(`Unrecognized VOICE_MODEL "${requested}" (expected e.g. en_US-ryan-medium)`);
  const region = m[1].includes("_") ? m[1].slice(3) : "US";
  return [requested, `en/${m[1]}/${m[2]}/${m[3]}`];
})();
const MODEL_URL = `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/${VOICE_PATH}/${MODEL_ID}.onnx`;
const CONF_URL = `${MODEL_URL}.json`;

const wheel =
  process.platform === "win32"
    ? "https://github.com/OHF-Voice/piper1-gpl/releases/download/v1.8.0/piper_tts-1.8.0-cp39-abi3-win_amd64.whl"
    : process.platform === "darwin"
      ? "https://github.com/OHF-Voice/piper1-gpl/releases/download/v1.8.0/piper_tts-1.8.0-cp39-abi3-macosx_11_0_arm64.whl"
      : "https://github.com/OHF-Voice/piper1-gpl/releases/download/v1.8.0/piper_tts-1.8.0-cp39-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.manylinux_2_28_x86_64.whl";

function log(s) {
  console.log(`[voice] ${s}`);
}

function pythonBin() {
  for (const c of ["python", "python3"]) {
    try {
      execSync(`${c} --version`, { stdio: "pipe" });
      return c;
    } catch {}
  }
  return null;
}

async function download(url, dest) {
  const follow = (u) =>
    new Promise((resolve, reject) => {
      https
        .get(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(new URL(res.headers.location, u).href).then(resolve, reject);
          } else if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          } else {
            pipeline(Readable.from(res), createWriteStream(dest)).then(resolve, reject);
          }
        })
        .on("error", reject);
    });
  await follow(url);
}

async function main() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  // 1) Voice model
  const modelPath = path.join(voiceDir, `${MODEL_ID}.onnx`);
  if (existsSync(modelPath) && existsSync(modelPath + ".json")) {
    log(`voice model already present: ${MODEL_ID}`);
  } else {
    mkdirSync(voiceDir, { recursive: true });
    log(`downloading voice model (${MODEL_ID}, ~63 MB)…`);
    await download(MODEL_URL, modelPath);
    await download(CONF_URL, modelPath + ".json");
    log("voice model ready");
  }

  // 2) Piper engine (skip if a PIPER_BIN already works)
  if (process.env.PIPER_BIN && existsSync(process.env.PIPER_BIN)) {
    log(`using existing Piper at PIPER_BIN=${process.env.PIPER_BIN}`);
  } else {
    const py = pythonBin();
    if (!py) {
      log("WARNING: Python not found. The app will fall back to the Windows built-in voice.");
      log("Install Python 3 and re-run `npm run setup:voice` for the nicer neural voice.");
      return;
    }
    if (!existsSync(path.join(venvDir, "pyvenv.cfg"))) {
      log("creating Python venv for piper…");
      execSync(`${py} -m venv "${venvDir}"`, { stdio: "inherit" });
    }
    const vpy = process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
    log("installing piper-tts wheel (one-time, ~30 MB)…");
    execSync(`"${vpy}" -m pip install --no-input "${wheel}"`, { stdio: "inherit" });
    log("piper installed");
  }

  // 3) Smoke test
  try {
    const testWav = path.join(dataDir, "voice-selftest.wav");
    if (process.platform === "win32") {
      const vpy = path.join(venvDir, "Scripts", "python.exe");
      if (existsSync(vpy)) {
        execSync(
          `"${vpy}" -m piper -m "${modelPath}" -c "${modelPath}.json" -f "${testWav}"`,
          { input: "Voice ready.", stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 }
        );
      }
    } else {
      const vpy = path.join(venvDir, "bin", "python");
      execSync(
        `"${vpy}" -m piper -m "${modelPath}" -c "${modelPath}.json" -f "${testWav}"`,
        { input: "Voice ready.", stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 }
      );
    }
    log("self-test synthesis OK");
  } catch (e) {
    log(`self-test failed (${e.message?.slice(0, 200)}) — the app will report details at /api/voice/status`);
    process.exitCode = 1;
  }

  log("done. Restart the dev server and toggle 🔊 Voice in the chat.");
}

main().catch((e) => {
  log(`setup failed: ${e.message}`);
  log("Voice stays optional: Muse falls back to the Windows built-in voice, or runs silent.");
  process.exitCode = 1;
});
