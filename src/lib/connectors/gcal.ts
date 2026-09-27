// ── Google Calendar connector (real integration, REST API, no SDK) ──
// Reads are low-risk; create/delete are Sentinel-gated.
import { getAccessToken } from "../google-oauth";
import { guard, waitForApproval } from "../sentinel";
import { addStep, audit } from "../db";

const API = "https://www.googleapis.com/calendar/v3";

async function calFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken("gcal");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function calendarList(
  taskId: string | null,
  opts: { timeMin?: string; timeMax?: string; max?: number } = {}
): Promise<string> {
  const verdict = guard({ action: "calendar.list", detail: "List upcoming events", taskId });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  const params = new URLSearchParams({
    timeMin: opts.timeMin ?? new Date().toISOString(),
    timeMax: opts.timeMax ?? new Date(Date.now() + 14 * 864e5).toISOString(),
    maxResults: String(opts.max ?? 20),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const data = await calFetch(`/calendars/primary/events?${params.toString()}`);
  if (taskId) addStep(taskId, "calendar.list", `${(data.items ?? []).length} events`);
  if (!data.items?.length) return "No upcoming events in the next 14 days.";
  return data.items
    .map(
      (e: any) =>
        `${e.start?.dateTime ?? e.start?.date ?? "?"} → ${e.end?.dateTime ?? e.end?.date ?? ""} | ${
          e.summary ?? "(no title)"
        }${e.location ? ` | ${e.location}` : ""}${e.id ? ` | id:${e.id}` : ""}`
    )
    .join("\n");
}

export async function calendarCreate(
  taskId: string | null,
  conversationId: string | null,
  ev: {
    summary: string;
    start: string; // ISO datetime
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
  }
): Promise<string> {
  const verdict = guard({
    action: "calendar.create",
    detail: `Create event "${ev.summary}" at ${ev.start}`,
    taskId,
    conversationId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return "Blocked by Sentinel.";
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") return "Event was NOT created (approval denied or timed out).";
  }
  const created = await calFetch("/calendars/primary/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.summary,
      description: ev.description,
      location: ev.location,
      start: { dateTime: ev.start },
      end: { dateTime: ev.end },
      ...(ev.attendees ? { attendees: ev.attendees.map((email) => ({ email })) } : {}),
    }),
  });
  audit("gcal", "event.created", { target: ev.summary, detail: ev.start, risk: "medium" });
  if (taskId) addStep(taskId, "calendar.create", `${ev.summary} @ ${ev.start}`);
  return `Event created: ${created.htmlLink}`;
}

export async function calendarDelete(
  taskId: string | null,
  conversationId: string | null,
  eventId: string
): Promise<string> {
  const verdict = guard({
    action: "calendar.delete",
    detail: `Delete event ${eventId}`,
    taskId,
    conversationId,
  });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  if (verdict.decision === "ask") {
    if (!verdict.approvalId) return "Blocked by Sentinel.";
    const outcome = await waitForApproval(verdict.approvalId, { timeoutMs: 15 * 60_000 });
    if (outcome !== "approved") return "Event was NOT deleted.";
  }
  await calFetch(`/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  audit("gcal", "event.deleted", { target: eventId, risk: "high" });
  return "Event deleted.";
}
