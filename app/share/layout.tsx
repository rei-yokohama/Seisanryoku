import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "課題共有 | 生産力 (Seisanryoku)",
  description: "課題の共有ページ",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ShareLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}

