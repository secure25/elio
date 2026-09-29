import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/landing",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
  "/api/auth",
  "/api/oauth",
  // Telegram's servers POST here (no session cookie exists for them). The
  // route authenticates itself via the x-telegram-bot-api-secret-token header
  // when TELEGRAM_WEBHOOK_SECRET is set.
  "/api/telegram/webhook",
  "/_next",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/elio-icon.png",
  "/elio-logo.png",
  "/elio-icon.png",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths, static assets, and API auth/oauth routes
  if (
    PUBLIC_PATHS.some((path) => pathname.startsWith(path)) ||
    /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionToken = request.cookies.get("elio_session")?.value;

  if (!sessionToken) {
    // If request is an API call, return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Otherwise redirect to landing page
    const url = request.nextUrl.clone();
    url.pathname = "/landing";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images, png, svg, etc.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

