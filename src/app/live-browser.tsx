"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Lock, Maximize2, Minimize2, RotateCw, X } from "lucide-react";

interface LiveFrame {
  src: string;
  capturedAt: number;
  url: string | null;
}

export function LiveBrowser({
  active,
  onClose,
}: {
  active: boolean;
  /** Shown only on phones: closes the full-screen sheet. */
  onClose?: () => void;
}) {
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let seq = 0;
    async function poll() {
      try {
        const res = await fetch(`/api/browser/screenshot?m=${seq++}`, { cache: "no-store" });
        if (res.ok && res.headers.get("content-type")?.includes("image/png")) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const capturedAt = Number(res.headers.get("X-Frame-Captured-At")) || 0;
          setFrame((prev) => {
            if (prev) URL.revokeObjectURL(prev.src);
            return {
              src: url,
              capturedAt,
              url: res.headers.get("X-Page-Url") || null,
            };
          });
          setError(null);
          setStale(Date.now() - capturedAt > 20_000);
        } else {
          const j = await res.json().catch(() => null);
          setError(j?.reason || "No live frame yet");
        }
      } catch {
        /* transient — keep last frame */
      }
    }
    poll();
    const iv = setInterval(poll, active ? 1500 : 5000);
    return () => clearInterval(iv);
  }, [active, tick]);

  return (
    <aside
      className={`
        ${expanded ? "w-[620px]" : "w-[360px]"}
        /* Phones: full-screen sheet that covers the chat; desktop: docked aside. */
        max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-auto
        shrink-0 border-l border-[var(--border)] bg-[var(--bg)] flex flex-col transition-all duration-200`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Header */}
      <div
        className="px-4 md:px-5 py-4 border-b border-[var(--border)]"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2">
          <Lock size={16} className="text-[var(--text)] shrink-0" />
          <h2 className="text-base font-medium text-[var(--text)] flex-1">Secure workspace</h2>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close workspace panel"
              className="p-2 -mr-1 rounded-lg text-[var(--muted)] hover:bg-[#EBE8DF] active:bg-[#E2DDD3] cursor-pointer md:hidden"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Your data stays private. No training. No sharing.
        </p>
      </div>

      {/* Action controls */}
      <div className="p-4 pb-2 grid grid-cols-2 gap-2.5 [&_.btn]:py-2.5 [&_.btn]:text-sm md:[&_.btn]:py-2 md:[&_.btn]:text-xs">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="btn text-xs py-2 justify-center shadow-none hover:bg-[#ECE8DF]"
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          <span>{expanded ? "Collapse" : "Expand"}</span>
        </button>
        <button
          onClick={() => setTick((t) => t + 1)}
          className="btn text-xs py-2 justify-center shadow-none hover:bg-[#ECE8DF]"
        >
          <RotateCw size={13} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Live frame or default activity preview */}
      <div className="flex-1 overflow-auto p-4">
        {frame ? (
          <div>
            <img
              src={frame.src}
              alt="Live browser view"
              className="w-full rounded-xl border border-[var(--border)] shadow-sm"
            />
            <div className="text-[11px] text-[var(--muted)] mt-2.5 truncate" title={frame.url || ""}>
              {frame.url || "(about:blank)"}
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">
              {stale ? "Last view" : "Live"} · captured {new Date(frame.capturedAt).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Context mock card matching wireframe */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
              <Image
                src="/elio-icon.png"
                alt="Elio"
                width={32}
                height={32}
                className="rounded-xl shrink-0 mt-0.5 shadow-2xs"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-[var(--text)]">about:sandbox</span>
                  <span className="text-[11px] text-[var(--muted)]">Ready</span>
                </div>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Interactive browser sandbox. When Elio performs research or navigates websites, real-time viewport frames stream here.
                </p>
              </div>
            </div>

            {active && (
              <div className="text-center p-4">
                <div className="text-xs text-[var(--accent)] flex items-center justify-center gap-1.5 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse"></span>
                  Browser agent active
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--border)] text-[10px] md:text-[11px] text-[var(--muted)] leading-relaxed">
        Sentinel-gated · form submissions require your approval · frames kept locally only
      </div>
    </aside>
  );
}
