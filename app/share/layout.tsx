import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "共有 | 生産力 (Seisanryoku)",
  description: "共有ページ",
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

