"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
      } else {
        setSent(true);
        if (data.hint) setHint(data.hint);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-editorial text-2xl font-semibold text-[var(--text)]">Reset your password</h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            Enter the email you registered with and we&apos;ll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] text-center">
            <Mail className="w-8 h-8 mx-auto text-[var(--accent)] mb-3" />
            <p className="text-sm text-[var(--text)]">
              If that email is connected in Elio, a reset link is on its way. It expires in 30 minutes.
            </p>
            {hint && <p className="text-xs text-[var(--muted)] mt-3">{hint}</p>}
            <Link href="/login" className="btn text-xs py-2 px-4 inline-block mt-5">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button type="submit" disabled={busy} className="btn w-full py-2.5 text-sm disabled:opacity-50">
              {busy ? "Sending…" : "Send reset link"}
            </button>

            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
