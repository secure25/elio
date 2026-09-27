// ── Web fetch + search (public reads, Sentinel-low) ──
// Routed through the sandboxed browser VM so every research step is VISIBLE in
// the Secure Workspace panel — same page the agent sees, same live frames.
import { guard } from "../sentinel";
import { addStep } from "../db";
import { redact } from "../vault";

export async function webFetch(taskId: string | null, url: string): Promise<string> {
  const verdict = guard({ action: "web.fetch", detail: `Fetch ${url}`, taskId });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  const { browserFetchText } = await import("./browser");
  const text = await browserFetchText(url);
  if (taskId && !/^Fetch failed/.test(text)) addStep(taskId, "web.fetch", url);
  return text;
}

type ExaResult = { title: string | null; url: string; highlights?: string[] | null };

function formatExaResults(query: string, results: ExaResult[]): string {
  if (!results.length) return "No results found.";
  const lines: string[] = [];
  for (const r of results.slice(0, 5)) {
    lines.push(`${(r.title || "(untitled)").trim()} — ${r.url}`);
    for (const h of (r.highlights || []).slice(0, 2)) {
      const t = h.replace(/\s+/g, " ").trim();
      if (t) lines.push(`  > ${t.slice(0, 300)}`);
    }
  }
  return lines.join("\n");
}

// Primary backend: Exa API (result titles/URLs + query-relevant highlights).
// Falls back to the sandboxed-browser DuckDuckGo scrape on any Exa failure, so
// research degrades gracefully and keeps the live frames when Exa is down.
async function exaSearch(query: string): Promise<string> {
  const apiKey = process.env.EXA_API_KEY || "";
  if (!apiKey) throw new Error("EXA_API_KEY not configured");
  const { default: Exa } = await import("exa-js");
  const exa = new Exa(apiKey);
  const res = await exa.search(query, { type: "auto", numResults: 5, contents: { highlights: true } });
  return formatExaResults(query, (res.results || []) as ExaResult[]);
}

export async function webSearch(taskId: string | null, query: string): Promise<string> {
  const verdict = guard({ action: "web.search", detail: `Search: ${query}`, taskId });
  if (verdict.decision === "deny") return `Blocked by Sentinel: ${verdict.reason}`;
  let results = "";
  try {
    results = await exaSearch(query);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[web] Exa search failed, falling back to DuckDuckGo:", msg);
    const { browserSearch } = await import("./browser");
    results = await browserSearch(query);
  }
  if (taskId && !/^Search failed/.test(results)) {
    addStep(taskId, "web.search", `${query} → ${results.split("\n").length} results`);
  }
  return results;
}
