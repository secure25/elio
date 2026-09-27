// ── Gmail connector (real integration, REST API, no SDK) ──
// Read ops are low-risk; send is Sentinel-gated (approval required).
// Built-in OTP filter: one-time codes / reset links are never exposed to the model.
import { getAccessToken, getGrant } from "../google-oauth";
import { guard, waitForApproval } from "../sentinel";
import { addStep, audit } from "../db";
import { redact } from "../vault";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const OTP_PATTERNS: RegExp[] = [
  /\b\d{4,8}\b(?=[^\n]{0,40}\b(code|otp|pin|passcode|verification)\b)/gi,
  /\b(code|otp|pin|passcode|verification)\b[^\n]{0,20}\b\d{4,8}\b/gi,
  /\bG-\d{6}\b/g,
  /\b\d{3}[- ]?\d{3}\b/g,
  /https?:\/\/[^\s]*(verify|reset|password|signin|auth)[^\s]*/gi,
];

export function filterOtpContent(text: string): string {
  let out = text;
  for (const re of OTP_PATTERNS) out = out.replace(re, "[filtered: possible OTP or reset link]");
  return out;
}

function decodeB64url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64url(payload.body.data);
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) return decodeB64url(part.body.data);
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return "";
}

async function gmailFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken("gmail");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function gmailList(
  taskId: string | null,
  opts: { query?: string; max?: number } = {}
): Promise<string> {
  const verdict = guard({ action: "gmail.list", detail: `List mail${opts.query ? `: ${opts.query}` : ""}`, taskId });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  const list = await gmailFetch(
    `/messages?maxResults=${opts.max ?? 10}${opts.query ? `&q=${encodeURIComponent(opts.query)}` : ""}`
  );
  const out: string[] = [];
  for (const m of (list.messages ?? []).slice(0, opts.max ?? 10)) {
    const msg = await gmailFetch(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const headers = msg.payload?.headers ?? [];
    out.push(
      [
        `id: ${m.id}`,
        `from: ${headers.find((h: any) => h.name === "From")?.value ?? "?"}`,
        `subject: ${headers.find((h: any) => h.name === "Subject")?.value ?? "(none)"}`,
        `date: ${headers.find((h: any) => h.name === "Date")?.value ?? "?"}`,
      ].join(" | ")
    );
  }
  if (taskId) addStep(taskId, "gmail.list", `${out.length} messages`);
  return out.length ? out.join("\n") : "No messages found.";
}

export async function gmailRead(taskId: string | null, id: string): Promise<string> {
  const verdict = guard({ action: "gmail.read", detail: `Read message ${id}`, taskId });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  const msg = await gmailFetch(`/messages/${id}?format=full`);
  const headers = msg.payload?.headers ?? [];
  const body = filterOtpContent(extractBody(msg.payload));
  if (taskId) addStep(taskId, "gmail.read", headers.find((h: any) => h.name === "Subject")?.value || id);
  return [
    `from: ${headers.find((h: any) => h.name === "From")?.value ?? "?"}`,
    `to: ${headers.find((h: any) => h.name === "To")?.value ?? "?"}`,
    `subject: ${headers.find((h: any) => h.name === "Subject")?.value ?? "(none)"}`,
    `date: ${headers.find((h: any) => h.name === "Date")?.value ?? "?"}`,
    "",
    body.slice(0, 4000),
  ].join("\n");
}

export async function gmailSearch(taskId: string | null, query: string, max = 10) {
  return gmailList(taskId, { query, max });
}

export async function gmailSend(
  taskId: string | null,
  conversationId: string | null,
  to: string,
  subject: string,
  body: string
): Promise<string> {
  // Sentinel gate: creating the approval + waiting for the human.
  const verdict = guard({
    action: "gmail.send",
    detail: `Send email to ${to} — subject "${subject}"`,
    taskId,
    conversationId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return "Blocked by Sentinel.";
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") {
      audit("gmail", "send.not_approved", { target: to, risk: "high" });
      return "Email was NOT sent (approval denied or timed out).";
    }
  }

  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`
  ).toString("base64url");

  await gmailFetch("/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  audit("gmail", "email.sent", { target: to, detail: subject, risk: "high" });
  if (taskId) addStep(taskId, "gmail.send", `to=${to} subject="${subject}"`);
  return `Email sent to ${to}.`;
}

// ── Digest delivery: unattended email to the account owner ONLY ──
// This is NOT an agent tool (never in the tool registry, so the LLM cannot call it).
// Sentinel allows it only because the user opted in and the recipient is locked to
// the connected account's own address.
export async function gmailSendDigest(subject: string, bodyText: string): Promise<string> {
  const grant = getGrant("gmail");
  if (!grant || grant.status !== "connected" || !grant.account_email) {
    return "not_connected";
  }
  const to = grant.account_email; // hard-locked to the account owner
  const { classify } = await import("../sentinel");
  if (classify("gmail.send_digest").decision !== "allow") {
    return "Blocked by Sentinel: digest delivery is not permitted.";
  }

  const boundary = "elio-digest-" + Date.now();
  const raw = Buffer.from(
    `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
      `${bodyText}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n\r\n` +
      `${markdownToHtml(bodyText)}\r\n` +
      `--${boundary}--`
  ).toString("base64url");

  await gmailFetch("/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  audit("gmail", "digest.emailed", { target: to, detail: subject, risk: "medium" });
  return "sent";
}

// Minimal markdown → HTML for the digest email body.
function markdownToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const li = line.match(/^\s*[-*•]\s+(.*)/);
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (h) out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    else if (line.trim() === "") out.push("");
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

export function redactForLog(text: string): string {
  return redact(text);
}
