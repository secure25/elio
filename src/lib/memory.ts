// ── Long-term memory: durable facts and preferences the agent can use ──
import { db, uuid, now, audit } from "./db";
import { redact } from "./vault";

export function remember(content: string, category = "general", source = "agent") {
  const clean = redact(content).slice(0, 500);
  db.prepare("INSERT INTO memories (id, content, category, source, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(
    uuid(),
    clean,
    category,
    source,
    now(),
    now()
  );
  audit("memory", "remembered", { detail: clean, risk: "low" });
}

export function forget(match: string): number {
  const rows = db
    .prepare("SELECT id, content FROM memories WHERE content LIKE ?")
    .all(`%${match}%`) as { id: string; content: string }[];
  for (const r of rows) db.prepare("DELETE FROM memories WHERE id = ?").run(r.id);
  audit("memory", "forgot", { detail: `${rows.length} entries matched "${match}"`, risk: "low" });
  return rows.length;
}

export function listMemories(): { id: string; content: string; category: string; created_at: number }[] {
  return db
    .prepare("SELECT id, content, category, created_at FROM memories ORDER BY updated_at DESC LIMIT 200")
    .all() as any[];
}

export function memoryContext(): string {
  const rows = db.prepare("SELECT content, category FROM memories ORDER BY updated_at DESC LIMIT 30").all() as {
    content: string;
    category: string;
  }[];
  if (!rows.length) return "";
  return `\n\n## What you remember about the user\n${rows
    .map((r) => `- [${r.category}] ${r.content}`)
    .join("\n")}`;
}

const MEMORY_CATEGORIES = [
  "general",
  "preferences",
  "people",
  "schedule",
  "work",
  "health",
  "finance",
] as const;

/** Extract durable memories from a user turn using the LLM. Failures are non-fatal. */
export async function extractMemories(userText: string): Promise<string[]> {
  try {
    const { getAdapter } = await import("./llm");
    const adapter = getAdapter();
    const res = await adapter.complete(
      [
        {
          role: "system",
          content:
            `Extract durable facts about the user worth remembering long-term (preferences, people, ` +
            `recurring events, goals, constraints). Categories: ${MEMORY_CATEGORIES.join(", ")}. ` +
            `Return ONLY a JSON array of objects {"content": string, "category": one of the categories}. ` +
            `Return [] if nothing durable. Max 3 items. Do not include one-off or transient info.`,
        },
        { role: "user", content: userText },
      ],
      { temperature: 0, maxTokens: 400 }
    );
    const match = res.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]) as { content: string; category?: string }[];
    const saved: string[] = [];
    for (const x of arr) {
      if (x && typeof x.content === "string") {
        remember(x.content, x.category || "general", "auto");
        saved.push(x.content);
      }
    }
    return saved.slice(0, 3);
  } catch {
    return [];
  }
}
