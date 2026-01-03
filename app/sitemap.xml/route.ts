import { NextResponse } from "next/server";

function siteUrl() {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  return (env || "http://localhost:3000").replace(/\/$/, "");
}

export async function GET() {
  const base = siteUrl();
  const now = new Date().toISOString();

  const paths = [
    "/releases",
    "/help",
    "/help/getting-started",
    "/help/issues",
    "/help/wiki",
    "/help/drive",
    "/help/workspace",
  ];

  const urls = paths
    .map((p) => {
      const loc = `${base}${p}`;
      return [
        "  <url>",
        `    <loc>${loc}</loc>`,
        `    <lastmod>${now}</lastmod>`,
        "    <changefreq>weekly</changefreq>",
        "    <priority>0.7</priority>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}


