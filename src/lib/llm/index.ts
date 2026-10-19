import type { LLMAdapter } from "./types";
import { geminiAdapter } from "./gemini";
import { openAICompatibleAdapter } from "./openai-compatible";

// Provider selection with automatic failover: the primary provider is chosen by
// LLM_PROVIDER (or first configured key), and when a call fails with a
// rate-limit/quota/capacity error, the next configured provider is tried —
// so a free-tier quota wall no longer kills a running task mid-flight.
const RATE_LIMIT_RE =
  /quota|rate.?limit|exceeded|429|502|503|504|bad gateway|gateway|unavailable|high demand|overloaded|capacity|too many requests|non-json response/i;

function buildAdapter(provider: string): LLMAdapter {
  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing in .env");
    return geminiAdapter({
      apiKey: process.env.GEMINI_API_KEY,
      // "gemini-flash-latest" is a Google-maintained alias that always points
      // at the current flash model — pinned snapshots like "gemini-2.5-flash"
      // get retired for new accounts (404 "no longer available to new users").
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
    });
  }
  if (provider === "groq") {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing in .env");
    return openAICompatibleAdapter({
      provider: "groq",
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
      baseUrl: "https://api.groq.com/openai/v1",
    });
  }
  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing in .env");
    return openAICompatibleAdapter({
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
      baseUrl: "https://openrouter.ai/api/v1",
    });
  }
  if (provider === "codecraft") {
    if (!process.env.CODECRAFT_API_KEY) throw new Error("CODECRAFT_API_KEY missing in .env");
    return openAICompatibleAdapter({
      provider: "codecraft",
      apiKey: process.env.CODECRAFT_API_KEY,
      model: process.env.CODECRAFT_MODEL || "claude-opus-4.8",
      baseUrl: "https://codecraftapi.com/v1",
    });
  }
  if (provider === "cleanapis") {
    if (!process.env.CLEANAPIS_API_KEY) throw new Error("CLEANAPIS_API_KEY missing in .env");
    return openAICompatibleAdapter({
      provider: "cleanapis",
      apiKey: process.env.CLEANAPIS_API_KEY,
      model: process.env.CLEANAPIS_MODEL || "gemini-3.7-flash",
      baseUrl: "https://cleanapis.com/v1",
    });
  }
  if (provider === "qwen") {
    if (!process.env.QWEN_API_TOKEN || !process.env.QWEN_BASE_URL) {
      throw new Error("QWEN_API_TOKEN and QWEN_BASE_URL missing in .env");
    }
    return openAICompatibleAdapter({
      provider: "qwen",
      apiKey: process.env.QWEN_API_TOKEN,
      model: process.env.QWEN_MODEL || "Qwen/Qwen3-8B",
      baseUrl: process.env.QWEN_BASE_URL,
    });
  }
  throw new Error(`Unknown LLM provider: ${provider}`);
}

/** Providers configured in .env, in preference order. */
export function configuredProviders(): string[] {
  const order: string[] = [];
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (explicit) order.push(explicit);
  for (const p of ["codecraft", "cleanapis", "gemini", "groq", "openrouter", "qwen"]) {
    if (!order.includes(p)) order.push(p);
  }
  return order.filter((p) => {
    if (p === "codecraft") return Boolean(process.env.CODECRAFT_API_KEY);
    if (p === "cleanapis") return Boolean(process.env.CLEANAPIS_API_KEY);
    if (p === "gemini") return Boolean(process.env.GEMINI_API_KEY);
    if (p === "groq") return Boolean(process.env.GROQ_API_KEY);
    if (p === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
    if (p === "qwen") return Boolean(process.env.QWEN_API_TOKEN && process.env.QWEN_BASE_URL);
    return false;
  });
}

export function getAdapter(): LLMAdapter {
  const providers = configuredProviders();
  if (!providers.length) {
    throw new Error(
      "No LLM configured. Set LLM_PROVIDER (gemini|groq|openrouter|qwen) and its API key in .env"
    );
  }

  // Single provider: no wrapper needed.
  if (providers.length === 1) return buildAdapter(providers[0]);

  // Failover chain: adapters built once; rate-limit-style errors cascade to
  // the next provider, everything else surfaces immediately.
  const adapters = providers.map((p) => ({ name: p, adapter: buildAdapter(p) }));
  return {
    provider: `failover(${providers.join("→")})`,
    model: adapters[0].adapter.model,
    async complete(messages, opts) {
      let lastErr: unknown;
      for (const { name, adapter } of adapters) {
        try {
          return await adapter.complete(messages, opts);
        } catch (e) {
          lastErr = e;
          const msg = String((e as any)?.message ?? e);
          if (!RATE_LIMIT_RE.test(msg)) throw e; // non-transient: surface immediately
          // rate-limit / capacity → fall through to the next provider
        }
      }
      throw lastErr;
    },
  };
}
