"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, FileText, CheckCircle2, ShieldAlert, Cpu, Scale } from "lucide-react";

export default function TermsOfServicePage() {
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
            <Scale size={13} />
            <span>Legal Agreement</span>
          </div>
          <h1 className="font-editorial text-4xl sm:text-5xl font-bold text-[var(--text)] tracking-tight mb-2">
            Terms of Service
          </h1>
          <p className="text-xs text-[var(--muted)]">Last updated: {lastUpdated}</p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[var(--text)]">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">1. Acceptance of Terms</h2>
            <p className="text-[var(--muted)]">
              Welcome to Elio. By creating an account, accessing, or using the Elio platform, application, connectors, or services (collectively, the &ldquo;Service&rdquo;), you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, you may not access or use the Service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">2. Description of the Service</h2>
            <p className="text-[var(--muted)]">
              Elio is a self-hosted or dedicated personal AI agent and operations workspace. The Service provides autonomous errand planning, web research, email drafting and summarization, calendar management, and multi-channel notification services via Telegram, WhatsApp, and the web app interface.
            </p>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">3. User Accounts &amp; Security Responsibility</h2>
            <p className="text-[var(--muted)]">
              To use Elio, you must maintain an authenticated workspace account. You agree that:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-[var(--muted)]">
              <li>You are responsible for safeguarding your login credentials and the cryptographic master secret (<code>VAULT_SECRET</code>) that protects your local credential store.</li>
              <li>You must notify us immediately of any unauthorized access or security breach involving your instance.</li>
              <li>You are responsible for all actions, API requests, and commands initiated through your account or authorized chat sessions.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3 p-5 rounded-2xl bg-[var(--panel)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-[var(--accent)] font-semibold text-base">
              <Cpu size={18} />
              <h2 className="font-editorial text-xl font-semibold text-[var(--text)]">4. Autonomous Agent Operations &amp; Sentinel Approvals</h2>
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Elio executes tasks using autonomous reasoning, browser automation, and connected API tools. You understand and acknowledge the following operational principles:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs text-[var(--muted)]">
              <li>
                <strong className="text-[var(--text)]">Probabilistic AI Nature:</strong> The Service generates responses using Large Language Models. While Elio strives for precision, AI-generated content may occasionally contain factual errors, misinterpretations, or outdated references. You are encouraged to review task summaries.
              </li>
              <li>
                <strong className="text-[var(--text)]">Human-in-the-Loop Sentinel:</strong> Critical, sensitive, or irreversible actions (including monetary transactions, permanent email deletion, and destructive web form submits) pause automatically in the Sentinel queue for your explicit human confirmation. You retain full agency over whether to approve or deny these actions.
              </li>
              <li>
                <strong className="text-[var(--text)]">User-Instructed Communications:</strong> When you explicitly instruct Elio to send messages, reminders, or briefs to your connected phone or messaging accounts (such as Telegram or WhatsApp), Elio will deliver those messages directly to your connected channels based on your explicit command.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">5. Third-Party Integrations &amp; Connectors</h2>
            <p className="text-[var(--muted)]">
              The Service allows you to connect third-party platforms (including Google Workspace, Telegram, Meta/WhatsApp, and public web endpoints). You acknowledge that:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-[var(--muted)]">
              <li>Your use of third-party platforms is governed by their respective terms of service and privacy policies.</li>
              <li>Elio accesses third-party APIs solely under the scopes and permissions you explicitly authorize via OAuth or by supplying your bot/API tokens.</li>
              <li>We are not responsible for downtime, rate-limiting, account suspensions, or changes enacted by third-party providers.</li>
            </ul>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">6. Acceptable Use Policy</h2>
            <p className="text-[var(--muted)]">
              You agree not to use Elio for any prohibited purpose, including:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-[var(--muted)]">
              <li>Violating any applicable local, state, national, or international laws or regulations.</li>
              <li>Deploying automated spam, unsolicited commercial messages, or phishing communications.</li>
              <li>Engaging in denial-of-service attacks, automated credential harvesting, or security vulnerability probing of external networks without authorization.</li>
              <li>Infringing upon intellectual property, privacy, or proprietary rights of any third party.</li>
            </ul>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">7. Disclaimers &amp; Limitation of Liability</h2>
            <p className="text-[var(--muted)] uppercase text-xs tracking-wider font-semibold">
              PLEASE READ THIS SECTION CAREFULLY
            </p>
            <p className="text-[var(--muted)]">
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p className="text-[var(--muted)]">
              IN NO EVENT SHALL ELIO, ITS AUTHORS, CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM: (I) YOUR USE OF OR INABILITY TO USE THE SERVICE; (II) ACTIONS TAKEN BY THE AUTONOMOUS AGENT PURSUANT TO YOUR PROMPTS; OR (III) UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR TRANSMISSIONS OR DATA.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">8. Termination</h2>
            <p className="text-[var(--muted)]">
              You may terminate your use of Elio at any time by stopping your deployment or deleting your account data and connected credentials. We reserve the right to suspend or discontinue the software or services in the event of material violation of these Terms.
            </p>
          </section>

          {/* Section 9 */}
          <section className="space-y-3">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">9. Changes to Terms</h2>
            <p className="text-[var(--muted)]">
              We reserve the right to modify these Terms at any time. Any changes will be posted to this page with an updated &ldquo;Last updated&rdquo; timestamp. Continued use of the Service following such revisions constitutes acceptance of the amended Terms.
            </p>
          </section>

          {/* Section 10 */}
          <section className="space-y-3 pt-4 border-t border-[var(--border)]">
            <h2 className="font-editorial text-2xl font-semibold text-[var(--text)]">10. Contact Information</h2>
            <p className="text-[var(--muted)]">
              For any questions regarding these Terms of Service, please contact the Elio development and administration team via your deployment repository or support channels.
            </p>
          </section>
        </div>

        {/* Bottom Nav */}
        <div className="mt-12 pt-6 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--muted)]">
          <Link href="/privacy" className="hover:text-[var(--text)] transition-colors">
            &larr; Privacy Policy
          </Link>
          <Link href="/" className="hover:text-[var(--text)] transition-colors">
            Return to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

