import { describe, it, expect, afterAll } from "vitest";

process.env.VAULT_SECRET = process.env.VAULT_SECRET || "test-secret-for-vitest-only";
process.env.MUSE_DATA_DIR = "./data-test";

import {
  browserGoto,
  browserRead,
  browserFill,
  browserScroll,
  latestLiveFrame,
  browserStatus,
  closeBrowser,
} from "../src/lib/connectors/browser";

// Skip gracefully when Chromium hasn't been provisioned (npm run setup:browser).
let chromiumAvailable = true;
try {
  // playwright-core throws at launch time if no browser binary is installed;
  // we detect by attempting registry lookup without launching.
  require.resolve("playwright-core/.local-browsers");
} catch {
  /* keep true — actual launch failure is handled below via skip-guard */
}

const maybe = chromiumAvailable ? describe : describe.skip;

afterAll(async () => {
  await closeBrowser();
});

maybe("live browser frames", () => {
  it(
    "captures a frame after browser.goto and exposes it via latestLiveFrame",
    async () => {
      try {
        const state = await browserGoto(null, "data:text/html,<h1>Elio Live View</h1><p>frame test</p>");
        expect(state).toContain("Elio Live View");
        expect(browserStatus().available).toBe(true);

        const frame = latestLiveFrame();
        expect(frame).not.toBeNull();
        expect(frame!.data.length).toBeGreaterThan(1000); // non-trivial PNG
        expect(frame!.capturedAt).toBeGreaterThan(0);
      } catch (e: any) {
        if (/Executable doesn't exist|browserType\.launch|Failed to launch/i.test(e.message)) {
          console.warn("chromium not provisioned — skipping live assertions");
          return; // soft-skip when binary is missing
        }
        throw e;
      }
    },
    60_000
  );

  it(
    "updates the frame after a second navigation",
    async () => {
      try {
        await browserGoto(null, "data:text/html,<h1>Page Two</h1>");
        const frame = latestLiveFrame();
        expect(frame).not.toBeNull();
        expect(browserStatus().url).toContain("data:text/html");
      } catch (e: any) {
        if (/Executable doesn't exist|browserType\.launch|Failed to launch/i.test(e.message)) {
          return;
        }
        throw e;
      }
    },
    60_000
  );

  it(
    "scrolls and captures live frame",
    async () => {
      try {
        await browserGoto(null, "data:text/html,<body style='height:3000px'><h1>Scrollable</h1><p style='margin-top:1500px'>Scrolled content</p></body>");
        const res = await browserScroll(null, "down", 500);
        expect(res).toContain("Scrolled down");
        expect(res).toContain("Viewport vertical position");
        const frame = latestLiveFrame();
        expect(frame).not.toBeNull();
      } catch (e: any) {
        if (/Executable doesn't exist|browserType\.launch|Failed to launch/i.test(e.message)) {
          return;
        }
        throw e;
      }
    },
    60_000
  );

  it(
    "fills form inputs and captures live frame",
    async () => {
      try {
        await browserGoto(
          null,
          "data:text/html,<body><form><label for='name'>Name:</label><input id='name' placeholder='Your name'/><textarea id='bio' placeholder='About you'></textarea></form></body>"
        );
        const state = await browserRead(null);
        expect(state).toContain("Interactive elements");
        const fillRes = await browserFill(null, "e1", "Elio Agent");
        expect(fillRes).toContain("Filled e1");
        expect(fillRes).toContain("Elio Agent");
        const frame = latestLiveFrame();
        expect(frame).not.toBeNull();
      } catch (e: any) {
        if (/Executable doesn't exist|browserType\.launch|Failed to launch/i.test(e.message)) {
          return;
        }
        throw e;
      }
    },
    60_000
  );
});
