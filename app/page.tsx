import type { Metadata } from "next";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "生産力 | 工数・課題・Wiki・ドライブをワークスペースで統合",
  description:
    "工数カレンダー、課題、Wiki、ドライブ、顧客/案件をひとつに統合。ワークスペースごとにデータを完全分離し、安全で迷わない運用を実現します。",
  alternates: {
    canonical: "https://www.seisanryoku.jp/",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function Page() {
  return <LandingClient />;
}
