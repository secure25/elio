"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = params.get("token");
    if (t) setToken(t);
  }, [params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Missing reset token — open the link from your email.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Reset failed.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
          New password
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="password"
            required
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
          Confirm new password
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="password"
            required
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat it"
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button type="submit" disabled={busy} className="btn w-full py-2.5 text-sm disabled:opacity-50">
        {busy ? "Saving…" : "Set new password"}
      </button>
      <p className="text-[11px] text-[var(--muted)] text-center">
        Setting a new password signs you in on this device and signs out everywhere else.
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-editorial text-2xl font-semibold text-[var(--text)]">Choose a new password</h1>
        </div>
        <Suspense fallback={<p className="text-center text-sm text-[var(--muted)]">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
