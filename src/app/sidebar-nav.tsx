"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  FileText,
  CheckSquare,
  Shield,
  FileSearch,
  Brain,
  Network,
  Settings,
  LogOut,
} from "lucide-react";

interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
}

const NAV = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/digests", label: "Digest", icon: FileText, hasBadge: "unread" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, taskBadge: true },
  { href: "/approvals", label: "Approvals", icon: Shield, approvalBadge: true },
  { href: "/audit", label: "Audit", icon: FileSearch },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/connectors", label: "Connectors", icon: Network },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const [unread, setUnread] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [user, setUser] = useState<UserInfo | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    const loadData = () => {
      // Digest unread count
      fetch("/api/digests")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => alive && d && setUnread(d.unread || 0))
        .catch(() => {});

      // Live pending approvals count
      fetch("/api/approvals?status=pending")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => alive && d && setPendingApprovals(d.approvals?.length || 0))
        .catch(() => {});

      // User profile
      fetch("/api/auth/me")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => alive && d?.user && setUser(d.user))
        .catch(() => {});
    };

    loadData();
    const iv = setInterval(loadData, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/landing");
      router.refresh();
    } catch {
      router.push("/landing");
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return "E";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <Link href="/" className="block px-2 pt-2 pb-6 group">
        <div className="flex items-center gap-2.5">
          <Image
            src="/elio-icon.png"
            alt="Elio"
            width={32}
            height={32}
            className="rounded-lg shrink-0"
          />
          <div>
            <h1 className="font-editorial text-base font-bold tracking-[0.18em] text-[var(--text)] leading-tight">
              ELIO
            </h1>
            <p className="text-[10px] tracking-[0.2em] text-[var(--muted)] uppercase font-medium">
              PERSONAL AGENT
            </p>
          </div>
        </div>
      </Link>

      {/* Navigation Links */}
      <nav className="space-y-1">
        {NAV.map((n) => {
          const Icon = n.icon;
          const isActive = pathname === n.href;

          let badgeVal: number | null = null;
          if (n.hasBadge && unread > 0) {
            badgeVal = unread;
          } else if (n.approvalBadge && pendingApprovals > 0) {
            badgeVal = pendingApprovals;
          }

          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={`px-3 py-2.5 rounded-xl text-[13.5px] transition-all flex items-center justify-between ${
                isActive
                  ? "bg-[var(--accent)] text-white font-medium shadow-sm"
                  : "text-[var(--text)] hover:bg-[#EBE8DF]"
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  size={17}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={isActive ? "text-white" : "text-[var(--muted)]"}
                />
                <span>{n.label}</span>
              </div>
              {badgeVal !== null && (
                <span
                  className={`w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 ${
                    isActive ? "bg-white text-[var(--accent)]" : "bg-[var(--action)] text-white"
                  }`}
                >
                  {badgeVal}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Workspace & User Profile Card at bottom */}
      <div className="mt-auto pt-4 border-t border-[var(--border)] flex items-center justify-between px-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#354035] text-white flex items-center justify-center font-medium text-xs shrink-0">
            {getInitials(user?.name)}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-[var(--text)] truncate leading-tight">
              {user?.name || "Elio User"}
            </div>
            <div className="text-[11px] text-[var(--muted)] truncate leading-tight mt-0.5">
              {user?.email || "Local Workspace"}
            </div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="p-1.5 text-[var(--muted)] hover:text-[var(--action)] transition-colors rounded-[var(--radius-sm)] hover:bg-[#EBE8DF]"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
