// Optional one-time Chromium provisioning for the browser sub-agent.
// Run manually: npm run setup:browser — the app works without it (browser tools report unavailable).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || "./data";
const marker = path.join(dataDir, ".chromium-ok");

if (existsSync(marker)) {
  console.log("chromium already provisioned");
  process.exit(0);
}

try {
  console.log("downloading chromium for playwright-core (one-time, ~130MB)…");
  execSync("npx playwright-core install chromium", { stdio: "inherit" });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(marker, "downloaded");
  console.log("chromium ready");
} catch (e) {
  console.warn("chromium download failed; browser tools will be unavailable until you run: npm run setup:browser");
  process.exit(0);
}
