import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "www.seisanryoku.jp";

function isLocalHost(host?: string | null) {
  if (!host) return false;
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");
}

export function middleware(req: NextRequest) {
  // On Firebase Hosting (frameworks), the incoming `Host` header can be the Cloud Run service host.
  // Prefer the original requested host forwarded by the proxy.
  const hostHeader =
    req.headers.get("x-fh-requested-host") ??
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host");
  if (!hostHeader) return NextResponse.next();

  // `Host` header can include a port (e.g. "www.example.com:8080") depending on the proxy.
  const hostname = hostHeader.split(":")[0]?.toLowerCase();
  if (!hostname || isLocalHost(hostname)) return NextResponse.next();

  // Force canonical host to avoid duplicate URLs in Search Console.
  // Only redirect when hostname differs. (Some proxies may include an internal port in Host;
  // trying to "strip" it here can cause redirect loops.)
  if (hostname !== CANONICAL_HOST) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.hostname = CANONICAL_HOST;
    url.port = "";
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


