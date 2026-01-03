import { NextResponse } from "next/server";

function siteUrl() {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  return (env || "https://www.seisanryoku.jp").replace(/\/$/, "");
}

export async function GET() {
  const base = siteUrl();
  const body = [
    "User-agent: *",
    // デフォルトは全てブロックし、SEO対象だけ許可
    "Disallow: /",
    "Allow: /$",
    "Allow: /help",
    "Allow: /help/",
    "Allow: /releases",
    "Allow: /releases/",
    "Allow: /sitemap.xml",
    "Allow: /robots.txt",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // 明示的にキャッシュ（環境に応じて調整）
      "Cache-Control": "public, max-age=3600",
    },
  });
}


