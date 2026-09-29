// ── Browser sub-agent: Playwright, a11y-tree-only, gated submission ──
// Faithful to the Muse reference design: the model sees an accessibility tree (roles + names +
// refs), never raw HTML, and cannot execute page JavaScript. Form
// submissions are Sentinel-gated and require human approval.
//
// Live view: every action captures a fixed-size PNG "frame" that the UI
// polls, so you can watch the agent work like the reference agent's visible browser.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { guard, waitForApproval } from "../sentinel";
import { addStep } from "../db";
import { redact } from "../vault";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

const DATA_DIR = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || path.join(process.cwd(), "data");
const DOWNLOAD_DIR = path.join(DATA_DIR, "downloads");
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], ' +
  '[role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="combobox"], ' +
  '[role="searchbox"], [role="switch"], [contenteditable="true"]';

// ── Live screenshot capture ──────────────────────────────────────────────
const VIEWPORT = { width: 1280, height: 800 };
const MAX_FRAMES = 5;

interface Frame {
  data: string; // base64 PNG
  capturedAt: number;
}

let latestFrame: Frame | null = null;
let frameHistory: Frame[] = [];
let frameSeq = 0;

async function captureFrame(p: Page): Promise<void> {
  try {
    const buf = await p.screenshot({
      type: "png",
    });
    const frame: Frame = { data: buf.toString("base64"), capturedAt: Date.now() };
    latestFrame = frame;
    frameSeq++;
    // Persist the live frame for the screenshot endpoint (disk, not memory:
    // Next dev gives each route bundle its own module copy, so cross-route
    // visibility must go through files — same reason the voice note is on disk).
    fs.promises.writeFile(path.join(DOWNLOAD_DIR, "live.png"), buf).catch(() => {});
    const liveUrl = (() => {
      try {
        return page && !page.isClosed() ? page.url() : null;
      } catch {
        return null;
      }
    })();
    fs.promises
      .writeFile(path.join(DOWNLOAD_DIR, "live.json"), JSON.stringify({ capturedAt: frame.capturedAt, url: liveUrl }))
      .catch(() => {});
    // Keep a short history of distinct frames
    if (frameHistory.length === 0 || frameHistory[frameHistory.length - 1].data !== frame.data) {
      frameHistory.push(frame);
      if (frameHistory.length > MAX_FRAMES) frameHistory.shift();
      fs.promises
        .writeFile(path.join(DOWNLOAD_DIR, `frame-${frameSeq}.png`), buf)
        .catch(() => {});
      pruneFrameFiles();
    }
  } catch {
    // screenshot failure must never break the agent action
  }
}

function pruneFrameFiles() {
  fs.promises
    .readdir(DOWNLOAD_DIR)
    .then((files) => {
      const frameFiles = files
        .filter((f) => f.startsWith("frame-") && f.endsWith(".png"))
        .map((f) => parseInt(f.slice(6), 10))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => b - a);
      for (const n of frameFiles.slice(MAX_FRAMES)) {
        fs.promises.unlink(path.join(DOWNLOAD_DIR, `frame-${n}.png`)).catch(() => {});
      }
    })
    .catch(() => {});
}

/** Latest captured frame (base64) or null if the browser hasn't produced one yet. */
export function latestLiveFrame(): { data: string; capturedAt: number } | null {
  return latestFrame;
}

/** Recent distinct frames, oldest first. */
export function recentFrames(): { data: string; capturedAt: number }[] {
  return frameHistory.slice();
}

export function browserStatus(): { available: boolean; url: string | null } {
  try {
    return { available: Boolean(page && !page.isClosed()), url: page && !page.isClosed() ? page.url() : null };
  } catch {
    return { available: false, url: null };
  }
}

const ROLE_MAP: Record<string, string> = {
  a: "link",
  button: "button",
  textarea: "textbox",
  select: "combobox",
  input: "textbox",
};

interface ElementInfo {
  role: string; // our role label for display
  ariaRole?: string; // role for getByRole, if usable
  name: string; // accessible name
  placeholder?: string;
  type?: string;
  index: number; // fallback index into INTERACTIVE_SELECTOR order
}

async function listInteractive(): Promise<ElementInfo[]> {
  const p = await ensurePage();
  return p.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel)).slice(0, 120);
    return els.map((el, i) => {
      const he = el as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const explicitRole = el.getAttribute("role") || "";
      const inputType = tag === "input" ? (el as HTMLInputElement).type : "";
      let ariaRole = explicitRole || undefined;
      if (!ariaRole) {
        if (tag === "a") ariaRole = "link";
        else if (tag === "button") ariaRole = "button";
        else if (tag === "select") ariaRole = "combobox";
        else if (tag === "textarea") ariaRole = "textbox";
        else if (tag === "input" && !["hidden", "submit", "button"].includes(inputType))
          ariaRole =
            inputType === "checkbox" ? "checkbox" : inputType === "radio" ? "radio" : "textbox";
      }
      const name =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (he.innerText || "").trim().split("\n")[0].slice(0, 80) ||
        el.getAttribute("value") ||
        "";
      return {
        role: explicitRole || tag + (inputType ? `[type=${inputType}]` : ""),
        ariaRole: ariaRole || undefined,
        name,
        placeholder: el.getAttribute("placeholder") || undefined,
        type: inputType || undefined,
        index: i,
      };
    });
  }, INTERACTIVE_SELECTOR);
}

