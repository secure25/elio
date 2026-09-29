"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Shield, Lock, Eye, CheckCircle2, Server, Key, RefreshCw } from "lucide-react";

export default function PrivacyPolicyPage() {
  const lastUpdated = "September 29, 2026";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-[#E2DDD3]">
      {/* Top Header */}
      <header className="border-b border-[var(--border)] px-6 py-4 sticky top-0 bg-[var(--bg)]/90 backdrop-blur-md z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/elio-icon.png"
              alt="Elio"
              width={32}
              height={32}
              className="rounded-lg group-hover:opacity-90 transition-opacity"
            />
            <span className="font-editorial text-lg font-bold tracking-[0.18em] text-[var(--text)]">
              ELIO
            </span>
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to App</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <div className="mb-10 pb-6 border-b border-[var(--border)]">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#EBF0EB] text-[var(--ok)] border border-[#C5D9C4] mb-3">
            <Shield size={13} />
            <span>Privacy &amp; Data Protection</span>
          </div>
          <h1 className="font-editorial text-4xl sm:text-5xl font-bold text-[var(--text)] tracking-tight mb-2">
            Privacy Policy
          </h1>
          <p className="text-xs text-[var(--muted)]">Last updated: {lastUpdated}</p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[var(--text)]">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">1. Introduction</h2>
            <p className="text-[var(--muted)]">
              Elio (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is an autonomous personal AI agent and operations workspace designed to help you execute tasks, manage schedules, summarize communications, and conduct research on your behalf.
            </p>
            <p className="text-[var(--muted)]">
              We operate under a strict philosophy of <strong>least privilege, human-in-the-loop oversight, and sovereign data ownership</strong>. This Privacy Policy details the types of information collected when you use Elio, how that data is secured, how it is used, and how you retain total control over your credentials and personal information.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">2. Information We Collect</h2>
            <p className="text-[var(--muted)]">
              Depending on which integrations and features you configure, Elio processes the following categories of data:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-[var(--muted)]">
              <li>
                <strong className="text-[var(--text)]">Account Credentials:</strong> Name, email address, password hash, and session tokens created during account registration.
              </li>
              <li>
                <strong className="text-[var(--text)]">Connected Third-Party Accounts:</strong> When you connect services via OAuth or API tokens:
                <ul className="list-circle pl-5 mt-1 space-y-1">
                  <li><strong>Google Workspace:</strong> OAuth access and refresh tokens, account email, read-only email metadata/content, and calendar events when explicitly connected.</li>
                  <li><strong>Telegram:</strong> Telegram Bot Token, Telegram Chat ID, and message transcripts exchanged via the bot.</li>
                  <li><strong>WhatsApp:</strong> Phone ID, recipient phone number, and message payloads.</li>
                </ul>
              </li>
              <li>
                <strong className="text-[var(--text)]">Operational Context &amp; Memory:</strong> Task descriptions, reminders, user facts explicitly remembered by the assistant, daily digest entries, and complete audit trail logs of executed steps.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3 p-5 rounded-2xl bg-[var(--panel)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-[var(--accent)] font-semibold text-base">
              <Lock size={18} />
              <h2 className="font-editorial text-xl font-semibold text-[var(--text)]">3. Google API Services &amp; Limited Use Disclosure</h2>
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Elio&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--text)] text-[var(--accent)]"
              >
                Google API Services User Data Policy
              </a>
              , including the <strong>Limited Use</strong> requirements:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-[var(--muted)]">
              <li>
                <strong>No AI Model Training:</strong> We never use your Google Workspace data (Gmail, Google Calendar) to train, retrain, or improve generalized foundation AI or machine learning models.
              </li>
              <li>
                <strong>No Advertising or Resale:</strong> Your Google data is never transferred, rented, or sold to third parties, data brokers, or advertising networks under any circumstances.
              </li>
              <li>
                <strong>Strict Purpose Limitation:</strong> Google user data is accessed solely to provide user-facing agent capabilities explicitly commanded by you (such as summarizing emails from a specific sender, creating calendar reservations you requested, or generating morning briefings).
              </li>
              <li>
                <strong>Human Access Restrictions:</strong> Human beings never read your emails or calendar data, unless you explicitly approve a specific text in the Sentinel approval modal, or as strictly required for security or legal compliance.
              </li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">4. Security Architecture &amp; Local Cryptography</h2>
            <p className="text-[var(--muted)]">
              Elio employs defense-in-depth principles to protect your sensitive credentials:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
                <div className="flex items-center gap-2 font-semibold text-xs mb-1 text-[var(--text)]">
                  <Key size={14} className="text-[var(--accent)]" />
                  <span>AES-256-GCM Vault</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  All OAuth refresh tokens and API credentials are encrypted at rest with authenticated AES-256-GCM using your dedicated server-side secret.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
                <div className="flex items-center gap-2 font-semibold text-xs mb-1 text-[var(--text)]">
                  <Eye size={14} className="text-[var(--accent)]" />
                  <span>Surrogate Tokenization</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  AI language models never see raw credentials or tokens. Secret identifiers are surrogated (&lbrace;&lbrace;vault:...&rbrace;&rbrace;) and resolved only inside sandboxed connectors.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
                <div className="flex items-center gap-2 font-semibold text-xs mb-1 text-[var(--text)]">
                  <Shield size={14} className="text-[var(--accent)]" />
                  <span>Sentinel Gatekeeper</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  High-risk actions (spending money, deleting emails, or making permanent calendar modifications) automatically pause for your explicit confirmation.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
                <div className="flex items-center gap-2 font-semibold text-xs mb-1 text-[var(--text)]">
                  <Server size={14} className="text-[var(--accent)]" />
                  <span>Self-Hosted &amp; Private</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Your data resides in your own dedicated database instance. We do not aggregate multi-tenant data into centralized lakes.
                </p>
              </div>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">5. Third-Party AI Subprocessors</h2>
            <p className="text-[var(--muted)]">
              To understand language, reason through tasks, and synthesize summaries, Elio communicates with your designated Large Language Model (LLM) API provider (such as Google Gemini, CleanAPIs, Groq, or OpenRouter).
            </p>
            <p className="text-[var(--muted)]">
              When a query is dispatched, only the relevant conversational context, tool responses, and task goal are transmitted. Sensitive vault credentials are redacted prior to network egress. Data shared with LLM providers is governed by their respective API enterprise terms (which explicitly forbid using API inputs for model training).
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">6. Your Rights &amp; Data Control</h2>
            <p className="text-[var(--muted)]">
              You maintain uncompromised control over your data at all times:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-[var(--muted)]">
              <li>
                <strong>Instant Disconnect:</strong> You may revoke any OAuth grant (Gmail, Google Calendar) or messaging channel (Telegram, WhatsApp) at any time from the <em>Connectors</em> page. Revocation permanently wipes stored access and refresh tokens.
              </li>
              <li>
                <strong>Memory Purging:</strong> You can review, search, and delete individual learned memories or clear the entire memory index from the <em>Memory</em> page.
              </li>
              <li>
                <strong>Audit Inspection:</strong> Every step taken by Elio is recorded immutably in the <em>Audit</em> trail for your inspection.
              </li>
              <li>
                <strong>Account Deletion:</strong> You can request full deletion of your database records, sessions, and operational logs at any time.
              </li>
            </ul>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">7. Updates to This Policy</h2>
            <p className="text-[var(--muted)]">
              We may update this Privacy Policy periodically to reflect updates to our features or regulatory requirements. Any modifications will be reflected with a revised &ldquo;Last updated&rdquo; timestamp at the top of this document.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3 pt-4 border-t border-[var(--border)]">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">8. Contact Us</h2>
            <p className="text-[var(--muted)]">
              If you have any questions, feedback, or privacy-related inquiries regarding Elio, please open an issue in your deployment repository or contact your workspace administrator.
            </p>
          </section>
        </div>

        {/* Bottom Nav */}
        <div className="mt-12 pt-6 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--muted)]">
          <Link href="/terms" className="hover:text-[var(--text)] transition-colors">
            Terms of Service &rarr;
          </Link>
          <Link href="/" className="hover:text-[var(--text)] transition-colors">
            Return to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

