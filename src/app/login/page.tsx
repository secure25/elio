"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Mail, AlertCircle, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col justify-center items-center px-6 py-12 selection:bg-[#E2DDD3]">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <Link href="/landing" className="inline-flex items-center gap-3 mb-4 group">
            <Image
              src="/elio-icon.png"
              alt="Elio"
              width={40}
              height={40}
              className="rounded-xl group-hover:opacity-90 transition-opacity"
            />
            <span className="font-editorial text-2xl font-bold tracking-[0.2em] text-[var(--text)]">
              ELIO
            </span>
          </Link>
          <h2 className="font-editorial text-2xl font-medium text-[var(--text)]">
            Welcome back
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Sign in to access your personal agent workspace
          </p>
        </div>

        {/* Card */}
        <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-[var(--radius-md)] p-8 shadow-sm">
          {error && (
            <div className="mb-6 p-3 rounded-[var(--radius-sm)] bg-[#FDF2F0] border border-[#F5C6CB] text-[#9A3412] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-muted)]">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-[var(--accent)] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[var(--action)] text-white text-sm font-medium rounded-[var(--radius-sm)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-xs mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--border)] text-center">
            <p className="text-xs text-[var(--text-muted)]">
              Don't have an account yet?{" "}
              <Link href="/signup" className="text-[var(--action)] font-medium hover:underline">
                Create one now
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-5 text-xs text-[var(--text-muted)]">
          <Link href="/privacy" className="hover:text-[var(--text)] transition-colors">
            Privacy Policy
          </Link>
          <span>•</span>
          <Link href="/terms" className="hover:text-[var(--text)] transition-colors">
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  );
}

