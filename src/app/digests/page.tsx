"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sun,
  Calendar,
  CheckSquare,
  Clock,
  Settings as SettingsIcon,
  Play,
  CheckCircle2,
  BookOpen,
  Mail,
  Shield,
  Loader2,
  ChevronRight,
  Sparkles,
  ChevronLeft,
  X,
} from "lucide-react";
import { Markdown } from "@/app/markdown";

interface Digest {
  id: string;
  ts: number;
  kind: string;
  body: string;
  read: number;
  meta?: string;
}

interface Config {
  hour: number;
  enabled: boolean;
  emailEnabled: boolean;
}

export default function DigestsPage() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [unread, setUnread] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  // Mobile: history list vs. reading view (desktop shows all columns at once).
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [running, setRunning] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const [dRes, cRes] = await Promise.all([
        fetch("/api/digests").catch(() => null),
        fetch("/api/connectors").catch(() => null),
      ]);

      if (dRes && dRes.ok) {
        const data = await dRes.json();
        setDigests(data.digests || []);
        setConfig(data.config || null);
        setUnread(data.unread || 0);
        if (data.digests?.length && openId === null) {
          setOpenId(data.digests[0].id);
        }
      }

      if (cRes && cRes.ok) {
        const cData = await cRes.json();
        const grants = cData.grants || [];
        setGmailConnected(grants.some((g: { connector: string; status: string }) => g.connector === "gmail" && g.status === "connected"));
        setCalendarConnected(grants.some((g: { connector: string; status: string }) => g.connector === "gcal" && g.status === "connected"));
      }
    } catch (e) {
      console.error("Failed to load digests", e);
    }
  }, [openId]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    try {
      await fetch("/api/digests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markRead: id }),
      });
      load();
      showToast("Briefing marked as reviewed");
    } catch (e) {
      console.error("Failed to mark digest read", e);
    }
  }

  async function saveConfig(c: Partial<Config>) {
    try {
      await fetch("/api/digests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: c }),
      });
      load();
      showToast("Digest settings saved");
    } catch (e) {
      console.error("Failed to save config", e);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/digests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) {
        setOpenId(null);
        await load();
        showToast("Fresh morning briefing generated");
      } else {
        showToast("Unable to generate briefing. Ensure LLM is configured in .env");
      }
    } catch (e) {
      showToast("Failed to generate briefing");
    } finally {
      setRunning(false);
    }
  }

  const currentDigest = digests.find((d) => d.id === openId) || digests[0] || null;

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans relative">
      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-4 right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="h-14 border-b border-[var(--border)] px-4 md:px-8 flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-3">
          <Sun size={18} className="text-[var(--accent)]" />
          <span className="font-editorial text-lg font-semibold text-[var(--text)]">
            Daily Briefings
          </span>
          {unread > 0 && (
            <span className="chip chip-action text-[10px]">{unread} unread</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-2 rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            title="Configure schedule"
          >
            <SettingsIcon size={15} />
          </button>
          <button
            onClick={runNow}
            disabled={running}
            className="btn-moss px-3.5 py-1.5 text-xs font-medium rounded-xl flex items-center gap-1.5 disabled:opacity-50"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            <span>{running ? "Synthesizing..." : "Generate briefing now"}</span>
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Archived Briefings List */}
        <aside
          className={`${mobileView === "detail" ? "hidden md:block" : "block"
            } w-full md:w-[280px] shrink-0 md:border-r border-[var(--border)] bg-[var(--bg)] p-4 overflow-y-auto`}
        >
          <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-3 px-2">
            Briefing History
          </div>

          {digests.length === 0 ? (
            <div className="p-4 text-center text-xs text-[var(--muted)] italic">
              No historical briefings yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {digests.map((d) => {
                const isSelected = (currentDigest?.id === d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => { setOpenId(d.id); setMobileView("detail"); }}
                    className={`w-full text-left p-3 rounded-xl transition-all border ${
                      isSelected
                        ? "bg-[var(--panel)] border-[var(--accent)] shadow-xs"
                        : "border-transparent hover:bg-[#F2EFE9]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[var(--text)]">
                        {new Date(d.ts).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-full font-medium ${
                          d.read ? "text-[var(--muted)]" : "chip-action"
                        }`}
                      >
                        {d.read ? "Reviewed" : "New"}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--muted)] flex items-center gap-1">
                      <Clock size={11} />
                      <span>{new Date(d.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Central Briefing Content Area */}
        <main
          className={`${mobileView === "list" && digests.length > 0 ? "hidden md:block" : "block"
            } flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-8 bg-[var(--bg)]`}
        >
          {currentDigest ? (
            <div className="max-w-2xl mx-auto pb-16">
              <button
                onClick={() => setMobileView("list")}
                className="md:hidden flex items-center gap-1 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] mb-4 -ml-1 p-2"
              >
                <ChevronLeft size={16} />
                All briefings
              </button>
              <div className="flex items-start justify-between pb-6 mb-6 border-b border-[var(--border)]">
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--muted)] mb-1">
                    Morning Synthesis
                  </div>
                  <h1 className="font-editorial text-2xl md:text-3xl font-bold text-[var(--text)]">
                    {new Date(currentDigest.ts).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </h1>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Generated at {new Date(currentDigest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>

                {!currentDigest.read && (
                  <button
                    onClick={() => markRead(currentDigest.id)}
                    className="btn btn-primary py-2 px-4 text-xs font-medium"
                  >
                    Mark as reviewed
                  </button>
                )}
              </div>

              {/* Briefing Body with Markdown View */}
              <div className="prose-editorial text-sm leading-relaxed text-[var(--text)]">
                <Markdown text={currentDigest.body} />
              </div>
            </div>
          ) : (
            <div className="max-w-md mx-auto py-20 text-center">
              <div className="w-14 h-14 rounded-full bg-[#EBF0EB] text-[var(--accent)] flex items-center justify-center mx-auto mb-5">
                <Sun className="w-7 h-7" />
              </div>
              <h2 className="font-editorial text-2xl font-bold text-[var(--text)] mb-3">
                Your morning briefing
              </h2>
              <p className="text-xs text-[var(--muted)] leading-relaxed mb-6">
                Elio synthesizes your connected Gmail threads, Google Calendar events, and ongoing background tasks into a concise daily briefing.
              </p>
              <button
                onClick={runNow}
                disabled={running}
                className="btn-moss px-5 py-2.5 text-xs font-medium rounded-xl inline-flex items-center gap-2 shadow-sm"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                <span>{running ? "Synthesizing briefing..." : "Generate first briefing now"}</span>
              </button>
            </div>
          )}
        </main>

        {/* Right Info & Schedule Panel */}
        <aside
          className={`${showConfig
            ? "fixed inset-0 z-[70] flex md:z-auto"
            : "hidden md:flex"
            } w-full md:w-[320px] md:static md:shrink-0 border-l border-[var(--border)] bg-[var(--bg)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex-col justify-between overflow-y-auto`}
        >
          <button
            onClick={() => setShowConfig(false)}
            className="absolute top-4 right-4 w-11 h-11 flex md:hidden items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--panel)]"
            aria-label="Close settings"
          >
            <X size={22} />
          </button>
          <div>
            <div className="mb-6">
              <h3 className="font-editorial text-lg font-semibold text-[var(--text)]">
                Briefing inputs
              </h3>
              <p className="text-xs text-[var(--muted)]">Active context sources.</p>
            </div>

            <div className="space-y-3 mb-8 text-xs">
              <div className="panel p-3.5 bg-[var(--panel)] border border-[var(--border)] rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Calendar size={16} className="text-[#4285F4]" />
                  <span className="font-medium text-[var(--text)]">Google Calendar</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${calendarConnected ? "chip-moss" : "chip-muted"}`}>
                  {calendarConnected ? "Connected" : "Disconnected"}
                </span>
              </div>

              <div className="panel p-3.5 bg-[var(--panel)] border border-[var(--border)] rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Mail size={16} className="text-[#EA4335]" />
                  <span className="font-medium text-[var(--text)]">Gmail Inbox</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${gmailConnected ? "chip-moss" : "chip-muted"}`}>
                  {gmailConnected ? "Connected" : "Disconnected"}
                </span>
              </div>

              <div className="panel p-3.5 bg-[var(--panel)] border border-[var(--border)] rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckSquare size={16} className="text-[var(--accent)]" />
                  <span className="font-medium text-[var(--text)]">Active Tasks</span>
                </div>
                <span className="chip chip-moss text-[10px]">Active</span>
              </div>
            </div>

            {/* Schedule Section */}
            <div className="border-t border-[var(--border)] pt-6">
              <h4 className="font-editorial text-sm font-semibold text-[var(--text)] mb-3">
                Schedule & Delivery
              </h4>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Daily Briefing</span>
                  <input
                    type="checkbox"
                    checked={config?.enabled ?? true}
                    onChange={(e) => saveConfig({ enabled: e.target.checked })}
                    className="accent-[var(--accent)] cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Generation Hour</span>
                  <select
                    value={config?.hour ?? 8}
                    onChange={(e) => saveConfig({ hour: Number(e.target.value) })}
                    className="bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text)]"
                  >
                    <option value={6}>6:00 AM</option>
                    <option value={7}>7:00 AM</option>
                    <option value={8}>8:00 AM</option>
                    <option value={9}>9:00 AM</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Forward via Email</span>
                  <input
                    type="checkbox"
                    checked={config?.emailEnabled ?? false}
                    onChange={(e) => saveConfig({ emailEnabled: e.target.checked })}
                    disabled={!gmailConnected}
                    className="accent-[var(--accent)] cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="panel p-4 bg-[var(--panel)] rounded-xl border border-[var(--border)] text-xs text-[var(--muted)] italic">
            "Elio prepares your day with calm clarity, summarizing what matters most before you begin."
          </div>
        </aside>
      </div>
    </div>
  );
}
