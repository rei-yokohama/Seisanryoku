import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "www.seisanryoku.jp";

function isLocalHost(host?: string | null) {
  if (!host) return false;
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  if (!host || isLocalHost(host)) return NextResponse.next();

  // Force canonical host to avoid duplicate URLs in Search Console.
  if (host !== CANONICAL_HOST) {
    const url = new URL(req.url);
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude Next.js internals and static assets
    "/((?!_next/|favicon.ico|robots.txt|sitemap.xml|assets/|images/).*)",
  ],
};