function renderRefs(infos: ElementInfo[]): { listing: string; refs: Map<string, ElementInfo> } {
  const refs = new Map<string, ElementInfo>();
  const lines: string[] = [];
  infos.forEach((info, i) => {
    const ref = `e${i + 1}`;
    refs.set(ref, info);
    const bits = [`[${info.role}`];
    if (info.ariaRole) bits.push(`→${info.ariaRole}`);
    bits.push("]");
    if (info.name) lines.push(`${ref} ${bits.join("")} "${info.name.replace(/"/g, "'")}"`);
    else if (info.placeholder)
      lines.push(`${ref} ${bits.join("")} placeholder="${info.placeholder}"`);
    else lines.push(`${ref} ${bits.join("")}`);
  });
  return { listing: lines.join("\n"), refs };
}

// Latest refs (single page at a time in this VM).
let latestRefs = new Map<string, ElementInfo>();

function targetFor(ref: string) {
  const info = latestRefs.get(ref);
  if (!info) return null;
  return {
    info,
    async locate(p: Page) {
      if (info.ariaRole && info.name) {
        return p.getByRole(info.ariaRole as any, { name: info.name }).first();
      }
      if (info.placeholder) return p.getByPlaceholder(info.placeholder).first();
      return p.locator(INTERACTIVE_SELECTOR).nth(info.index);
    },
  };
}

function fmt(text: string): string {
  return text.length > 14000 ? text.slice(0, 14000) + "\n… [truncated]" : text;
}

async function pageState(): Promise<string> {
  const p = await ensurePage();
  const title = await p.title();
  const url = p.url();
  const { listing, refs } = renderRefs(await listInteractive());
  latestRefs = refs;
  let snap = "";
  try {
    snap = await p.locator("body").ariaSnapshot();
  } catch {
    snap = "";
  }
  return fmt(
    `# ${title}\n${url}\n\n## Interactive elements (use refs)\n${listing || "(none)"}\n\n## Page structure\n${
      snap.length > 5000 ? snap.slice(0, 5000) + "\n… [truncated]" : snap
    }`
  );
}

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  if (!context) {
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: VIEWPORT,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });
  }
  page = await context.newPage();
  return page;
}

export async function closeBrowser() {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
  latestFrame = null;
}

export async function browserGoto(taskId: string | null, url: string): Promise<string> {
  const verdict = guard({ action: "browser.goto", detail: `Navigate to ${url}`, taskId });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  const p = await ensurePage();
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await p.waitForTimeout(800);
  if (taskId) addStep(taskId, "browser.goto", url);
  await captureFrame(p);
  return pageState();
}

export async function browserRead(taskId: string | null): Promise<string> {
  const p = await ensurePage();
  if (taskId) addStep(taskId, "browser.read", "Re-read current page");
  await captureFrame(p);
  return pageState();
}

async function clickTarget(p: Page, info: ElementInfo): Promise<void> {
  // Strategy 1: Try getByRole if accessible role + name exist
  if (info.ariaRole && info.name) {
    try {
      const loc = p.getByRole(info.ariaRole as any, { name: info.name }).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await loc.click({ timeout: 3500 });
      return;
    } catch {
      // Fall through to next strategy
    }
  }

  // Strategy 2: If placeholder exists
  if (info.placeholder) {
    try {
      const loc = p.getByPlaceholder(info.placeholder).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await loc.click({ timeout: 3500 });
      return;
    } catch {
      // Fall through to next strategy
    }
  }

  // Strategy 3: Try locator by DOM index
  const nthLoc = p.locator(INTERACTIVE_SELECTOR).nth(info.index);
  try {
    await nthLoc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await nthLoc.click({ timeout: 3500 });
    return;
  } catch {
    // Fall through to forced click
  }

  // Strategy 4: Forced click (bypasses sticky headers/navbars, cookie popups)
  try {
    await nthLoc.click({ force: true, timeout: 3500 });
    return;
  } catch {
    // Fall through to in-page evaluate click
  }

  // Strategy 5: Direct evaluate click in browser page
  await p.evaluate(
    ({ sel, idx }: { sel: string; idx: number }) => {
      const els = document.querySelectorAll(sel);
      const el = els[idx] as HTMLElement;
      if (!el) throw new Error("Element not found at index " + idx);
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
    },
    { sel: INTERACTIVE_SELECTOR, idx: info.index }
  );
}

