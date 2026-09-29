"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";

const PUBLIC_PAGES = ["/landing", "/login", "/signup", "/privacy", "/terms"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isPublic = PUBLIC_PAGES.some((p) => pathname.startsWith(p));

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // While the drawer is open, prevent the background from scrolling on touch.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  if (isPublic) {
    return <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">{children}</main>;
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      {/* Mobile top bar (hidden on desktop) */}
      <header
        className="md:hidden shrink-0 h-14 border-b border-[var(--border)] bg-[var(--bg)] flex items-center gap-2 px-3 z-40"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          className="p-2.5 -ml-1 rounded-lg text-[var(--text)] hover:bg-[#EBE8DF] active:bg-[#E2DDD3] transition-colors cursor-pointer"
        >
          <Menu size={22} />
        </button>
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <Image
            src="/elio-icon.png"
            alt=""
            width={28}
            height={28}
            className="rounded-lg shrink-0"
          />
          <span className="font-editorial text-sm font-bold tracking-[0.18em] text-[var(--text)]">
            ELIO
          </span>
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar (unchanged) */}
        <aside className="hidden md:flex w-[230px] shrink-0 border-r border-[var(--border)] flex-col p-4 bg-[var(--bg)]">
          <SidebarNav />
        </aside>

        {/* Mobile drawer */}
        <div
          className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
            drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            className={`absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-[var(--bg)] border-r border-[var(--border)] p-4 pb-safe shadow-2xl transition-transform duration-200 ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}
          >
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-3 right-3 p-2 rounded-lg text-[var(--muted)] hover:bg-[#EBE8DF] cursor-pointer"
              style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
            >
              <X size={18} />
            </button>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>

        <main className="flex-1 overflow-hidden bg-[var(--bg)] flex flex-col min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
