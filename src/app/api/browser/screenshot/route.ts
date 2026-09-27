import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

// GET /api/browser/screenshot → live PNG frame from the browser sub-agent.
// Falls back to the on-disk live frame if in-memory state is unavailable.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const meta = searchParams.get("meta");

  const { latestLiveFrame, browserStatus } = await import("@/lib/connectors/browser");
  const status = browserStatus();

  if (meta) {
    const frame = latestLiveFrame();
    if (frame) {
      return NextResponse.json(
        { available: true, capturedAt: frame.capturedAt, url: status.url, live: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    // disk fallback metadata (authoritative in dev where module state is per-route)
    const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || path.join(process.cwd(), "data");
    const jsonPath = path.join(dataDir, "downloads", "live.json");
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      return NextResponse.json(
        { available: true, capturedAt: j.capturedAt, url: j.url ?? null, live: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      return NextResponse.json(
        { available: false, url: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  const frame = latestLiveFrame();
  if (frame) {
    // URL comes from disk (live.json) in dev: per-route module copies can't see
    // the connector's in-memory page state.
    let pageUrl = status.url || "";
    try {
      const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || path.join(process.cwd(), "data");
      const j = JSON.parse(fs.readFileSync(path.join(dataDir, "downloads", "live.json"), "utf8"));
      if (!pageUrl && j.url) pageUrl = j.url;
      if (!frame || frame.capturedAt < (j.capturedAt ?? 0)) {
        // Disk frame is fresher than this module's memory (dev isolation) — serve disk.
        const buf = fs.readFileSync(path.join(dataDir, "downloads", "live.png"));
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "X-Frame-Captured-At": String(j.capturedAt),
            "X-Page-Url": encodeURI(j.url || pageUrl || ""),
          },
        });
      }
    } catch {}
    return new NextResponse(Buffer.from(frame.data, "base64"), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Frame-Captured-At": String(frame.capturedAt),
        "X-Page-Url": encodeURI(pageUrl),
      },
    });
  }

  // Fallback: read the last persisted frame from disk
  const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || path.join(process.cwd(), "data");
  const pngPath = path.join(dataDir, "downloads", "live.png");
  try {
    const buf = fs.readFileSync(pngPath);
    return new NextResponse(buf, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { available: false, reason: "The browser agent hasn't run yet. No frames captured." },
      { status: 404 }
    );
  }
}
