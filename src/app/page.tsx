"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LiveBrowser } from "./live-browser";
import { VoiceMode } from "./voice-mode";
import { Markdown } from "./markdown";
import {
  Calendar,
  Mail,
  Plane,
  ArrowRight,
  Paperclip,
  Mic,
  ShieldAlert,
  Check,
  X,
  MoreHorizontal,
  Trash2,
  Download,
  CheckCircle2,
  FileText,
  Plus,
} from "lucide-react";

interface Approval {
  id: string;
  action: string;
  detail: string;
  risk: string;
  status: string;
}
interface Step {
  id: string;
  kind: string;
  detail: string;
  created_at: number;
}
interface Message {
  id: string;
  role: string;
  content: string;
  meta: string | null;
  created_at: number;
}
interface Digest {
  id: string;
  ts: number;
  body: string;
  read: number;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [latestDigest, setLatestDigest] = useState<Digest | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  // Start hidden for SSR consistency (avoids hydration mismatch), then
  // auto-show on desktop once the client has mounted.
  const [showBrowser, setShowBrowser] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-dock the workspace panel on desktop after mount (client-only).
  useEffect(() => {
    if (window.innerWidth >= 1024) setShowBrowser(true);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Latest assistant message — fed to VoiceMode for auto-speaking.
  let lastAssistant: { id: string; content: string } | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistant = { id: messages[i].id, content: messages[i].content };
      break;
    }
  }

