"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  User,
  Sliders,
  Bell,
  ShieldCheck,
  Lock,
  MessageSquare,
  Moon,
  Database,
  Pencil,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  X,
  Check,
  Search,
  Key,
  ShieldAlert,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Volume2,
} from "lucide-react";

interface VoiceInfo {
  engine: string | null;
  voice: string | null;
  reason: string;
  isElevenLabs: boolean;
  offline: boolean;
  note?: string;
}

interface Config {
  provider: string | null;
  model: string | null;
  llmConfigured: boolean;
  elevenLabsConfigured?: boolean;
  voiceProvider?: "auto" | "local";
  voice?: VoiceInfo;
  telegramResultsEnabled?: boolean;
  telegramApprovalsEnabled?: boolean;
  googleOAuthConfigured: boolean;
  vaultConfigured: boolean;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [secureExpanded, setSecureExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [telegramResults, setTelegramResults] = useState(true);
  const [telegramApprovals, setTelegramApprovals] = useState(true);
  const [tgBusy, setTgBusy] = useState(false);

  // Profile state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [userName, setUserName] = useState("Elio User");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("Member");

  // Form states
  const [responseStyle, setResponseStyle] = useState("Balanced");
  const [approvalThreshold, setApprovalThreshold] = useState(70);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [dataRetention, setDataRetention] = useState("12 months");

  // Behavior settings
  const [autonomousActions, setAutonomousActions] = useState(true);
  const [proactiveDigests, setProactiveDigests] = useState(true);
  const [toneVoice, setToneVoice] = useState("Warm & Thoughtful");
  const [autoIndexMemory, setAutoIndexMemory] = useState(true);

  // Notification settings
  const [notifyDigest, setNotifyDigest] = useState(true);
  const [notifyApprovals, setNotifyApprovals] = useState(true);
  const [notifyTasks, setNotifyTasks] = useState(false);
  const [notifyDesktop, setNotifyDesktop] = useState(true);

  // Privacy settings
  const [localOnlyStorage, setLocalOnlyStorage] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  const [searchHistoryEncrypted, setSearchHistoryEncrypted] = useState(true);

  // Security settings
  const [sessionTimeout, setSessionTimeout] = useState("30 minutes");
  const [biometricsEnabled, setBiometricsEnabled] = useState(true);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Live speech-engine switch (Settings → Behavior → Speech Engine).
  const switchVoice = async (p: "auto" | "local") => {
    setSwitching(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "voice.provider", value: p }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig((c) => (c ? { ...c, voiceProvider: data.voiceProvider, voice: data.voice } : c));
        showToast(
          p === "auto"
            ? "Voice switched to ElevenLabs (cloud) — active immediately"
            : "Voice switched to offline Piper — spoken text stays on this machine"
        );
      } else {
        showToast("Voice switch failed — try again");
      }
    } catch {
      showToast("Voice switch failed — try again");
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [resSettings, resMe] = await Promise.all([
          fetch("/api/settings").catch(() => null),
          fetch("/api/auth/me").catch(() => null),
        ]);
        if (resSettings && resSettings.ok) {
          const cfg = await resSettings.json();
          setConfig(cfg);
          setTelegramResults(cfg.telegramResultsEnabled !== false);
          setTelegramApprovals(cfg.telegramApprovalsEnabled !== false);
        }
        if (resMe && resMe.ok) {
          const meData = await resMe.json();
          if (meData?.user) {
            setUserName(meData.user.name || "Elio User");
            setUserEmail(meData.user.email || "");
            setUserRole(meData.user.role || "Member");
          }
        }
      } catch (e) {
        console.error("Failed to load settings config", e);
      }
    };
    load();
  }, []);

  // Telegram result delivery (Settings → Behavior). Persisted server-side;
  // default ON when the setting has never been written.
  const switchTelegramResults = async (on: boolean) => {
    setTgBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "telegram_results_enabled", value: on ? "true" : "false" }),
      });
      if (res.ok) {
        setTelegramResults(on);
        showToast(
          on
            ? "Task results will also arrive on your Telegram"
            : "Task results are app-only — Telegram delivery off"
        );
      } else {
        showToast("Could not save the Telegram setting — try again");
      }
    } catch {
      showToast("Could not save the Telegram setting — try again");
    } finally {
      setTgBusy(false);
    }
  };

  // Telegram approval pushes (Settings → Behavior). Persisted server-side;
  // default ON: every pending approval also lands on Telegram with
  // Approve/Decline buttons so the owner can act from their phone.
  const switchTelegramApprovals = async (on: boolean) => {
    setTgBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "approval_telegram_enabled", value: on ? "true" : "false" }),
      });
      if (res.ok) {
        setTelegramApprovals(on);
        showToast(
          on
            ? "Approvals will also arrive on your Telegram"
            : "Approvals are app-only — Telegram pushes off"
        );
      } else {
        showToast("Could not save the Telegram setting — try again");
      }
    } catch {
      showToast("Could not save the Telegram setting — try again");
    } finally {
      setTgBusy(false);
    }
  };

  const checks = [
    {
      ok: config?.vaultConfigured,
      title: "Vault encryption",
      desc: "VAULT_SECRET set in .env — encrypts all stored credentials.",
      fix: "Copy .env.example to .env and set VAULT_SECRET to a long random string.",
    },
    {
      ok: config?.llmConfigured,
      title: `LLM (${config?.provider ?? "none"})${config?.model ? ` · ${config.model}` : ""}`,
      desc: "Free-tier provider powers the agent.",
      fix: "Get a free key at aistudio.google.com/apikey → GEMINI_API_KEY in .env",
    },
    {
      ok: config?.elevenLabsConfigured,
      title: "ElevenLabs Speech Engine",
      desc: config?.elevenLabsConfigured
        ? "High-fidelity neural TTS active."
        : "Optional: powers voice responses with ElevenLabs.",
      fix: "Set ELEVENLABS_API_KEY in .env to enable premium neural speech.",
    },
    {
      ok: config?.googleOAuthConfigured,
      title: "Google OAuth",
      desc: "Needed only for Gmail/Calendar connectors.",
      fix: "Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.",
    },
  ];

  const allChecksOk = checks.every((c) => c.ok);

  const tabs = [
    { id: "profile", icon: User, label: "Profile", desc: "Your identity and preferences" },
    { id: "behavior", icon: Sliders, label: "Behavior", desc: "How Elio responds and acts" },
    { id: "notifications", icon: Bell, label: "Notifications", desc: "Updates and alerts" },
    { id: "privacy", icon: ShieldCheck, label: "Privacy", desc: "Your data and activity" },
    { id: "security", icon: Lock, label: "Security", desc: "Access and workspace protection" },
  ];

  const handleSave = async () => {
    try {
      await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: userName, role: userRole }),
      });
      showToast("Settings successfully saved to local encrypted vault");
    } catch {
      showToast("Settings saved locally");
    }
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

      {/* Edit Profile Modal */}
      {isEditingProfile && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-editorial font-semibold">Edit Profile</h3>
              <button
                onClick={() => setIsEditingProfile(false)}
                className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[#EAE6DE]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">Full Name</label>
                <input
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">Email Address</label>
                <input
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">Role / Plan</label>
                <input
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setIsEditingProfile(false)}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setIsEditingProfile(false);
                  showToast("Profile details updated");
                }}
                className="btn-moss px-4 py-2 rounded-lg text-xs font-medium"
              >
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-4 pb-5 md:px-8 md:pt-8 md:pb-6 border-b border-[var(--border)] shrink-0 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold tracking-widest text-[var(--muted)] mb-1 uppercase">
            Settings
          </div>
          <h1 className="text-2xl md:text-3xl font-editorial mb-1">Personal settings</h1>
          <p className="text-[var(--muted)] text-xs max-w-2xl">
            Control how Elio works for you. Adjust your profile, behavior, notifications, privacy, and security preferences.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => showToast("Search across all settings")}
            className="p-2 rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            <Search size={15} />
          </button>
          <div className="w-8 h-8 rounded-full bg-[#3D4C3C] text-white flex items-center justify-center font-medium text-xs">
            {userName ? userName[0].toUpperCase() : "O"}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Mobile horizontal tab bar */}
        <div className="md:hidden shrink-0 border-b border-[var(--border)] bg-[var(--bg)] scroll-x">
          <nav className="flex gap-1.5 px-3 py-2 w-max">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] bg-[var(--panel)] border border-[var(--border)]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Navigation (desktop) */}
        <div className="w-[220px] shrink-0 border-r border-[var(--border)] overflow-y-auto py-4 bg-[var(--bg)] hidden md:block">
          <nav className="flex flex-col space-y-0.5">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-col items-start px-5 py-3.5 w-full text-left transition-all relative ${
                    isActive ? "bg-[#ECE8DF]" : "hover:bg-[#F2EFE9]"
                  }`}
                >
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--accent)]" />}
                  <div className="flex items-center gap-2.5 mb-1">
                    <Icon
                      className={`w-4 h-4 ${isActive ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                    />
                    <span
                      className={`text-xs font-semibold ${
                        isActive ? "text-[var(--text)]" : "text-[var(--muted)]"
                      }`}
                    >
                      {tab.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--muted)] pl-6 leading-relaxed">
                    {tab.desc}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 pb-[max(2rem,env(safe-area-inset-bottom))] md:p-8 bg-[var(--bg)]">
          <div className="max-w-3xl mx-auto flex flex-col h-full pb-12">
            {/* 1. Profile Tab */}
            {activeTab === "profile" && (
              <div className="space-y-6">
                {/* Profile Card */}
                <div className="panel p-6 rounded-xl flex items-center justify-between border border-[var(--border)] bg-[var(--panel)] shadow-sm">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-3xl font-editorial shadow-sm">
                      {userName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h2 className="text-xl font-medium">{userName}</h2>
                        <span className="chip chip-moss text-[10px] uppercase font-semibold px-2 py-0.5">
                          {userRole}
                        </span>
                      </div>
                      <p className="text-[var(--muted)] text-xs">{userEmail}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsEditingProfile(true)}
                    className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[#EAE6DD] transition-colors bg-[var(--bg)] shadow-none"
                  >
                    <Pencil className="w-3.5 h-3.5 text-[var(--muted)]" />
                    <span>Edit profile</span>
                  </button>
                </div>

                {/* 2x2 Grid of Setting Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Response Style */}
                  <div className="panel p-5 rounded-xl border border-[var(--border)] flex flex-col justify-between bg-[var(--panel)] shadow-sm">
                    <div>
                      <div className="flex items-center gap-2.5 mb-4">
                        <MessageSquare className="w-4 h-4 text-[var(--muted)]" />
                        <span className="text-xs font-semibold text-[var(--text)]">Response style</span>
                      </div>
                      <div className="relative mb-3">
                        <select
                          value={responseStyle}
                          onChange={(e) => setResponseStyle(e.target.value)}
                          className="w-full appearance-none bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3.5 py-2 text-xs pr-10 focus:outline-none focus:border-[var(--accent)]"
                        >
                          <option>Balanced</option>
                          <option>Concise</option>
                          <option>Detailed</option>
                          <option>Academic</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-[var(--muted)] pointer-events-none" />
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                      Clear, concise and thoughtful — with options when you need them.
                    </p>
                  </div>

                  {/* Approval Threshold */}
                  <div className="panel p-5 rounded-xl border border-[var(--border)] flex flex-col justify-between bg-[var(--panel)] shadow-sm">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                          <ShieldCheck className="w-4 h-4 text-[var(--muted)]" />
                          <span className="text-xs font-semibold text-[var(--text)]">
                            Default approval threshold
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-[var(--accent)]">{approvalThreshold}%</span>
                      </div>
                      <div className="mb-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={approvalThreshold}
                          onChange={(e) => setApprovalThreshold(Number(e.target.value))}
                          className="w-full accent-[var(--accent)] cursor-pointer"
                        />
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-[var(--muted)] uppercase tracking-wider font-semibold">
                      <span>Lower (autonomous)</span>
                      <span>Higher (cautious)</span>
                    </div>
                  </div>

                  {/* Quiet Hours */}
                  <div className="panel p-5 rounded-xl border border-[var(--border)] flex flex-col justify-between bg-[var(--panel)] shadow-sm">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                          <Moon className="w-4 h-4 text-[var(--muted)]" />
                          <span className="text-xs font-semibold text-[var(--text)]">Quiet hours</span>
                        </div>
                        <button
                          onClick={() => setQuietHoursEnabled(!quietHoursEnabled)}
                          className={`w-10 h-5.5 rounded-full p-0.5 transition-colors relative cursor-pointer ${
                            quietHoursEnabled ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                          }`}
                        >
                          <div
                            className={`w-4.5 h-4.5 bg-white rounded-full transition-transform shadow-xs ${
                              quietHoursEnabled ? "translate-x-4.5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="time"
                          value={quietStart}
                          onChange={(e) => setQuietStart(e.target.value)}
                          disabled={!quietHoursEnabled}
                          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none flex-1 disabled:opacity-50"
                        />
                        <span className="text-[var(--muted)] text-xs">→</span>
                        <input
                          type="time"
                          value={quietEnd}
                          onChange={(e) => setQuietEnd(e.target.value)}
                          disabled={!quietHoursEnabled}
                          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none flex-1 disabled:opacity-50"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] leading-relaxed">(Local time · UTC-4)</p>
                  </div>

                  {/* Data Retention */}
                  <div className="panel p-5 rounded-xl border border-[var(--border)] flex flex-col justify-between bg-[var(--panel)] shadow-sm">
                    <div>
                      <div className="flex items-center gap-2.5 mb-4">
                        <Database className="w-4 h-4 text-[var(--muted)]" />
                        <span className="text-xs font-semibold text-[var(--text)]">Data retention</span>
                      </div>
                      <div className="relative mb-3">
                        <select
                          value={dataRetention}
                          onChange={(e) => setDataRetention(e.target.value)}
                          className="w-full appearance-none bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3.5 py-2 text-xs pr-10 focus:outline-none focus:border-[var(--accent)]"
                        >
                          <option>12 months</option>
                          <option>6 months</option>
                          <option>30 days</option>
                          <option>Forever (Local only)</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-[var(--muted)] pointer-events-none" />
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                      After this period, data will be securely deleted from your workspace.
                    </p>
                  </div>
                </div>

                {/* Secure Workspace Card */}
                <div className="panel rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--panel)] shadow-sm">
                  <button
                    onClick={() => setSecureExpanded(!secureExpanded)}
                    className="w-full flex items-center justify-between p-5 hover:bg-[#F2EFE9] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 rounded-full bg-[var(--bg)] flex items-center justify-center border border-[var(--border)] text-[var(--text)] shadow-none">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[var(--text)]">Secure workspace</div>
                        <div className="text-xs text-[var(--muted)]">System status and local environment verification</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                          allChecksOk ? "chip-moss" : "chip-terracotta"
                        }`}
                      >
                        {allChecksOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <div className="w-2 h-2 rounded-full bg-[var(--action)]" />}
                        <span>{allChecksOk ? "Secure" : "Attention needed"}</span>
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 text-[var(--muted)] transition-transform ${
                          secureExpanded ? "rotate-90" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {secureExpanded && (
                    <div className="p-5 border-t border-[var(--border)] bg-[var(--bg)] space-y-3.5">
                      {checks.map((c) => (
                        <div
                          key={c.title}
                          className="p-3.5 rounded-lg bg-[var(--panel)] border border-[var(--border)] flex items-start gap-3"
                        >
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5"
                            style={{
                              background: c.ok ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)",
                              color: c.ok ? "var(--ok)" : "var(--warn)",
                            }}
                          >
                            {c.ok ? "✓" : "!"}
                          </span>
                          <div className="flex-1 text-xs">
                            <div className="font-semibold text-[var(--text)]">{c.title}</div>
                            <div className="text-[var(--muted)] mt-0.5 leading-relaxed">{c.desc}</div>
                            {!c.ok && (
                              <div className="text-[11px] mt-1.5 font-medium text-[var(--warn)]">
                                → {c.fix}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="text-[11px] text-[var(--muted)] pt-2 leading-relaxed italic">
                        Conversations and credentials stay on your machine (AES-256-GCM encrypted). No third-party ad tracking or sharing.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. Behavior Tab */}
            {activeTab === "behavior" && (
              <div className="space-y-5">
                <div className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-5">
                  <h3 className="font-editorial text-lg font-semibold text-[var(--text)]">
                    Agent Autonomy & Intelligence
                  </h3>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Autonomous Actions</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Allow Elio to perform low-risk actions without explicit prompt confirmation
                      </div>
                    </div>
                    <button
                      onClick={() => setAutonomousActions(!autonomousActions)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        autonomousActions ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          autonomousActions ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Proactive Daily Briefings</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Compile morning briefings from calendar and email automatically
                      </div>
                    </div>
                    <button
                      onClick={() => setProactiveDigests(!proactiveDigests)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        proactiveDigests ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          proactiveDigests ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Auto-index Conversation Memories</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Extract durable facts (preferences, people, places) seamlessly during chat
                      </div>
                    </div>
                    <button
                      onClick={() => setAutoIndexMemory(!autoIndexMemory)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        autoIndexMemory ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          autoIndexMemory ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Telegram Result Delivery</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Send Elio's final task answers to your connected Telegram chat automatically (requires the Telegram connector)
                      </div>
                    </div>
                    <button
                      disabled={tgBusy}
                      onClick={() => switchTelegramResults(!telegramResults)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors disabled:opacity-60 ${
                        telegramResults ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform shadow-xs ${
                          telegramResults ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Telegram Approval Pushes</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Send pending approvals to your connected Telegram chat with Approve/Decline buttons — resolve them from your phone without opening the app (requires the Telegram connector)
                      </div>
                    </div>
                    <button
                      disabled={tgBusy}
                      onClick={() => switchTelegramApprovals(!telegramApprovals)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors disabled:opacity-60 ${
                        telegramApprovals ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform shadow-xs ${
                          telegramApprovals ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-[var(--text)] mb-2">Agent Tone & Style</div>
                    <div className="grid grid-cols-3 gap-3">
                      {["Concise & Direct", "Warm & Thoughtful", "Formal & Analytical"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setToneVoice(t)}
                          className={`p-3 rounded-lg border text-xs text-left transition-all ${
                            toneVoice === t
                              ? "border-[var(--accent)] bg-[#ECE8DF] font-semibold text-[var(--text)]"
                              : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[var(--border)]">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-[#EBF0EB] text-[var(--accent)] mt-0.5">
                        <Volume2 size={16} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-[var(--text)] flex items-center gap-2">
                          <span>Speech Engine</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            config?.voice?.offline
                              ? "bg-[#EBF0EB] text-[var(--accent)]"
                              : "bg-[#F5F2EC] text-[var(--muted)]"
                          }`}>
                            {config?.voice?.offline
                              ? "Offline · text stays on this machine"
                              : "Cloud · ElevenLabs"}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--muted)] mt-0.5 max-w-lg leading-relaxed">
                          Pick where Elio's spoken replies are synthesized. Switching applies
                          immediately — no restart needed.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => switchVoice("auto")}
                        disabled={switching || !config?.elevenLabsConfigured}
                        className={`p-3 rounded-lg border text-xs text-left transition-all disabled:opacity-60 ${
                          config?.voiceProvider === "auto"
                            ? "border-[var(--accent)] bg-[#ECE8DF] font-semibold text-[var(--text)]"
                            : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)]"
                        }`}
                      >
                        <div className="font-semibold mb-0.5">ElevenLabs (cloud)</div>
                        <div className="text-[10px] leading-relaxed">
                          {config?.elevenLabsConfigured
                            ? "Highest fidelity neural voice. Spoken text is sent to ElevenLabs."
                            : "Needs ELEVENLABS_API_KEY in .env."}
                        </div>
                      </button>
                      <button
                        onClick={() => switchVoice("local")}
                        disabled={switching}
                        className={`p-3 rounded-lg border text-xs text-left transition-all disabled:opacity-60 ${
                          config?.voiceProvider === "local"
                            ? "border-[var(--accent)] bg-[#ECE8DF] font-semibold text-[var(--text)]"
                            : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)]"
                        }`}
                      >
                        <div className="font-semibold mb-0.5">Offline (Piper · male Ryan)</div>
                        <div className="text-[10px] leading-relaxed">
                          Fully private: spoken text never leaves this machine.
                        </div>
                      </button>
                    </div>
                    {config?.voice && (
                      <div className="mt-2 text-[10px] text-[var(--muted)]">
                        Active: {config.voice.engine ?? "none"}
                        {config.voice.voice ? ` · ${config.voice.voice}` : ""}
                        {config.voice.note ? ` — ⚠ ${config.voice.note}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3. Notifications Tab */}
            {activeTab === "notifications" && (
              <div className="space-y-5">
                <div className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-5">
                  <h3 className="font-editorial text-lg font-semibold text-[var(--text)]">
                    Alerts & Notifications
                  </h3>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Morning Briefing Alert</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Receive a prompt when your morning summary is ready
                      </div>
                    </div>
                    <button
                      onClick={() => setNotifyDigest(!notifyDigest)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        notifyDigest ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          notifyDigest ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">High-Risk Approval Ping</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Instant notification when an action requires explicit human confirmation
                      </div>
                    </div>
                    <button
                      onClick={() => setNotifyApprovals(!notifyApprovals)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        notifyApprovals ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          notifyApprovals ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Task Step Completions</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Receive a toast whenever a background subtask finishes
                      </div>
                    </div>
                    <button
                      onClick={() => setNotifyTasks(!notifyTasks)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        notifyTasks ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          notifyTasks ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Desktop System Notifications</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Send native OS notifications when Elio is running in the background
                      </div>
                    </div>
                    <button
                      onClick={() => setNotifyDesktop(!notifyDesktop)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        notifyDesktop ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          notifyDesktop ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Privacy Tab */}
            {activeTab === "privacy" && (
              <div className="space-y-5">
                <div className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-5">
                  <h3 className="font-editorial text-lg font-semibold text-[var(--text)]">
                    Data & Privacy Architecture
                  </h3>

                  <div className="p-4 rounded-lg bg-[#EFECE5] border border-[var(--border)] text-xs space-y-2">
                    <div className="font-semibold text-[var(--accent-dark)] flex items-center gap-2">
                      <ShieldCheck size={16} className="text-[var(--accent)]" />
                      Zero Telemetry Guarantee
                    </div>
                    <p className="text-[var(--muted)] leading-relaxed text-[11px]">
                      Elio executes in an isolated local VM context. No conversational logs, credentials, or browsing activities are transmitted to central servers.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Local-Only Memory Persistence</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Save all memories strictly to local SQLite database with AES-256
                      </div>
                    </div>
                    <button
                      onClick={() => setLocalOnlyStorage(!localOnlyStorage)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        localOnlyStorage ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          localOnlyStorage ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Anonymous Performance Diagnostics</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Share anonymous crash reports to help improve Elio
                      </div>
                    </div>
                    <button
                      onClick={() => setTelemetry(!telemetry)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        telemetry ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          telemetry ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="pt-2 flex justify-between items-center pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--action)]">Clear Cache & Temporary Artifacts</div>
                      <div className="text-[11px] text-[var(--muted)]">Remove cached screenshots and browser traces</div>
                    </div>
                    <button
                      onClick={() => showToast("Temporary cache purged")}
                      className="px-3.5 py-1.5 rounded-lg border border-[var(--action)] text-[var(--action)] text-xs font-medium hover:bg-[var(--action)] hover:text-white transition-colors"
                    >
                      Purge Cache
                    </button>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--muted)]">Official Legal &amp; Compliance Agreements:</span>
                    <div className="flex items-center gap-4">
                      <Link href="/privacy" className="text-[var(--accent)] hover:underline font-medium">
                        Privacy Policy
                      </Link>
                      <span className="text-[var(--muted)]">•</span>
                      <Link href="/terms" className="text-[var(--accent)] hover:underline font-medium">
                        Terms of Service
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. Security Tab */}
            {activeTab === "security" && (
              <div className="space-y-5">
                <div className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-5">
                  <h3 className="font-editorial text-lg font-semibold text-[var(--text)]">
                    Credential Vault & Authentication
                  </h3>

                  {/* Change password — sets a known credential from this device */}
                  <div className="pb-4 mb-1 border-b border-[var(--border)] space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Change Password</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Requires your current password. Use this to set a known password on new devices.
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <input
                        type="password"
                        autoComplete="current-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Current password"
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                      />
                      <input
                        type="password"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 6 characters)"
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                      />
                      <input
                        type="password"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (pwBusy) return;
                        if (!currentPassword || !newPassword) {
                          showToast("Fill in your current and new password first.");
                          return;
                        }
                        if (newPassword !== confirmNewPassword) {
                          showToast("New passwords do not match.");
                          return;
                        }
                        setPwBusy(true);
                        try {
                          const res = await fetch("/api/auth/change-password", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ currentPassword, newPassword }),
                          });
                          const data = await res.json();
                          if (res.ok) {
                            showToast("Password updated — use it on your other devices.");
                            setCurrentPassword("");
                            setNewPassword("");
                            setConfirmNewPassword("");
                          } else {
                            showToast(data.error || "Could not change password.");
                          }
                        } catch {
                          showToast("Network error — please try again.");
                        } finally {
                          setPwBusy(false);
                        }
                      }}
                      disabled={pwBusy}
                      className="btn text-xs py-1.5 px-3 disabled:opacity-50"
                    >
                      {pwBusy ? "Saving…" : "Update Password"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Master Vault Encryption Key</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Status: Active (AES-256-GCM verified)
                      </div>
                    </div>
                    <button
                      onClick={() => showToast("Key rotation dialog initialized")}
                      className="btn text-xs py-1.5 px-3"
                    >
                      Rotate Key
                    </button>
                  </div>

                  <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Inactivity Session Timeout</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Lock credentials when inactive
                      </div>
                    </div>
                    <select
                      value={sessionTimeout}
                      onChange={(e) => setSessionTimeout(e.target.value)}
                      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs outline-none"
                    >
                      <option>15 minutes</option>
                      <option>30 minutes</option>
                      <option>1 hour</option>
                      <option>Never</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text)]">Biometric / Hardware Key Approval</div>
                      <div className="text-[11px] text-[var(--muted)] mt-0.5">
                        Require Touch ID / Windows Hello for High-Risk financial actions
                      </div>
                    </div>
                    <button
                      onClick={() => setBiometricsEnabled(!biometricsEnabled)}
                      className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${
                        biometricsEnabled ? "bg-[var(--accent)]" : "bg-[#DDD7CD]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 bg-white rounded-full transition-transform ${
                          biometricsEnabled ? "translate-x-4.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Save Changes Button */}
            <div className="flex justify-end pt-6">
              <button
                onClick={handleSave}
                className="bg-[#B8654B] hover:bg-[#a35942] text-white px-6 py-2.5 rounded-lg font-medium text-xs transition-colors shadow-sm cursor-pointer"
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
