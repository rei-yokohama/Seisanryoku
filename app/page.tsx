"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/navigation";

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="group rounded-3xl border border-slate-200 bg-white p-8 shadow-sm transition hover:border-orange-300 hover:shadow-xl">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-3xl group-hover:scale-110 transition">
        {icon}
      </div>
      <h3 className="mb-2 text-xl font-extrabold text-slate-900">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

export default function LandingPage() {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setLoading(false);
      if (u) {
        router.push("/dashboard");
      }
    });
    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-2xl font-bold text-orange-600 animate-pulse">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-orange-100 selection:text-orange-900">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white font-black text-xl shadow-orange-200 shadow-lg">
              P
            </div>
            <div className="hidden sm:block">
              <p className="text-lg font-black tracking-tighter text-slate-900">生産力</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Seisanryoku</p>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-extrabold text-slate-600 hover:text-orange-600 transition"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-extrabold text-white shadow-lg transition hover:bg-orange-600 hover:shadow-orange-200 active:scale-95"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 pt-20 pb-32 lg:pt-32">
        <div className="absolute top-0 left-1/2 -z-10 h-[600px] w-[1000px] -translate-x-1/2 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-100/40 via-transparent to-transparent blur-3xl"></div>
        
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-black text-orange-700 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <span className="flex h-2 w-2 rounded-full bg-orange-500 animate-ping"></span>
            Next Generation Productivity SaaS
          </div>
          
          <h1 className="mb-8 text-5xl font-black tracking-tight text-slate-900 sm:text-7xl lg:text-8xl leading-[1.1] animate-in fade-in slide-in-from-bottom-6 duration-1000">
            チームの工数を、<br />
            <span className="bg-gradient-to-r from-orange-600 to-amber-500 bg-clip-text text-transparent">
              成果に変える。
            </span>
          </h1>
          
          <p className="mx-auto mb-12 max-w-2xl text-lg font-bold leading-relaxed text-slate-600 sm:text-xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200">
            工数カレンダー、Wiki、ドライブ、CRMを統合。<br className="hidden sm:block" />
            ワークスペースごとにデータを完全分離し、安全で効率的なプロジェクト運営を。
          </p>
          
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-300">
            <Link
              href="/signup"
              className="w-full sm:w-auto rounded-2xl bg-orange-600 px-10 py-5 text-lg font-black text-white shadow-2xl shadow-orange-200 transition hover:bg-orange-700 hover:-translate-y-1 active:scale-95"
            >
              今すぐ無料で始める
            </Link>
            <Link
              href="/help"
              className="w-full sm:w-auto rounded-2xl border-2 border-slate-200 bg-white px-10 py-5 text-lg font-black text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
            >
              ヘルプを見る
            </Link>
          </div>
          
          <div className="mt-12 flex items-center justify-center gap-6 text-xs font-black text-slate-400">
            <span className="flex items-center gap-1.5 italic">✓ NO CREDIT CARD</span>
            <span className="flex items-center gap-1.5 italic">✓ FAST SETUP</span>
            <span className="flex items-center gap-1.5 italic">✓ STRICT ISOLATION</span>
          </div>
        </div>
      </section>

      {/* Feature Highlights Section */}
      <section id="features" className="bg-white py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-20 max-w-2xl">
            <h2 className="text-base font-black uppercase tracking-widest text-orange-600">Core Features</h2>
            <p className="mt-4 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              運用の“迷子”をなくす、<br />統合型の工数管理
            </p>
          </div>
          
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard 
              icon="📅"
              title="工数カレンダー"
              description="日々の予定を工数エントリとして管理。ドラッグ＆ドロップや繰り返し予定にも対応した高品質なUI。"
            />
            <FeatureCard 
              icon="🧩"
              title="ワークスペース分離"
              description="複数の事業やプロジェクトを「ワークスペース」として管理。データは完全に分離され、ワンクリックで切替可能。"
            />
            <FeatureCard 
              icon="💼"
              title="HubSpot風CRM"
              description="顧客と案件をシームレスに管理。すべての課題、Wiki、ファイルが特定の「顧客×案件」に自動で紐づきます。"
            />
            <FeatureCard 
              icon="📚"
              title="Wiki & ドライブ"
              description="プロジェクトのナレッジとファイルを一箇所に。作成者や紐づきがひと目でわかる一覧UIで情報を資産化。"
            />
          </div>
        </div>
      </section>

      {/* Latest Updates Section (from Release Notes) */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-end justify-between gap-4 border-b border-slate-200 pb-8 sm:flex-row">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">最新のアップデート</h2>
              <p className="mt-2 text-slate-600 font-bold">ユーザーの声を反映し、日々進化しています。</p>
            </div>
            <Link href="/releases" className="text-sm font-black text-orange-600 hover:underline">
              すべてのリリースノートを見る →
            </Link>
          </div>
          
          <div className="mt-12 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:shadow-md">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">2026-01-03</span>
                <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">MAJOR UPDATE</span>
              </div>
              <h3 className="text-lg font-black text-slate-900">ワークスペース作成/切替機能のリリース</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                事業ごとにデータを完全に分離できるワークスペース機能を追加。権限管理を強化し、セキュアな多事業運営が可能になりました。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:shadow-md">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">2026-01-02</span>
                <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-700">EXPERIENCE</span>
              </div>
              <h3 className="text-lg font-black text-slate-900">カレンダー操作感の大幅改善</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                ドラッグ＆ドロップでの予定移動、繰り返し予定の設定に対応。直感的に入力できる操作体験を実現しました。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-slate-900 px-8 py-20 text-center shadow-2xl">
          <div className="absolute top-0 left-0 -z-10 h-full w-full opacity-20 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-500 via-transparent to-transparent"></div>
          
          <h2 className="mb-6 text-4xl font-black tracking-tight text-white sm:text-6xl">
            今日から、もっと生産的なチームへ。
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg font-bold text-slate-400 leading-relaxed">
            たった30秒でセットアップ完了。煩雑な工数管理から解放され、本来の業務に集中しましょう。
          </p>
          
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="w-full sm:w-auto rounded-2xl bg-orange-600 px-12 py-5 text-xl font-black text-white shadow-xl shadow-orange-900/20 transition hover:bg-orange-500 hover:-translate-y-1 active:scale-95"
            >
              無料で始める
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto rounded-2xl bg-white/10 px-12 py-5 text-xl font-black text-white backdrop-blur-md transition hover:bg-white/20 active:scale-95"
            >
              ログイン
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white pt-16 pb-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-12 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            <div className="col-span-2">
              <Link href="/" className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white font-black text-base">
                  P
                </div>
                <span className="text-xl font-black tracking-tighter text-slate-900">生産力</span>
              </Link>
              <p className="mt-4 max-w-xs text-sm font-bold text-slate-500 leading-relaxed">
                チームの工数を成果に変える、統合型プロダクティビティ・プラットフォーム。
              </p>
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-900 mb-4">Product</h4>
              <ul className="space-y-2 text-sm font-bold text-slate-500">
                <li><Link href="#features" className="hover:text-orange-600 transition">機能一覧</Link></li>
                <li><Link href="/releases" className="hover:text-orange-600 transition">リリースノート</Link></li>
                <li><Link href="/help" className="hover:text-orange-600 transition">ヘルプセンター</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-900 mb-4">Support</h4>
              <ul className="space-y-2 text-sm font-bold text-slate-500">
                <li><Link href="/sitemap.xml" className="hover:text-orange-600 transition">サイトマップ</Link></li>
                <li><Link href="/robots.txt" className="hover:text-orange-600 transition">robots.txt</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-900 mb-4">Login</h4>
              <ul className="space-y-2 text-sm font-bold text-slate-500">
                <li><Link href="/login" className="hover:text-orange-600 transition">管理者ログイン</Link></li>
                <li><Link href="/login" className="hover:text-orange-600 transition">社員ログイン</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-16 border-t border-slate-100 pt-8 flex flex-col sm:flex-row justify-between gap-4">
            <p className="text-xs font-bold text-slate-400 tracking-wider">
              © 2026 Seisanryoku. All rights reserved.
            </p>
            <div className="flex gap-6">
              <Link href="#" className="text-xs font-bold text-slate-400 hover:text-slate-600 underline decoration-slate-200 underline-offset-4">利用規約</Link>
              <Link href="#" className="text-xs font-bold text-slate-400 hover:text-slate-600 underline decoration-slate-200 underline-offset-4">プライバシーポリシー</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
