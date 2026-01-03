import type { Metadata } from "next";
import { HelpShell } from "./help-shell";

export const metadata: Metadata = {
  title: "ヘルプ | 生産力",
  description: "生産力（Seisanryoku）の使い方をまとめたヘルプセンターです。",
  alternates: {
    canonical: "https://www.seisanryoku.jp/help",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <HelpShell>{children}</HelpShell>;
}


