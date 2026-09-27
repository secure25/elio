"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  Search,
  MoreVertical,
  Edit2,
  Copy,
  ExternalLink,
  Shield,
  FileText,
  Mail,
  Plane,
  X,
} from "lucide-react";

interface Approval {
  id: string;
  task_id: string | null;
  conversation_id: string | null;
  action: string;
  detail: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "declined" | "expired";
  created_at: number;
  resolved_at: number | null;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingApproval, setEditingApproval] = useState<Approval | null>(null);
  const [draftText, setDraftText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [expandedPolicy, setExpandedPolicy] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved">("pending");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals");
      if (!res.ok) return;
      const data = await res.json();
      setApprovals(data.approvals || []);
    } catch (e) {
      console.error("Failed to load approvals", e);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, [load]);

  async function resolve(id: string, approve: boolean) {
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: id, approve }),
      });
      if (res.ok) {
        showToast(approve ? "Action approved and dispatched to executor" : "Action declined");
        load();
      }
    } catch (e) {
      console.error("Failed to resolve approval", e);
    }
  }

  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const resolvedApprovals = approvals.filter((a) => a.status !== "pending");

  const filteredApprovals = approvals.filter((item) => {
    if (statusFilter === "pending" && item.status !== "pending") return false;
    if (statusFilter === "resolved" && item.status === "pending") return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.action.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q) ||
      item.risk.toLowerCase().includes(q)
    );
  });

  const getRiskChipClass = (risk: string) => {
    if (risk === "low") return "chip-moss";
    if (risk === "medium") return "chip-warn";
    return "chip-terracotta";
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans relative">
      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-4 right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Edit Proposal Modal */}
      {editingApproval && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setEditingApproval(null)}
              className="absolute top-4 right-4 p-1 rounded-full text-[var(--muted)] hover:text-[var(--text)]"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--action)]" />
              <span>Edit Proposal Draft</span>
            </div>
            <h3 className="font-editorial text-2xl font-bold text-[var(--text)] mb-2">
              {editingApproval.action}
            </h3>
            <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">
              Modify the proposed execution payload before confirming Sentinel release.
            </p>

            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={5}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono leading-relaxed resize-none mb-4"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingApproval(null)}
                className="btn btn-secondary py-2 px-4 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  showToast("Draft modifications updated");
                  setEditingApproval(null);
                }}
                className="btn-moss py-2 px-4 text-xs font-medium rounded-lg"
              >
                Save Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="h-14 border-b border-[var(--border)] px-4 md:px-8 flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-3 w-80">
          <Search size={15} className="text-[var(--muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search proposals, risks, or actions..."
            className="w-full bg-transparent text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-xs text-[var(--muted)]">
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div
            onClick={() => showToast("Elio Sentinel active")}
            className="flex items-center gap-2 pl-2 border-l border-[var(--border)] cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[#3D4C3C] text-white text-xs font-medium flex items-center justify-center">
              OM
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-medium text-[var(--text)] leading-tight">Sentinel</div>
              <div className="text-[10px] text-[var(--muted)] leading-tight">Policy guard</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Central Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-6 md:pb-6">
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-editorial font-medium text-[var(--text)] mb-1">
              Decisions held for you
            </h1>
            <p className="text-xs text-[var(--muted)]">
              Sentinel holds high-impact external actions until you confirm.
            </p>
          </div>

          {/* Filter Pills & Summary Counter */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStatusFilter("pending")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter === "pending"
                    ? "bg-[#435242] text-white"
                    : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <span>Pending</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    statusFilter === "pending" ? "bg-white/20 text-white" : "text-[var(--muted)]"
                  }`}
                >
                  {pendingApprovals.length}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter === "all"
                    ? "bg-[#435242] text-white"
                    : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <span>All Decisions</span>
                <span className="text-[10px] text-[var(--muted)]">{approvals.length}</span>
              </button>

              <button
                onClick={() => setStatusFilter("resolved")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter === "resolved"
                    ? "bg-[#435242] text-white"
                    : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <span>Resolved History</span>
                <span className="text-[10px] text-[var(--muted)]">{resolvedApprovals.length}</span>
              </button>
            </div>
          </div>

          {/* Empty State */}
          {filteredApprovals.length === 0 && (
            <div className="py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-[#EBF0EB] text-[var(--accent)] flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="font-editorial text-xl font-medium text-[var(--text)] mb-2">
                All caught up
              </h3>
              <p className="text-xs text-[var(--muted)] max-w-sm mx-auto leading-relaxed">
                {searchQuery
                  ? "No approval proposals match your search."
                  : "No decisions are currently held for approval. When Elio prepares to send outbound emails or alter sensitive external records, Sentinel will intercept them here."}
              </p>
            </div>
          )}

          {/* Approval Cards List */}
          <div className="space-y-4 max-w-3xl pb-16">
            {filteredApprovals.map((a) => {
              const isResolved = a.status !== "pending";
              return (
                <div
                  key={a.id}
                  className={`panel p-5 bg-[var(--panel)] border-[var(--border)] shadow-sm rounded-xl transition-all ${
                    isResolved ? "opacity-60 bg-[#F4F1EA]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-[#E8DDD5] text-[#634538] flex items-center justify-center shrink-0">
                        <ShieldCheck size={19} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text)]">{a.action}</h3>
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          Agent Action · Task {a.task_id || "Direct"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getRiskChipClass(a.risk)}`}>
                          {a.risk} Risk
                        </span>
                        <div className="text-[11px] text-[var(--muted)] mt-1">
                          {new Date(a.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>

                      <div className="relative">
                        <button
                          onClick={() => setActiveMenuId(activeMenuId === a.id ? null : a.id)}
                          className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                        >
                          <MoreVertical size={15} />
                        </button>

                        {activeMenuId === a.id && (
                          <div className="absolute right-0 top-6 w-36 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl z-20 py-1 text-xs">
                            <button
                              onClick={() => {
                                setEditingApproval(a);
                                setDraftText(a.detail);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#F2EFE9] flex items-center gap-2"
                            >
                              <Edit2 size={12} />
                              <span>Inspect draft</span>
                            </button>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(a.detail);
                                showToast("Draft copied to clipboard");
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#F2EFE9] flex items-center gap-2"
                            >
                              <Copy size={12} />
                              <span>Copy details</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Rationale block */}
                  <div className="mb-4 pl-13">
                    <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase mb-1">
                      Rationale & Details
                    </div>
                    <p className="text-xs text-[var(--text)] leading-relaxed">{a.detail}</p>
                  </div>

                  {/* Decision buttons or resolved status */}
                  <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
                    <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                      <Clock size={13} />
                      <span>{new Date(a.created_at).toLocaleDateString()}</span>
                    </div>

                    {!isResolved ? (
                      <div className="flex gap-2.5">
                        <button
                          onClick={() => resolve(a.id, false)}
                          className="btn btn-deny text-xs py-1.5 px-4 font-medium"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => resolve(a.id, true)}
                          className="btn btn-approve text-xs py-1.5 px-4 font-medium"
                        >
                          Approve
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs font-medium">
                        {a.status === "approved" ? (
                          <span className="text-[var(--ok)] flex items-center gap-1">
                            <CheckCircle2 size={14} /> Approved
                          </span>
                        ) : (
                          <span className="text-[var(--action)] flex items-center gap-1">
                            <XCircle size={14} /> Declined
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Info Panel — mobile: stacked below the list */}
        <aside className="w-full md:w-[340px] shrink-0 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--bg)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto">
          <div className="mb-6">
            <h2 className="font-editorial text-xl font-semibold text-[var(--text)]">
              Sentinel policy
            </h2>
            <p className="text-xs text-[var(--muted)]">Supervised safety for autonomous agents.</p>
          </div>

          <div className="space-y-4 text-xs">
            <div className="panel p-4 bg-[var(--panel)] rounded-xl border border-[var(--border)]">
              <h4 className="font-semibold text-[var(--text)] mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
                <span>Tier 1: Low Risk</span>
              </h4>
              <p className="text-[var(--muted)] text-[11px] leading-relaxed">
                Read operations, local calendar checks, and draft preparation. Allowed autonomously with cryptographic logging.
              </p>
            </div>

            <div className="panel p-4 bg-[var(--panel)] rounded-xl border border-[var(--border)]">
              <h4 className="font-semibold text-[var(--text)] mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--warn)]" />
                <span>Tier 2: Medium Risk</span>
              </h4>
              <p className="text-[var(--muted)] text-[11px] leading-relaxed">
                Outbound messages, calendar edits, and non-destructive external API updates. Requires single-click approval.
              </p>
            </div>

            <div className="panel p-4 bg-[var(--panel)] rounded-xl border border-[var(--border)]">
              <h4 className="font-semibold text-[var(--text)] mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--action)]" />
                <span>Tier 3: High Risk</span>
              </h4>
              <p className="text-[var(--muted)] text-[11px] leading-relaxed">
                Financial transactions, credential changes, and external data deletion. Held until confirmed with detailed audit rationale.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
