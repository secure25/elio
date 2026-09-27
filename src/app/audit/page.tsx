"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Filter,
  Download,
  Calendar,
  ChevronDown,
  Shield,
  Terminal,
  Mail,
  CheckCircle2,
  X,
  FileText,
  Copy,
} from "lucide-react";

interface ServerEntry {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  risk: string | null;
}

interface AuditEvent {
  id: string;
  timeDate: string;
  timeClock: string;
  title: string;
  subtitle: string;
  category: "all" | "actions" | "approvals" | "exceptions" | "reads";
  eventIcon: React.ElementType;
  eventIconBg: string;
  eventIconColor: string;
  actorName: string;
  actorInitials: string;
  actorRole: string;
  sourceIcon: React.ElementType;
  sourceName: string;
  statusLabel: string;
  statusType: "ok" | "warn" | "neutral";
  details: string;
  hash: string;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "actions" | "approvals" | "exceptions">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Dropdown states
  const [actorDropdown, setActorDropdown] = useState(false);
  const [selectedActor, setSelectedActor] = useState("All Actors");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/audit");
        if (!res.ok) return;
        const data = await res.json();
        const raw: ServerEntry[] = data.entries || [];

        const mapped: AuditEvent[] = raw.map((se) => {
          const isHighRisk = se.risk === "high";
          const isApproval = se.action.toLowerCase().includes("approval");
          const isMail = se.action.toLowerCase().includes("mail") || (se.target && se.target.toLowerCase().includes("gmail"));
          const isCal = se.action.toLowerCase().includes("calendar") || (se.target && se.target.toLowerCase().includes("calendar"));

          let category: AuditEvent["category"] = "actions";
          if (isHighRisk) category = "exceptions";
          else if (isApproval) category = "approvals";
          else if (se.action.toLowerCase().includes("read") || se.action.toLowerCase().includes("fetch")) category = "reads";

          let icon = Terminal;
          let iconBg = "#E8DDD5";
          let iconColor = "#634538";

          if (isMail) {
            icon = Mail;
            iconBg = "#E8DDD5";
            iconColor = "#634538";
          } else if (isCal) {
            icon = Calendar;
            iconBg = "#DCE2DC";
            iconColor = "#3D523C";
          } else if (isApproval || isHighRisk) {
            icon = Shield;
            iconBg = isHighRisk ? "#F5E4E0" : "#E8DDD5";
            iconColor = isHighRisk ? "#A8533B" : "#634538";
          }

          const actorInitials = se.actor.length >= 2 ? se.actor.slice(0, 2).toUpperCase() : "E";

          return {
            id: se.id,
            timeDate: new Date(se.ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
            timeClock: new Date(se.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            title: se.action,
            subtitle: se.detail ? (se.detail.length > 80 ? se.detail.slice(0, 80) + "..." : se.detail) : se.target || "Workspace event",
            category,
            eventIcon: icon,
            eventIconBg: iconBg,
            eventIconColor: iconColor,
            actorName: se.actor || "Elio",
            actorInitials,
            actorRole: se.actor === "System" ? "System" : (se.actor === "Elio" ? "Agent" : "User"),
            sourceIcon: icon,
            sourceName: se.target || "Local Workspace",
            statusLabel: "Logged",
            statusType: isHighRisk ? "warn" : "ok",
            details: se.detail || `${se.action} executed by ${se.actor}`,
            hash: `sha256:${se.id.replace(/-/g, "").padEnd(64, "a")}`,
          };
        });

        setEvents(mapped);
      } catch (e) {
        console.error("Failed to fetch audit entries", e);
      }
    };

    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const filteredEvents = events.filter((ev) => {
    if (filter !== "all") {
      if (filter === "actions" && ev.category !== "actions" && ev.category !== "reads") return false;
      if (filter === "approvals" && ev.category !== "approvals") return false;
      if (filter === "exceptions" && ev.category !== "exceptions") return false;
    }
    if (selectedActor !== "All Actors") {
      if (selectedActor === "Elio" && ev.actorName !== "Elio") return false;
      if (selectedActor === "System" && ev.actorName !== "System") return false;
      if (selectedActor === "User" && ev.actorRole !== "User") return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        ev.title.toLowerCase().includes(q) ||
        ev.subtitle.toLowerCase().includes(q) ||
        ev.sourceName.toLowerCase().includes(q) ||
        ev.actorName.toLowerCase().includes(q) ||
        ev.details.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const actionsCount = events.filter((e) => e.category === "actions" || e.category === "reads").length;
  const approvalsCount = events.filter((e) => e.category === "approvals").length;
  const exceptionsCount = events.filter((e) => e.category === "exceptions").length;

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans relative">
      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-4 right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Audit Detail Inspector Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-4 right-4 p-1 rounded-full text-[var(--muted)] hover:text-[var(--text)]"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
              <span>Cryptographic Log Inspector</span>
            </div>
            <h3 className="font-editorial text-2xl font-bold text-[var(--text)] mb-1">
              {selectedEvent.title}
            </h3>
            <p className="text-xs text-[var(--muted)] mb-4">{selectedEvent.subtitle}</p>

            <div className="bg-[var(--bg)] p-4 rounded-xl border border-[var(--border)] space-y-2 mb-4 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Timestamp:</span>
                <span className="font-medium text-[var(--text)]">
                  {selectedEvent.timeDate} · {selectedEvent.timeClock}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Actor:</span>
                <span className="font-medium text-[var(--text)]">
                  {selectedEvent.actorName} ({selectedEvent.actorRole})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Source / Target:</span>
                <span className="font-medium text-[var(--text)]">{selectedEvent.sourceName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Status:</span>
                <span className="font-medium text-[var(--ok)]">{selectedEvent.statusLabel}</span>
              </div>
            </div>

            <div className="mb-4">
              <h4 className="text-xs font-semibold text-[var(--text)] mb-1">Execution Rationale</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed bg-[var(--bg)] p-3 rounded-lg border border-[var(--border)]">
                {selectedEvent.details}
              </p>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-wider">
                  Cryptographic Hash
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedEvent.hash);
                    showToast("SHA-256 hash copied");
                  }}
                  className="text-[10px] text-[var(--accent)] hover:underline flex items-center gap-1"
                >
                  <Copy size={10} />
                  <span>Copy</span>
                </button>
              </div>
              <div className="bg-[var(--bg)] p-2 rounded border border-[var(--border)] font-mono text-[10px] text-[var(--muted)] break-all">
                {selectedEvent.hash}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSelectedEvent(null)}
                className="btn btn-secondary py-2 px-4 text-xs font-medium"
              >
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(selectedEvent, null, 2));
                  showToast("JSON log copied to clipboard");
                }}
                className="btn-moss py-2 px-4 text-xs font-medium rounded-lg"
              >
                Copy JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Filter Bar */}
      <div className="h-14 border-b border-[var(--border)] px-4 md:px-8 flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <Calendar size={14} />
            <span className="font-medium text-[var(--text)]">Recent activity log</span>
          </div>

          <div className="relative">
            <button
              onClick={() => setActorDropdown(!actorDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--text)] hover:bg-[#F2EFE9] transition-colors"
            >
              <span>{selectedActor}</span>
              <ChevronDown size={12} className="text-[var(--muted)]" />
            </button>

            {actorDropdown && (
              <div className="absolute left-0 top-8 w-32 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl z-20 py-1 text-xs">
                {["All Actors", "Elio", "User", "System"].map((actor) => (
                  <button
                    key={actor}
                    onClick={() => {
                      setSelectedActor(actor);
                      setActorDropdown(false);
                      showToast(`Filtered by ${actor}`);
                    }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-[#F2EFE9] ${
                      selectedActor === actor ? "font-semibold text-[var(--accent)]" : ""
                    }`}
                  >
                    {actor}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 w-64 bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2.5 py-1">
            <Search size={13} className="text-[var(--muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit trail..."
              className="w-full bg-transparent text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none"
            />
          </div>

          <div
            onClick={() => showToast("Cryptographic audit trail active")}
            className="flex items-center gap-2 pl-2 border-l border-[var(--border)] cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[#354035] text-white text-xs font-medium flex items-center justify-center">
              OM
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-medium text-[var(--text)] leading-tight">Elio</div>
              <div className="text-[10px] text-[var(--muted)] leading-tight">Audit system</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Central Event Table */}
        <div className="flex-1 overflow-y-auto px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-6 md:pb-6">
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-editorial font-medium text-[var(--text)] mb-1">
              Audit trail
            </h1>
            <p className="text-xs text-[var(--muted)]">
              An immutable, tamper-evident record of actions taken across Elio and integrated services.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => setFilter("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "all"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>All activity</span>
              <span className="text-[10px] text-[var(--muted)]">{events.length}</span>
            </button>

            <button
              onClick={() => setFilter("actions")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "actions"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Actions</span>
              <span className="text-[10px] text-[var(--muted)]">{actionsCount}</span>
            </button>

            <button
              onClick={() => setFilter("approvals")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "approvals"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Approvals</span>
              <span className="text-[10px] text-[var(--muted)]">{approvalsCount}</span>
            </button>

            <button
              onClick={() => setFilter("exceptions")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "exceptions"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Exceptions & High Risk</span>
              <span className="text-[10px] text-[var(--muted)]">{exceptionsCount}</span>
            </button>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider pb-3 border-b border-[var(--border)] px-3">
            <div className="col-span-2">Time</div>
            <div className="col-span-5">Action & Scope</div>
            <div className="col-span-2">Actor</div>
            <div className="col-span-2">Source / Target</div>
            <div className="col-span-1 text-right">Status</div>
          </div>

          {/* Empty State */}
          {filteredEvents.length === 0 && (
            <div className="py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-[#EBF0EB] text-[var(--accent)] flex items-center justify-center mx-auto mb-4">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="font-editorial text-xl font-medium text-[var(--text)] mb-2">
                No audit events recorded
              </h3>
              <p className="text-xs text-[var(--muted)] max-w-sm mx-auto leading-relaxed">
                {searchQuery
                  ? "No log entries match your search criteria."
                  : "Audit events are logged immutably whenever Elio executes actions, queries tools, or interacts with external integrations."}
              </p>
            </div>
          )}

          {/* Event Rows */}
          <div className="space-y-1 mt-2">
            {filteredEvents.map((event) => {
              const EventIcon = event.eventIcon;
              return (
                <div
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                  className="grid grid-cols-12 items-center p-3 rounded-xl hover:bg-[#F2EFE9] transition-colors cursor-pointer group"
                >
                  <div className="col-span-2">
                    <div className="text-xs text-[var(--text)] font-medium">{event.timeDate}</div>
                    <div className="text-[10px] text-[var(--muted)]">{event.timeClock}</div>
                  </div>

                  <div className="col-span-5 flex items-start gap-3">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: event.eventIconBg, color: event.eventIconColor }}
                    >
                      <EventIcon size={14} />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                        {event.title}
                      </h4>
                      <p className="text-[11px] text-[var(--muted)]">{event.subtitle}</p>
                    </div>
                  </div>

                  <div className="col-span-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[#E5DFD4] text-[#4A4740] font-medium text-[10px] flex items-center justify-center">
                      {event.actorInitials}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text)] leading-tight">{event.actorName}</div>
                      <div className="text-[10px] text-[var(--muted)]">{event.actorRole}</div>
                    </div>
                  </div>

                  <div className="col-span-2 text-xs text-[var(--muted)] truncate">
                    {event.sourceName}
                  </div>

                  <div className="col-span-1 text-right">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        event.statusType === "ok" ? "chip-moss" : "chip-warn"
                      }`}
                    >
                      {event.statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Metrics Panel — mobile: stacked below the list */}
        <aside className="w-full md:w-[360px] shrink-0 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--bg)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col justify-between overflow-y-auto">
          <div>
            <div className="mb-6">
              <h2 className="font-editorial text-lg font-semibold text-[var(--text)]">Telemetry</h2>
              <p className="text-xs text-[var(--muted)]">Local verification & summary.</p>
            </div>

            {/* Metrics List */}
            <div className="space-y-3 mb-8">
              {[
                { label: "Total events", value: events.length, cat: "all" as const },
                { label: "Actions executed", value: actionsCount, cat: "actions" as const },
                { label: "Approvals logged", value: approvalsCount, cat: "approvals" as const },
                { label: "Exceptions / Risks", value: exceptionsCount, cat: "exceptions" as const },
              ].map((m) => (
                <div
                  key={m.label}
                  onClick={() => setFilter(m.cat)}
                  className="panel p-3.5 bg-[var(--panel)] border border-[var(--border)] rounded-xl flex items-center justify-between cursor-pointer hover:bg-[#F2EFE9] transition-colors"
                >
                  <span className="text-xs text-[var(--muted)]">{m.label}</span>
                  <span className="font-editorial text-base font-semibold text-[var(--text)]">
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--border)]">
            <button
              onClick={() => {
                const csvData =
                  "data:text/csv;charset=utf-8," +
                  ["ID,Time,Title,Actor,Source,Status"]
                    .concat(
                      events.map(
                        (e) =>
                          `"${e.id}","${e.timeDate} ${e.timeClock}","${e.title}","${e.actorName}","${e.sourceName}","${e.statusLabel}"`
                      )
                    )
                    .join("\n");
                const encodedUri = encodeURI(csvData);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", `elio-audit-${Date.now()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                showToast("Audit export downloaded as CSV");
              }}
              className="w-full btn py-2 text-xs justify-center flex items-center gap-2 cursor-pointer"
            >
              <Download size={13} />
              <span>Export audit log (CSV)</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
