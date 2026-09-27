// ── Lazy server boot ──────────────────────────────────────────────────────
// Next 15 compiles src/instrumentation.ts for the edge runtime too, where
// `node:` imports fail to bundle — so instead of an instrumentation hook we
// boot background services (scheduler) lazily from the first Node-runtime
// API request. Idempotent and error-isolated: a boot failure must never
// fail the request that triggered it.
import { startScheduler } from "./scheduler";

let booted = false;

export function ensureBoot() {
  if (booted) return;
  booted = true;
  try {
    startScheduler();
  } catch (e: any) {
    console.error("[boot] scheduler start failed:", e?.message || e);
  }
}
