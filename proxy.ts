import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "crm.sof10.net";

function isLocalHost(host: string) {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");
}

/** Infrastructure hostnames that should never trigger a redirect (prevents loops) */
function isInfraHost(hostname: string) {
  return (
    hostname.endsWith(".run.app") ||
    hostname.endsWith(".cloudfunctions.net") ||
    hostname.endsWith(".appspot.com")
  );
}

function extractHostname(header: string | null): string | null {
  if (!header) return null;
  const h = header.split(":")[0]?.toLowerCase();
  return h || null;
}

export function proxy(req: NextRequest) {
  // On Firebase Hosting (frameworks), the `Host` header is the Cloud Run service
  // hostname, NOT the hostname the user's browser used. We must prefer the
  // forwarded headers that carry the original client-facing hostname.
  const forwardedHostname =
    extractHostname(req.headers.get("x-fh-requested-host")) ??
    extractHostname(req.headers.get("x-forwarded-host"));

  const rawHostname = extractHostname(req.headers.get("host"));

  // Use the forwarded hostname if available; otherwise fall back to Host header.
  const hostname = forwardedHostname ?? rawHostname;
  if (!hostname || isLocalHost(hostname)) return NextResponse.next();

  // CRITICAL: Never redirect infrastructure-internal hostnames.
  // When Firebase Hosting forwards to Cloud Run, the Host header is the Cloud Run
  // service URL (e.g. xxx.run.app). If x-fh-requested-host isn't set, we'd
  // redirect to crm.sof10.net, which Firebase routes back here → infinite loop.
  if (isInfraHost(hostname)) return NextResponse.next();

  // Redirect non-canonical hostnames to the canonical domain.
  if (hostname !== CANONICAL_HOST) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.hostname = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude Next.js internals and static assets
    "/((?!_next/|favicon.ico|robots.txt|sitemap.xml|assets/|images/).*)",
  ],
};

