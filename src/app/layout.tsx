import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "./app-shell";

export const metadata: Metadata = {
  title: "Elio — Personal Agent",
  description: "A calm, intelligent operations workspace for personal agency",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/elio-icon.png",
    apple: "/elio-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Elio",
  },
};

// Mobile-first: proper scaling, notch safe areas, and browser-chrome color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // prevent double-tap-zoom jitter in the chat composer
  viewportFit: "cover",
  themeColor: "#F7F5F0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-[var(--bg)] text-[var(--text)] selection:bg-[#E2DDD3]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
