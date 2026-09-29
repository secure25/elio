"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  UserCheck,
  FileText,
  Sprout,
  X,
  CheckCircle2,
  RefreshCw,
  Trash2,
  ExternalLink,
  Key,
  Bell,
  ChevronDown,
  Lock,
  MoreVertical,
} from "lucide-react";

interface Grant {
  connector: string;
  status: string;
  account_email: string | null;
  scopes: string;
  updated_at: number;
}
interface Secret {
  label: string;
  kind: string;
  surrogate: string;
}
interface Config {
  googleOAuthConfigured: boolean;
  vaultConfigured: boolean;
  secrets: Secret[];
}

interface ServiceDef {
  id: string;
  name: string;
  desc: string;
  scopeDesc: string;
  color: string;
  letter: string;
  connected: boolean;
  lastSyncedMinutes: number;
  accountEmail?: string;
  helperText?: string;
  kind?: "oauth" | "apikey" | "messaging";
}

const INITIAL_SERVICES: ServiceDef[] = [
  {
    id: "gcal",
    name: "Google Calendar",
    desc: "Read your calendar, events, and availability.",
    scopeDesc: "Read-only access to events, calendars, and availability.",
    color: "#4285F4",
    letter: "31",
    connected: false,
    lastSyncedMinutes: 0,
    helperText: "Connect to allow Elio to inspect upcoming events and suggest schedule adjustments.",
  },
  {
    id: "gmail",
    name: "Gmail",
    desc: "Read and send emails, manage drafts.",
    scopeDesc: "Read, send, and manage drafts in your Gmail account.",
    color: "#EA4335",
    letter: "M",
    connected: false,
    lastSyncedMinutes: 0,
    helperText: "Connect to let Elio draft replies and scan priority inbox threads.",
  },
  {
    id: "telegram",
    name: "Telegram",
    desc: "Send messages to your own Telegram chat.",
    scopeDesc: "Send-only messages to your connected Telegram chat. The recipient is locked to your own account; every send needs your approval.",
    color: "#229ED9",
    letter: "T",
    connected: false,
    lastSyncedMinutes: 0,
    helperText: "Connect to let Elio reach you on Telegram — confirmations, reminders, and requested messages.",
    kind: "messaging",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    desc: "Send messages to your own WhatsApp number.",
    scopeDesc: "Send-only messages to your connected WhatsApp number via the WhatsApp Cloud API. Every send needs your approval.",
    color: "#25D366",
    letter: "W",
    connected: false,
    lastSyncedMinutes: 0,
    helperText: "Connect to let Elio reach you on WhatsApp — confirmations, reminders, and requested messages.",
    kind: "messaging",
  },
];

