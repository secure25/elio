// ── In-process scheduler ─────────────────────────────────────────────────
// Checks every 15 minutes whether the morning digest is due (based on the
// configured hour). It also fires due reminders and runs due standing
// monitors. On boot, generates immediately if a digest was missed
// (catch-up) — so you always get today's digest even if the app starts late.
import { isDue, runMorningDigest, runDigest, digestConfig, listDigests } from "./digest";
import { fireDueReminders } from "./reminders";
import { dueMonitors, runMonitor } from "./monitors";
import { audit, db } from "./db";

let timer: NodeJS.Timeout | null = null;
let booted = false;

async function check() {
  // Morning digest
  try {
    if (await isDue("morning")) {
      await runDigest("morning");
    }
  } catch (e: any) {
    audit("scheduler", "digest.check_failed", { detail: `morning: ${String(e.message).slice(0, 200)}` });
  }

  // Evening digest
  try {
    if (await isDue("evening")) {
      await runDigest("evening");
    }
  } catch (e: any) {
    audit("scheduler", "digest.check_failed", { detail: `evening: ${String(e.message).slice(0, 200)}` });
  }

  try {
    await fireDueReminders();
  } catch (e: any) {
    audit("scheduler", "reminders.check_failed", { detail: String(e.message).slice(0, 200) });
  }

  try {
    const due = dueMonitors();
    for (const m of due) {
      audit("monitors", "scheduled_check", { target: m.id, detail: m.description.slice(0, 100) });
      // Sequential on purpose: each check runs the agent; avoid overlapping runs.
      await runMonitor(m);
    }
  } catch (e: any) {
    audit("scheduler", "monitors.check_failed", { detail: String(e.message).slice(0, 200) });
  }
}

export function startScheduler() {
  if (booted) return;
  booted = true;
  const { enabled, hour } = digestConfig();
  audit("scheduler", "started", { detail: `digest ${enabled ? `enabled @ ${hour}:00` : "disabled"}` });

  // Boot catch-up: if today's digest was missed, generate it now.
  void (async () => {
    try {
      if (await isDue("morning")) {
        audit("scheduler", "digest.catchup", { detail: "generating missed morning digest" });
        await runDigest("morning");
      }
      if (await isDue("evening")) {
        audit("scheduler", "digest.catchup", { detail: "generating missed evening digest" });
        await runDigest("evening");
      }
    } catch (e: any) {
      audit("scheduler", "digest.catchup_failed", { detail: String(e.message).slice(0, 200) });
    }
  })();

  // Then check every 15 minutes.
  // Tick every minute: reminders are promised at minute granularity, and a 15-minute
  // interval meant reminders could sit due (unfired) for up to 14 extra minutes.
  timer = setInterval(check, 60_000);
  timer.unref?.();

  // Digest-email retry queue: if delivery needs approval (not connected etc.), retry
  // every 15 min after resolution attempts so opted-in users get the email once unblocked.
  const emailTimer = setInterval(checkEmailQueue, 15 * 60_000);
  emailTimer.unref?.();
}

async function checkEmailQueue() {
  try {
    const { emailEnabled } = digestConfig();
    if (!emailEnabled) return;
    const latest = listDigests(1)[0];
    if (!latest) return;
    let meta: any = {};
    try {
      meta = JSON.parse(latest.meta || "{}");
    } catch {}
    if (meta.email !== "not_connected") return; // only retry "not connected" cases
    const grant = db.prepare("SELECT status FROM connector_grants WHERE connector='gmail'").get() as any;
    if (!grant || grant.status !== "connected") return;
    // Gmail now connected: attempt one delivery of the latest digest.
    const { emailDigest } = await import("./digest");
    const status = await emailDigest(latest.body);
    if (status === "sent") {
      meta.email = "sent";
      db.prepare("UPDATE digests SET meta = ? WHERE id = ?").run(JSON.stringify(meta), latest.id);
      audit("digest", "email.delivered", { detail: "delivered after connector connect (retry queue)", risk: "medium" });
    }
  } catch (e: any) {
    audit("digest", "email.retry_failed", { detail: String(e.message).slice(0, 200), risk: "low" });
  }
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  booted = false;
}