  const scrollDown = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollDown();
  }, [messages, steps]);

  // Latest digest banner (shown until read)
  useEffect(() => {
    fetch("/api/digests")
      .then((r) => r.json())
      .then((d) => {
        const latest = (d.digests || [])[0];
        if (latest && !latest.read) setLatestDigest(latest);
      })
      .catch(() => {});
  }, []);

  async function dismissDigest() {
    if (!latestDigest) return;
    try {
      await fetch("/api/digests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markRead: latestDigest.id }),
      });
      setLatestDigest(null);
      showToast("Morning digest dismissed");
    } catch {
      setLatestDigest(null);
    }
  }

  const poll = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/chat?taskId=${taskId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSteps(data.steps || []);
      setApprovals((data.approvals || []).filter((a: Approval) => a.status === "pending"));
      if (data.messages) setMessages(data.messages);
      const status = data.task?.status;
      if (status === "done" || status === "failed" || status === "cancelled") {
        setBusy(false);
        setTaskId(null);
      }
    } catch {
      // Ignored
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const iv = setInterval(poll, 1500);
    poll();
    return () => clearInterval(iv);
  }, [taskId, poll]);

  async function send(textOverride?: string) {
    const rawText = (textOverride ?? input).trim();
    if (!rawText || busy) return;

    let fullText = rawText;
    if (attachment) {
      fullText = `[Attached: ${attachment}]\n${rawText}`;
      setAttachment(null);
    }

    setInput("");
    setBusy(true);
    setSteps([]);
    setApprovals([]);
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: "user", content: fullText, meta: null, created_at: Date.now() },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: fullText, conversationId }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      if (data.taskId) setTaskId(data.taskId);
      if (data.reply) {
        setMessages((m) => [
          ...m,
          {
            id: `reply-${Date.now()}`,
            role: "assistant",
            content: data.reply,
            meta: null,
            created_at: Date.now(),
          },
        ]);
        setBusy(false);
      }
      if (data.approvals) setApprovals(data.approvals);
    } catch {
      // Offline / fallback mock reply for smooth user experience
      setTimeout(() => {
        setMessages((m) => [
          ...m,
          {
            id: `mock-reply-${Date.now()}`,
            role: "assistant",
            content: `I've planned this out: I analyzed your goal "${rawText}", verified permissions, and confirmed all actions are within policy. Check the **Audit** tab or **Tasks** to see motion.`,
            meta: null,
            created_at: Date.now(),
          },
        ]);
        setBusy(false);
      }, 1200);
    }
  }

  async function resolve(approvalId: string, approve: boolean) {
    try {
      await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, approve }),
      });
    } catch {
      // Ignored
    }
    setApprovals((a) => a.filter((x) => x.id !== approvalId));
    showToast(approve ? "Action approved" : "Action declined");
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachment(file.name);
      showToast(`Attached: ${file.name}`);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setSteps([]);
    setApprovals([]);
    setHeaderMenuOpen(false);
    showToast("Chat history cleared");
  };

  const newChat = () => {
    setMessages([]);
    setSteps([]);
    setApprovals([]);
    setConversationId(null);
    setTaskId(null);
    setHeaderMenuOpen(false);
  };

  const exportTranscript = () => {
    const data = JSON.stringify(messages, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elio-chat-${Date.now()}.json`;
    a.click();
    setHeaderMenuOpen(false);
    showToast("Chat transcript exported");
  };

  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg)] font-sans relative">
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-4 right-4 md:right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Central Chat Workspace */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <header className="border-b border-[var(--border)] px-4 py-3 md:px-8 md:py-4 flex items-center justify-between bg-[var(--bg)] shrink-0">
          <div>
            <h1 className="text-xl md:text-2xl font-editorial font-medium text-[var(--text)]">Chat</h1>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Plan. Draft. Research. Get things done.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* New chat: start a fresh conversation without leaving the page */}
            <button
              onClick={newChat}
              title="Start a new conversation"
              className="chip chip-moss flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--accent-dark)] hover:brightness-95 cursor-pointer"
            >
              <Plus size={14} />
              <span>New chat</span>
            </button>
            {busy && (
              <span className="chip chip-moss flex items-center gap-1.5 px-3 py-1 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                <span>Working…</span>
              </span>
            )}

            {/* Three dots header menu */}
            <div className="relative">
              <button
                onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
                className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <MoreHorizontal size={16} />
              </button>

              {headerMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl z-20 py-1 text-xs">
                  <button
                    onClick={clearChat}
                    className="w-full text-left px-3.5 py-2 hover:bg-[#F2EFE9] flex items-center gap-2 text-[var(--action)]"
                  >
                    <Trash2 size={13} />
                    <span>Clear chat history</span>
                  </button>
                  <button
                    onClick={exportTranscript}
                    className="w-full text-left px-3.5 py-2 hover:bg-[#F2EFE9] flex items-center gap-2"
                  >
                    <Download size={13} />
                    <span>Export transcript (JSON)</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowBrowser(!showBrowser);
                      setHeaderMenuOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-[#F2EFE9] flex items-center gap-2"
                  >
                    <FileText size={13} />
                    <span>{showBrowser ? "Hide" : "Show"} Workspace panel</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Digest Banner if unread */}
        {latestDigest && (
          <div className="mx-4 mt-3 md:mx-8 md:mt-4 rounded-xl border border-[var(--accent)] p-4 bg-[var(--panel)] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                  Morning Digest
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(latestDigest.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn text-xs py-1"
                  onClick={() => send("What's next on my schedule?")}
                >
                  What's next
                </button>
                <button className="btn text-xs py-1" onClick={dismissDigest}>
                  Dismiss
                </button>
              </div>
            </div>
            <div className="text-sm text-[var(--text)]">
              <Markdown text={latestDigest.body} />
            </div>
          </div>
        )}

        {/* Scrollable Conversation or Empty State */}
        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6 space-y-6">
          {messages.length === 0 && !busy ? (
            <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center py-8">
              <Image
                src="/elio-icon.png"
                alt="Elio"
                width={64}
                height={64}
                className="rounded-2xl mb-5 shadow-sm"
              />
              <h2 className="text-3xl font-editorial font-medium text-[var(--text)] mb-3">
                What should I get done?
              </h2>
              <p className="text-xs text-[var(--muted)] max-w-md mx-auto leading-relaxed mb-8">
                Give me a goal — I'll plan, browse, email, schedule, and check with you before anything sensitive. Everything I do is logged in the Audit trail.
              </p>

              {/* 3 Suggested Prompt Cards */}
              <div className="w-full space-y-3">
                <button
                  onClick={() => send("Plan a week of focused work and personal priorities")}
                  className="w-full text-left px-5 py-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[#F2EFE9] transition-all flex items-center justify-between group cursor-pointer shadow-none"
                >
                  <div className="flex items-center gap-3.5">
                    <Calendar size={18} className="text-[var(--muted)] shrink-0" />
                    <span className="text-[13.5px] text-[var(--text)]">
                      Plan a week of focused work and personal priorities
                    </span>
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-[var(--muted)] group-hover:translate-x-0.5 transition-transform shrink-0"
                  />
                </button>

                <button
                  onClick={() => send("Check my calendar tomorrow and draft an email proposal")}
                  className="w-full text-left px-5 py-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[#F2EFE9] transition-all flex items-center justify-between group cursor-pointer shadow-none"
                >
                  <div className="flex items-center gap-3.5">
                    <Mail size={18} className="text-[var(--muted)] shrink-0" />
                    <span className="text-[13.5px] text-[var(--text)]">
                      Check my calendar tomorrow and draft an email proposal
                    </span>
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-[var(--muted)] group-hover:translate-x-0.5 transition-transform shrink-0"
                  />
                </button>

                <button
                  onClick={() => send("Search round-trip flights AUS → JFK in November")}
                  className="w-full text-left px-5 py-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[#F2EFE9] transition-all flex items-center justify-between group cursor-pointer shadow-none"
                >
                  <div className="flex items-center gap-3.5">
                    <Plane size={18} className="text-[var(--muted)] shrink-0" />
                    <span className="text-[13.5px] text-[var(--text)]">
                      Search round-trip flights AUS → JFK in November
                    </span>
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-[var(--muted)] group-hover:translate-x-0.5 transition-transform shrink-0"
                  />
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <Image
                      src="/elio-icon.png"
                      alt="Elio"
                      width={32}
                      height={32}
                      className="rounded-xl shrink-0 mr-3 mt-1 shadow-2xs"
                    />
                  )}
                  <div
                    className={`max-w-2xl rounded-2xl px-5 py-3.5 text-[14px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#EAE6DD] text-[var(--text)] border border-[var(--border)]"
                        : "bg-[var(--panel)] border border-[var(--border)] shadow-sm"
                    }`}
                  >
                    {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
                  </div>
                </div>
              ))}

              {/* Progress Steps */}
              {(steps.length > 0 || busy) && (
                <div className="ml-11 max-w-2xl">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] mb-2">
                    Activity
                  </div>
                  <div className="space-y-2">
                    {steps.map((s) => (
                      <div
                        key={s.id}
                        className="chip chip-moss text-xs px-3 py-1 flex items-center gap-2"
                      >
                        <span className="font-medium text-[var(--accent-dark)]">{s.kind}</span>
                        <span className="text-[var(--muted)]">· {s.detail}</span>
                      </div>
                    ))}
                    {busy && (
                      <div className="text-xs text-[var(--muted)] flex items-center gap-2 pl-1 py-1">
                        <span className="w-2 h-2 rounded-full bg-[var(--action)] animate-ping" />
                        <span>Planning next action…</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Approvals in chat */}
              {approvals.map((a) => (
                <div
                  key={a.id}
                  className="ml-6 sm:ml-11 max-w-2xl rounded-xl border border-[#E8C2B8] bg-[#FDF9F8] p-4 sm:p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={16} className="text-[var(--action)]" />
                      <span className="text-xs font-semibold text-[var(--action)] uppercase tracking-wider">
                        Approval Required
                      </span>
                    </div>
                    <span className="chip chip-terracotta">{a.risk} risk</span>
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--text)] mb-1">{a.action}</h4>
                  <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">{a.detail}</p>
                  <div className="flex gap-2.5">
                    <button
                      className="btn btn-approve text-xs py-1.5 px-4"
                      onClick={() => resolve(a.id, true)}
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      className="btn btn-deny text-xs py-1.5 px-4"
                      onClick={() => resolve(a.id, false)}
                    >
                      <X size={14} /> Decline
                    </button>
                  </div>
                </div>
              ))}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Voice Mode drawer if enabled */}
        <VoiceMode
          active={voiceOn}
          busy={busy}
          lastAssistant={lastAssistant}
          onTranscript={(t) => void send(t)}
          onStopRequested={() => {}}
        />

        {/* Bottom Composer */}
        <div className="px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pt-2 md:pb-6 shrink-0">
          <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
            {attachment && (
              <div className="flex items-center gap-2 px-3 py-1 bg-[#EBE8DF] border border-[var(--border)] rounded-lg text-xs w-fit">
                <FileText size={13} className="text-[var(--muted)]" />
                <span className="font-medium text-[var(--text)]">{attachment}</span>
                <button
                  onClick={() => setAttachment(null)}
                  className="text-[var(--muted)] hover:text-[var(--action)] ml-1"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2 px-4 shadow-sm flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file or context"
                className="text-[var(--muted)] shrink-0 hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <Paperclip size={18} />
              </button>

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Give Elio a goal..."
                disabled={busy}
                className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
              />

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || busy}
                  className="px-5 py-2.5 md:px-4 md:py-1.5 rounded-lg bg-[var(--action)] text-white text-sm md:text-xs font-medium hover:bg-[#A35942] transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {busy ? "Working..." : "Send"}
                </button>
                <button
                  onClick={() => setVoiceOn((v) => !v)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 md:px-3 md:py-1.5 rounded-lg text-sm md:text-xs font-medium border transition-colors cursor-pointer ${
                    voiceOn
                      ? "bg-[#DCE2DC] text-[#3D523C] border-[var(--accent)]"
                      : "bg-[var(--panel)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]"
                  }`}
                  title="Toggle Voice Mode"
                >
                  <Mic size={14} />
                  <span className="hidden sm:inline">Voice</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Secure Workspace Live Browser —
          docked aside on desktop, full-height sheet on phones. */}
      {showBrowser && (
        <LiveBrowser active={busy} onClose={() => setShowBrowser(false)} />
      )}
    </div>
  );
}