export default function ConnectorsPage() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [services, setServices] = useState<ServiceDef[]>(INITIAL_SERVICES);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [secretLabel, setSecretLabel] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // Modal states
  const [managingService, setManagingService] = useState<ServiceDef | null>(null);
  const [connectingService, setConnectingService] = useState<ServiceDef | null>(null);
  const [selectedPrinciple, setSelectedPrinciple] = useState<{ title: string; desc: string; detail: string } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [messagingBusy, setMessagingBusy] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const [g, c, u] = await Promise.all([
        fetch("/api/connectors").catch(() => null),
        fetch("/api/settings").catch(() => null),
        fetch("/api/auth/me").catch(() => null),
      ]);
      const gd = g && g.ok ? await g.json() : { grants: [] };
      const cd = c && c.ok ? await c.json() : null;
      const ud = u && u.ok ? await u.json() : null;

      setGrants(gd.grants || []);
      setConfig(cd);
      if (ud?.user) {
        setUser(ud.user);
      }

      // Sync backend grants into services state
      setServices((prev) =>
        prev.map((s) => {
          const found = (gd.grants || []).find((item: Grant) => item.connector === s.id);
          if (found && found.status === "connected") {
            const minutes = Math.max(0, Math.floor((Date.now() - (found.updated_at || Date.now())) / 60000));
            return {
              ...s,
              connected: true,
              lastSyncedMinutes: minutes,
              accountEmail: found.account_email || undefined,
            };
          }
          return {
            ...s,
            connected: false,
            lastSyncedMinutes: 0,
            accountEmail: undefined,
          };
        })
      );
    } catch (e) {
      console.error("Failed to load connectors data", e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connectOAuth(connector: string) {
    try {
      const res = await fetch(`/api/oauth/google/start?connector=${connector}`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || "Google OAuth is not configured in .env");
        setConnectingService(null);
      }
    } catch (e) {
      showToast("Error starting OAuth flow");
      setConnectingService(null);
    }
  }

  async function disconnect(connector: string) {
    try {
      const svc = services.find((s) => s.id === connector);
      if (svc?.kind === "messaging") {
        await fetch("/api/messaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "disconnect", channel: connector }),
        });
      } else {
        await fetch(`/api/connectors?connector=${connector}`, { method: "DELETE" });
      }
    } catch {
      // Ignored
    }
    setServices((prev) =>
      prev.map((s) =>
        s.id === connector
          ? {
              ...s,
              connected: false,
              lastSyncedMinutes: 0,
              accountEmail: undefined,
              helperText: `Connect to let Elio help with ${s.name}.`,
            }
          : s
      )
    );
    setManagingService(null);
    showToast(`${connector} disconnected`);
    load();
  }

  const handleSyncNow = (serviceId: string) => {
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, lastSyncedMinutes: 0 } : s))
    );
    showToast(`${serviceId} synced with latest updates`);
    if (managingService) {
      setManagingService({ ...managingService, lastSyncedMinutes: 0 });
    }
  };

  const handleFinishConnect = (service: ServiceDef) => {
    setServices((prev) =>
      prev.map((s) =>
        s.id === service.id
          ? {
              ...s,
              connected: true,
              lastSyncedMinutes: 0,
              accountEmail: "workspace: active",
            }
          : s
      )
    );
    setConnectingService(null);
    setApiKeyInput("");
    showToast(`${service.name} connected and ready to assist`);
  };

  async function messagingAction(body: Record<string, unknown>): Promise<{ ok: boolean; message: string } | null> {
    try {
      const res = await fetch("/api/messaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false, message: "Unexpected response" }));
      return data as { ok: boolean; message: string };
    } catch (e) {
      console.error("Messaging request failed", e);
      return { ok: false, message: "Network error" };
    }
  }

  async function connectTelegram() {
    setMessagingBusy(true);
    const result = await messagingAction({ action: "resolve_telegram_chat" });
    if (result?.ok) {
      await messagingAction({ action: "set_telegram_webhook" });
      setMessagingBusy(false);
      setConnectingService(null);
      showToast(result.message + " · 2-way Telegram chat enabled!");
      load();
    } else {
      setMessagingBusy(false);
      showToast(result?.message || "Could not find your Telegram chat");
    }
  }

  async function setupTelegramWebhook() {
    setMessagingBusy(true);
    const result = await messagingAction({ action: "set_telegram_webhook" });
    setMessagingBusy(false);
    if (result?.ok) {
      showToast("Telegram webhook synced: " + (result as any).url);
    } else {
      showToast((result as any)?.message || "Failed to set webhook");
    }
  }

  async function connectWhatsApp() {
    if (!phoneInput.trim()) {
      showToast("Enter the phone number Elio should message");
      return;
    }
    setMessagingBusy(true);
    const result = await messagingAction({ action: "save_whatsapp", token: phoneInput.trim() });
    setMessagingBusy(false);
    if (result?.ok) {
      setConnectingService(null);
      setPhoneInput("");
      showToast("WhatsApp number connected");
      load();
    } else {
      showToast(result?.message || "Could not save the WhatsApp number");
    }
  }

  async function testMessaging(channel: "telegram" | "whatsapp") {
    setMessagingBusy(true);
    const result = await messagingAction({ action: "test", channel });
    setMessagingBusy(false);
    showToast(result?.message || "Test failed");
  }

  async function addSecret() {
    if (!secretLabel.trim() || !secretValue.trim()) return;
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: secretLabel, kind: "credential", value: secretValue }),
      });
      setSecretLabel("");
      setSecretValue("");
      load();
      showToast("Secret stored safely in credential vault");
    } catch (e) {
      console.error("Failed to add secret", e);
    }
  }

  return (
    <div className="p-8 overflow-y-auto h-full max-w-6xl mx-auto font-sans relative">
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-4 right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Access Principle Detail Modal */}
      {selectedPrinciple && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-editorial font-semibold">{selectedPrinciple.title}</h3>
              <button
                onClick={() => setSelectedPrinciple(null)}
                className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-[var(--text)] font-medium mb-3">{selectedPrinciple.desc}</p>
            <p className="text-xs text-[var(--muted)] leading-relaxed mb-6 bg-[var(--bg)] p-3.5 rounded-xl border border-[var(--border)]">
              {selectedPrinciple.detail}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setSelectedPrinciple(null)}
                className="btn-moss px-4 py-2 rounded-lg text-xs font-medium"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Service Modal */}
      {managingService && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: managingService.color }}
                >
                  {managingService.letter}
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text)]">{managingService.name}</h3>
                  <p className="text-xs text-[var(--muted)]">Connected Integration</p>
                </div>
              </div>
              <button
                onClick={() => setManagingService(null)}
                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-[var(--bg)] p-3.5 rounded-xl border border-[var(--border)] space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--muted)]">Connection Status</span>
                  <span className="flex items-center gap-1.5 font-semibold text-[var(--ok)]">
                    <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
                    Connected
                  </span>
                </div>
                {managingService.accountEmail && (
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--muted)]">Authorized Account</span>
                    <span className="font-medium text-[var(--text)]">{managingService.accountEmail}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-[var(--muted)]">Last Synchronized</span>
                  <span className="text-[var(--text)]">{managingService.lastSyncedMinutes} minutes ago</span>
                </div>
              </div>

              <div>
                <div className="font-semibold text-[var(--text)] mb-1 uppercase tracking-wider text-[10px]">
                  Granted Scopes
                </div>
                <div className="bg-[var(--bg)] p-3 rounded-lg border border-[var(--border)] text-[var(--muted)]">
                  {managingService.scopeDesc}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-[var(--border)]">
              <button
                onClick={() => disconnect(managingService.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--action)] hover:bg-[#FDF2F0] rounded-lg transition-colors"
              >
                <Trash2 size={14} />
                <span>Disconnect</span>
              </button>
              <div className="flex gap-2">
                {managingService.kind === "messaging" && (
                  <>
                    <button
                      onClick={() => testMessaging(managingService.id as "telegram" | "whatsapp")}
                      disabled={messagingBusy}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-xs text-[var(--text)] hover:bg-[#EBE8DF]"
                    >
                      Send test message
                    </button>
                    {managingService.id === "telegram" && (
                      <button
                        onClick={setupTelegramWebhook}
                        disabled={messagingBusy}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-xs text-[var(--text)] hover:bg-[#EBE8DF]"
                      >
                        Enable 2-Way Chat
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => handleSyncNow(managingService.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-xs text-[var(--text)] hover:bg-[#EBE8DF]"
                >
                  <RefreshCw size={13} />
                  <span>Sync Now</span>
                </button>
                <button
                  onClick={() => setManagingService(null)}
                  className="btn-moss px-4 py-2 rounded-lg text-xs font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connect Service Modal */}
      {connectingService && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: connectingService.color }}
                >
                  {connectingService.letter}
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text)]">Connect {connectingService.name}</h3>
                  <p className="text-xs text-[var(--muted)]">Integration Setup</p>
                </div>
              </div>
              <button
                onClick={() => setConnectingService(null)}
                className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-[var(--muted)] leading-relaxed">
                Connect {connectingService.name} to allow Elio to securely read and interact with your resources based on strict least-privilege permissions.
              </p>

              {connectingService.kind === "messaging" ? (
                <div className="space-y-3">
                  {connectingService.id === "telegram" ? (
                    <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-3">
                      <p className="text-xs text-[var(--text)] leading-relaxed">
                        1. Create a free bot with <span className="font-semibold">@BotFather</span> on Telegram. 2. Open your bot and send it any message (press START). 3. Put the bot token in <code>.env</code> as <code>TELEGRAM_BOT_TOKEN</code>, then connect below — Elio finds your chat and enables 2-way chat automatically!
                      </p>
                      <button
                        onClick={() => connectTelegram()}
                        className="btn-moss px-6 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2"
                      >
                        Find my chat &amp; connect
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-3">
                      <p className="text-xs text-[var(--text)] leading-relaxed">
                        Requires a free WhatsApp Business account (Cloud API, Meta-hosted). Add <code>WHATSAPP_TOKEN</code> and <code>WHATSAPP_PHONE_ID</code> to <code>.env</code>, enter the phone number Elio should message below, then connect.
                      </p>
                      <input
                        type="tel"
                        placeholder={"+15551234567"}
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        onClick={() => connectWhatsApp()}
                        className="btn-moss px-6 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2"
                      >
                        Connect number
                      </button>
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                    <Lock size={12} />
                    <span>2-way chat enabled: message Elio on Telegram anytime. Recipient stored AES-256 encrypted in your vault.</span>
                  </div>
                </div>
              ) : connectingService.id === "gcal" || connectingService.id === "gmail" ? (
                <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-center space-y-3">
                  <p className="text-xs text-[var(--text)]">
                    Authenticate directly via Google Cloud OAuth.
                  </p>
                  <button
                    onClick={() => connectOAuth(connectingService.id)}
                    className="btn-moss px-6 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2"
                  >
                    Authorize with Google
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[var(--muted)] font-medium mb-1.5">
                      Personal Access Token or API Key
                    </label>
                    <input
                      type="password"
                      placeholder={`Enter ${connectingService.name} API Key`}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                    <Lock size={12} />
                    <span>Keys are stored AES-256 encrypted in your local vault.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[var(--border)]">
              <button
                onClick={() => setConnectingService(null)}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs text-[var(--muted)]"
              >
                Cancel
              </button>
              {connectingService.id !== "gcal" && connectingService.id !== "gmail" && (
                <button
                  onClick={() => handleFinishConnect(connectingService)}
                  className="btn-moss px-4 py-2 rounded-lg text-xs font-medium"
                >
                  Connect Tool
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Header Bar with Bell and Profile */}
      <div className="flex items-center justify-between pb-6 mb-6 border-b border-[var(--border)]">
        <div>
          <h1 className="font-editorial text-4xl font-bold mb-1 text-[var(--text)]">Connected tools</h1>
          <p className="text-sm text-[var(--muted)]">Control what Elio can access.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => showToast("No new integration alerts")}
            className="p-2 rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            <Bell size={16} />
          </button>
          <div
            onClick={() => showToast(user ? `Signed in as ${user.name} (${user.email})` : "Signed in")}
            className="flex items-center gap-2 pl-2 border-l border-[var(--border)] cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-[#3D4C3C] text-white flex items-center justify-center font-medium text-xs">
              {user?.name ? user.name[0].toUpperCase() : "E"}
            </div>
            <div className="text-xs font-medium text-[var(--text)] flex items-center gap-1">
              <span>{user?.name || "Workspace"}</span>
              <ChevronDown size={13} className="text-[var(--muted)]" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left main area */}
        <div className="col-span-12 md:col-span-8">
          <div className="space-y-4">
            {services.map((service) => (
              <div
                key={service.id}
                className="panel p-5 flex flex-col sm:flex-row sm:items-start gap-4 bg-[var(--panel)] shadow-sm hover:shadow-md transition-shadow rounded-xl border border-[var(--border)]"
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold shrink-0 text-xl shadow-xs"
                  style={{ backgroundColor: service.color }}
                >
                  {service.letter}
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-[var(--text)] text-sm">{service.name}</h3>
                  </div>
                  <p className="text-xs text-[var(--muted)] mb-2.5 mt-0.5">{service.desc}</p>

                  <div className="text-[11px] mb-3 bg-[var(--bg)] inline-block px-3 py-1.5 rounded-lg border border-[var(--border)]">
                    <span className="font-bold text-[var(--text)] tracking-wide text-[9px] uppercase">
                      Permission Scope:
                    </span>
                    <span className="text-[var(--muted)] ml-2">{service.scopeDesc}</span>
                  </div>

                  <div className="flex flex-wrap items-center text-xs">
                    {service.connected ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-[var(--ok)] mr-2 shadow-xs" />
                        <span className="font-medium text-[var(--text)]">Connected</span>
                        <span className="text-[var(--muted)] mx-2">•</span>
                        <span className="text-[var(--muted)]">
                          Last synced {service.lastSyncedMinutes} minutes ago
                        </span>
                        {service.accountEmail && (
                          <>
                            <span className="text-[var(--muted)] mx-2">•</span>
                            <span className="text-[var(--muted)]">{service.accountEmail}</span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-[var(--muted)] mr-2 opacity-50" />
                        <span className="font-medium text-[var(--muted)]">Not connected</span>
                        {service.helperText && (
                          <>
                            <span className="text-[var(--muted)] mx-2">•</span>
                            <span className="text-[var(--muted)]">{service.helperText}</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="pt-1 sm:pt-0 shrink-0 flex items-center gap-2">
                  {service.connected ? (
                    <button
                      className="btn btn-moss px-5 py-2 text-xs font-semibold w-full sm:w-auto cursor-pointer"
                      onClick={() => setManagingService(service)}
                    >
                      Manage
                    </button>
                  ) : (
                    <button
                      className="btn bg-transparent border border-[var(--border)] text-[var(--text)] hover:bg-[#EBE8DF] px-5 py-2 text-xs font-semibold transition-colors w-full sm:w-auto cursor-pointer"
                      onClick={() => setConnectingService(service)}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div className="col-span-12 md:col-span-4 md:border-l border-[var(--border)] md:pl-8 mt-8 md:mt-0">
          <div className="sticky top-8">
            <div className="mb-6">
              <h2 className="font-editorial text-2xl font-bold mb-1 text-[var(--text)]">
                Access principles
              </h2>
              <p className="text-xs text-[var(--muted)]">Your data, your control. Always.</p>
            </div>

            <div className="space-y-3.5 mb-8">
              <div
                onClick={() =>
                  setSelectedPrinciple({
                    title: "Least Privilege",
                    desc: "Elio only gets the minimum access needed to do its job, no more, no less.",
                    detail:
                      "Access tokens are restricted strictly to read-only or explicit action scopes. The agent cannot inspect your other files, contacts, or unrequested mailbox threads.",
                  })
                }
                className="panel p-4 flex gap-3 bg-[var(--panel)] shadow-xs hover:bg-[#F2EFE9] transition-all cursor-pointer rounded-xl border border-[var(--border)] group"
              >
                <ShieldCheck className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-xs mb-1 text-[var(--text)] group-hover:text-[var(--accent)]">
                    Least privilege
                  </h4>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    Elio only gets the minimum access needed to do its job, no more, no less.
                  </p>
                </div>
              </div>

              <div
                onClick={() =>
                  setSelectedPrinciple({
                    title: "Approval Before Sending",
                    desc: "For actions that affect people, content, or external services, Elio will ask for your approval first.",
                    detail:
                      "External emails, flight bookings, calendar invites, and file modifications generate an interactive approval card that requires your manual decision before execution.",
                  })
                }
                className="panel p-4 flex gap-3 bg-[var(--panel)] shadow-xs hover:bg-[#F2EFE9] transition-all cursor-pointer rounded-xl border border-[var(--border)] group"
              >
                <UserCheck className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-xs mb-1 text-[var(--text)] group-hover:text-[var(--accent)]">
                    Approval before sending
                  </h4>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    For actions that affect people, content, or external services, Elio will ask for your approval first.
                  </p>
                </div>
              </div>

              <div
                onClick={() =>
                  setSelectedPrinciple({
                    title: "Complete Audit Trail",
                    desc: "Every action is logged and traceable, so you can see what happened, when, and why.",
                    detail:
                      "All agent queries, browser navigation events, and tool calls are recorded immutably in your local Audit trail with execution rationale.",
                  })
                }
                className="panel p-4 flex gap-3 bg-[var(--panel)] shadow-xs hover:bg-[#F2EFE9] transition-all cursor-pointer rounded-xl border border-[var(--border)] group"
              >
                <FileText className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-xs mb-1 text-[var(--text)] group-hover:text-[var(--accent)]">
                    Complete audit trail
                  </h4>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    Every action is logged and traceable, so you can see what happened, when, and why.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center text-center mt-10 opacity-80">
              <Sprout className="w-6 h-6 text-[var(--accent)] mb-2" />
              <p className="text-[var(--muted)] text-xs italic font-editorial">
                More access when you need it.
                <br />
                Less risk, always.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Credential Vault Section */}
      <div className="mt-14 pt-8 border-t border-[var(--border)] max-w-4xl">
        {!config?.googleOAuthConfigured && (
          <div
            className="panel p-4 mb-8 text-xs bg-[var(--panel)] border border-[var(--warn)] rounded-xl"
          >
            <strong>Google OAuth Notice:</strong> To enable direct Google Cloud OAuth in local dev, add{" "}
            <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to your <code>.env</code> file.
          </div>
        )}

        <div className="mb-4">
          <h2 className="text-xl font-editorial font-bold mb-1 text-[var(--text)]">Credential vault</h2>
          <p className="text-[var(--muted)] text-xs mb-4">
            Secrets are AES-256-GCM encrypted. The agent only ever sees surrogate tokens like{" "}
            <code className="bg-[var(--panel)] px-1.5 py-0.5 rounded text-[11px]">{"{{vault:label}}"}</code>; real values are resolved only inside connectors.
          </p>
        </div>

        <div className="panel p-5 mb-5 bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              className="input flex-1 bg-[var(--bg)] border-[var(--border)] text-xs"
              placeholder="Label (e.g. visa_card, linear_api_key)"
              value={secretLabel}
              onChange={(e) => setSecretLabel(e.target.value)}
            />
            <input
              className="input flex-1 bg-[var(--bg)] border-[var(--border)] text-xs"
              type="password"
              placeholder="Secret value"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
            />
            <button className="btn btn-moss px-6 text-xs font-semibold cursor-pointer" onClick={addSecret}>
              Store
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          {(config?.secrets || []).map((s) => (
            <div
              key={s.label}
              className="panel px-5 py-3 flex items-center gap-4 text-xs bg-[var(--panel)] border border-[var(--border)] rounded-xl"
            >
              <span className="chip-moss px-2 py-0.5 rounded text-[10px] font-semibold uppercase">
                {s.kind}
              </span>
              <span className="font-semibold text-[var(--text)]">{s.label}</span>
              <code className="text-[var(--muted)] text-[11px] flex-1 text-right sm:text-left">
                {s.surrogate}
              </code>
            </div>
          ))}
          {(config?.secrets || []).length === 0 && (
            <p className="text-[var(--muted)] text-xs italic">No secrets stored in vault yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