export async function browserClick(taskId: string | null, ref: string): Promise<string> {
  let p = await ensurePage();
  const target = targetFor(ref);
  if (!target) return `Unknown ref "${ref}". Call browser.read to get current refs.`;
  const verdict = guard({
    action: "browser.click",
    detail: `Click ${ref} "${target.info.name || target.info.role}"`,
    taskId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;

  try {
    await clickTarget(p, target.info);
  } catch (err: any) {
    return `Click failed on ${ref}: ${err.message || String(err)}`;
  }

  // If click opened a new tab or window, adopt it
  if (context) {
    const pages = context.pages().filter((pg) => !pg.isClosed());
    if (pages.length > 0 && pages[pages.length - 1] !== page) {
      page = pages[pages.length - 1];
      p = page;
    }
  }

  await p.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(1000);
  if (taskId) addStep(taskId, "browser.click", `${ref} "${target.info.name || target.info.role}"`);
  await captureFrame(p);
  return pageState();
}

export async function browserScroll(
  taskId: string | null,
  direction?: string,
  amount?: number
): Promise<string> {
  const p = await ensurePage();
  const dir = (direction || "down").toLowerCase();
  const px = typeof amount === "number" && amount > 0 ? amount : 600;

  const scrollResult = await p.evaluate(
    ({ d, delta }: { d: string; delta: number }) => {
      if (d === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (d === "bottom") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      } else if (d === "up") {
        window.scrollBy({ top: -delta, behavior: "smooth" });
      } else {
        // default "down"
        window.scrollBy({ top: delta, behavior: "smooth" });
      }
      return {
        scrollY: Math.round(window.scrollY),
        scrollHeight: document.body.scrollHeight,
        innerHeight: window.innerHeight,
      };
    },
    { d: dir, delta: px }
  );

  // Wait for smooth scrolling to visually settle
  await p.waitForTimeout(800);
  if (taskId) addStep(taskId, "browser.scroll", `Scrolled ${dir} (${px}px)`);
  await captureFrame(p);
  return `Scrolled ${dir}. Viewport vertical position: ${scrollResult.scrollY}px (total page height: ${scrollResult.scrollHeight}px). Call browser.read to see refreshed visible elements.`;
}

async function fillTarget(p: Page, info: ElementInfo, value: string): Promise<void> {
  // Strategy 1: Try getByRole if accessible role + name exist
  if (info.ariaRole && info.name) {
    try {
      const loc = p.getByRole(info.ariaRole as any, { name: info.name }).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await loc.fill(value, { timeout: 3500 });
      return;
    } catch {
      // Fall through to next strategy
    }
  }

  // Strategy 2: If placeholder exists
  if (info.placeholder) {
    try {
      const loc = p.getByPlaceholder(info.placeholder).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await loc.fill(value, { timeout: 3500 });
      return;
    } catch {
      // Fall through to next strategy
    }
  }

  // Strategy 3: Try locator by DOM index
  const nthLoc = p.locator(INTERACTIVE_SELECTOR).nth(info.index);
  try {
    await nthLoc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await nthLoc.fill(value, { timeout: 3500 });
    return;
  } catch {
    // Fall through to focus + keyboard typing
  }

  // Strategy 4: Focus and type with keyboard
  try {
    await nthLoc.focus({ timeout: 2000 });
    await p.keyboard.press("Control+A");
    await p.keyboard.press("Backspace");
    await p.keyboard.type(value);
    return;
  } catch {
    // Fall through to direct JS evaluation
  }

  // Strategy 5: Direct evaluate fill in browser page
  await p.evaluate(
    ({ sel, idx, val }: { sel: string; idx: number; val: string }) => {
      const els = document.querySelectorAll(sel);
      const el = els[idx] as HTMLInputElement | HTMLTextAreaElement;
      if (!el) throw new Error("Element not found at index " + idx);
      el.scrollIntoView({ block: "center", inline: "center" });
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: INTERACTIVE_SELECTOR, idx: info.index, val: value }
  );
}

export async function browserFill(
  taskId: string | null,
  ref: string,
  value: string
): Promise<string> {
  const p = await ensurePage();
  const target = targetFor(ref);
  if (!target) return `Unknown ref "${ref}". Call browser.read to get current refs.`;
  const verdict = guard({
    action: "browser.fill",
    detail: `Fill ${ref} "${target.info.name || target.info.placeholder || target.info.role}"`,
    taskId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;

  try {
    await fillTarget(p, target.info, value);
  } catch (err: any) {
    return `Fill failed on ${ref}: ${err.message || String(err)}`;
  }

  if (taskId) addStep(taskId, "browser.fill", `${ref} ← "${value.slice(0, 30)}"`);
  await captureFrame(p);
  return `Filled ${ref} with "${value}".`;
}

export async function browserSubmit(
  taskId: string | null,
  ref: string,
  conversationId?: string | null
): Promise<string> {
  const p = await ensurePage();
  const target = targetFor(ref);
  if (!target) return `Unknown ref "${ref}". Call browser.read to get current refs.`;
  const verdict = guard({
    action: "browser.submit",
    detail: `Submit form via ${ref} "${target.info.name || target.info.role}" on ${p.url()}`,
    taskId,
    conversationId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return "Blocked by Sentinel.";
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") return "Submission was not approved. Nothing was sent.";
  }
  await (await target.locate(p)).click({ timeout: 20_000 });
  await p.waitForLoadState("domcontentloaded").catch(() => {});
  await p.waitForTimeout(1500);
  if (taskId) addStep(taskId, "browser.submit", `${ref} (approved)`);
  await captureFrame(p);
  return `Submitted.\n${await pageState()}`;
}

// ── Live-activity helpers: keep the Secure Workspace genuinely live ───────
// webFetch/webSearch run through the SAME browser VM, so research is visible
// like every other browser action; plus a light idle-capture loop keeps frames
// flowing while a task is running (page animations, JS redirects, etc.).

export async function browserFetchText(url: string): Promise<string> {
  const p = await ensurePage();
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p.waitForTimeout(600);
    await captureFrame(p);
    const text = await p.evaluate(() => document.body.innerText.slice(0, 8000));
    return redact(text.replace(/\s+/g, " ").trim());
  } catch (e: any) {
    return `Fetch failed: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}

export async function browserSearch(query: string): Promise<string> {
  const p = await ensurePage();
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p.waitForTimeout(800);
    await captureFrame(p);

    // Primary parse: the rendered DOM (robust to quoting/ordering changes).
    const domResults: { title: string; href: string }[] = await p.evaluate(() => {
      const out: { title: string; href: string }[] = [];
      const links = document.querySelectorAll<HTMLAnchorElement>(
        ".result__a, a.result__a, [class*=result] a[href]"
      );
      for (const a of Array.from(links)) {
        const title = (a.textContent || "").trim();
        const href = a.getAttribute("href") || "";
        if (title && href && !href.startsWith("javascript:")) out.push({ title, href });
        if (out.length >= 8) break;
      }
      return out;
    });

    // Fallback parse: raw-HTML regex (covers layout variants the selectors miss).
    let results = domResults.map((r) => {
      const href = r.href.startsWith("//") ? `https:${r.href}` : r.href;
      return `${r.title} — ${href}`;
    });
    if (!results.length) {
      const html = await p.content();
      const rx = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html)) && results.length < 8) {
        const href = m[1].startsWith("//") ? `https:${m[1]}` : m[1];
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        if (title && href) results.push(`${title} — ${href}`);
      }
    }

    // DuckDuckGo sometimes soft-blocks bots with an anomaly page; detect it so
    // the agent can adapt instead of believing there were no results.
    if (!results.length) {
      const bodyText = await p.evaluate(() => document.body.innerText.slice(0, 400));
      if (/anomaly|unusual traffic|verify|captcha/i.test(bodyText)) {
        return "Search engine is temporarily blocking automated queries (anomaly/captcha page). Try again shortly or use web_fetch on a known URL.";
      }
    }

    return results.length ? results.join("\n") : "No results found.";
  } catch (e: any) {
    return `Search failed: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}

// Idle-capture: while a task is running, refresh the live frame every 2.5s so
// the panel reflects slow JS transitions, not just tool boundaries. Runs only
// while the browser exists; self-stops when idle.
let idleTimer: NodeJS.Timeout | null = null;
export function noteTaskActive(): void {
  if (idleTimer) return;
  idleTimer = setInterval(async () => {
    try {
      if (page && !page.isClosed()) await captureFrame(page);
      else if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = null;
      }
    } catch {
      /* never break the agent because of a frame */
    }
  }, 2_500);
  idleTimer.unref?.();
}

export async function browserScreenshotPath(): Promise<string | null> {
  try {
    const p = await ensurePage();
    const file = path.join(DOWNLOAD_DIR, `shot-${Date.now()}.png`);
    await p.screenshot({ path: file });
    return file;
  } catch {
    return null;
  }
}

export async function browserExtract(taskId: string | null): Promise<string> {
  const p = await ensurePage();
  const text = await p.evaluate(() => document.body.innerText.slice(0, 6000));
  if (taskId) addStep(taskId, "browser.extract", `${text.length} chars extracted`);
  return redact(text);
}

export function activePageUrl(): string | null {
  try {
    return page && !page.isClosed() ? page.url() : null;
  } catch {
    return null;
  }
}
