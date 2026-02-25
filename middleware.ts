import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CANONICAL_HOST = "crm.sof10.net";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  if (host !== CANONICAL_HOST) {
    const url = new URL(request.url);
    url.hostname = CANONICAL_HOST;
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url.toString(), 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
