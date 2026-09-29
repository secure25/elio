"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ShieldCheck, Sun, CheckSquare, Lock, Eye, Terminal } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col justify-between selection:bg-[#E2DDD3]">
      {/* Top Header */}
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <Image
            src="/elio-icon.png"
            alt="Elio"
            width={36}
            height={36}
            className="rounded-xl"
          />
          <span className="font-editorial text-xl font-bold tracking-[0.2em] text-[var(--text)]">
            ELIO
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-xs uppercase tracking-wider font-medium text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1.5 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="text-xs uppercase tracking-wider font-medium bg-[var(--action)] text-white px-4 py-2 rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            Get Started
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-4xl mx-auto px-6 py-16 sm:py-24 text-center flex-1 flex flex-col justify-center items-center">


        <h1 className="font-editorial text-4xl sm:text-6xl font-normal leading-[1.15] text-[var(--text)] mb-6 max-w-3xl">
          The personal AI agent that thinks ahead, acts on your behalf, and never surprises you.
        </h1>

        <p className="text-base sm:text-lg text-[var(--text-muted)] max-w-2xl mx-auto leading-relaxed mb-10">
          Elio combines proactive morning briefings, supervised background execution, local credential vaults, and human-in-the-loop Sentinel approvals in an editorial workspace.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 mb-16">
          <Link
            href="/signup"
            className="w-full sm:w-auto px-6 py-3 bg-[var(--action)] text-white text-sm font-medium rounded-[var(--radius-sm)] hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            Create Your Workspace
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto px-6 py-3 bg-[var(--card-bg)] border border-[var(--border)] text-[var(--text)] text-sm font-medium rounded-[var(--radius-sm)] hover:bg-[#F2EFE9] transition-all flex items-center justify-center gap-2"
          >
            Sign In with Existing Account
          </Link>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left w-full mt-4">
          <div className="p-6 rounded-[var(--radius-md)] bg-[var(--card-bg)] border border-[var(--border)] shadow-xs">
            <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[#EBF0EB] text-[var(--accent)] flex items-center justify-center mb-4">
              <Sun className="w-5 h-5" />
            </div>
            <h3 className="font-editorial text-xl font-medium mb-2 text-[var(--text)]">
              Proactive Daily Briefings
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Every morning, Elio analyzes your connected calendar, unread threads, and pending goals to compile a succinct, actionable briefing before your day begins.
            </p>
          </div>

          <div className="p-6 rounded-[var(--radius-md)] bg-[var(--card-bg)] border border-[var(--border)] shadow-xs">
            <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[#FBF0ED] text-[var(--action)] flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-editorial text-xl font-medium mb-2 text-[var(--text)]">
              Sentinel Human-in-the-Loop
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Sensitive actions like sending outbound emails, booking travel, or altering schedules are classified by risk and held for your explicit confirmation.
            </p>
          </div>

          <div className="p-6 rounded-[var(--radius-md)] bg-[var(--card-bg)] border border-[var(--border)] shadow-xs">
            <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[#F3EFE6] text-[#7A6B53] flex items-center justify-center mb-4">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="font-editorial text-xl font-medium mb-2 text-[var(--text)]">
              Local AES-256 Vault
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              All credentials and OAuth refresh tokens are encrypted on disk with AES-256-GCM. Agent prompts only use surrogate tokens to prevent credential leaks.
            </p>
          </div>

          <div className="p-6 rounded-[var(--radius-md)] bg-[var(--card-bg)] border border-[var(--border)] shadow-xs">
            <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[#E8EEF5] text-[#4A6B82] flex items-center justify-center mb-4">
              <CheckSquare className="w-5 h-5" />
            </div>
            <h3 className="font-editorial text-xl font-medium mb-2 text-[var(--text)]">
              Supervised Task Execution
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Give Elio a high-level goal. It creates a structured plan, browses pages with a headless browser, manages drafts, and reports back transparently.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] px-6 py-6 text-xs text-[var(--text-muted)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Elio · A calm, intelligent operations workspace for personal agency.</p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-[var(--text)] transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-[var(--text)] transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

