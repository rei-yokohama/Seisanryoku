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

function MenuCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-orange-300 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-lg group-hover:bg-orange-50 transition">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-900">{title}</div>
          <div className="mt-1 text-xs font-bold leading-relaxed text-slate-600">{description}</div>
        </div>
      </div>
    </div>
  );
}

export default function LandingClient() {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setLoading(false);
      if (u) router.push("/dashboard");
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
          <div className="hidden items-center gap-6 text-sm font-extrabold text-slate-600 md:flex">
            <Link href="#capabilities" className="hover:text-orange-600 transition">できること</Link>
            <Link href="#features" className="hover:text-orange-600 transition">特長</Link>
            <Link href="/help" className="hover:text-orange-600 transition">ヘルプ</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-extrabold text-slate-600 hover:text-orange-600 transition">
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
      <section className="relative overflow-hidden px-6 pt-20 pb-24 lg:pt-28">
        <div className="absolute top-0 left-1/2 -z-10 h-[600px] w-[1000px] -translate-x-1/2 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-100/40 via-transparent to-transparent blur-3xl" />

        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-black text-orange-700 mb-8">
            <span className="flex h-2 w-2 rounded-full bg-orange-500" />
            Workspace-first Productivity Platform
          </div>

          <h1 className="mb-8 text-5xl font-black tracking-tight text-slate-900 sm:text-7xl lg:text-8xl leading-[1.1]">
            チームの工数を、<br />
            <span className="bg-gradient-to-r from-orange-600 to-amber-500 bg-clip-text text-transparent">成果に変える。</span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg font-bold leading-relaxed text-slate-600 sm:text-xl">
            工数カレンダー、課題、Wiki、ドライブ、顧客/案件をひとつに。<br className="hidden sm:block" />
            ワークスペースごとにデータを完全分離し、安全で迷わない運用を実現します。
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/signup" className="w-full sm:w-auto rounded-2xl bg-orange-600 px-10 py-5 text-lg font-black text-white shadow-2xl shadow-orange-200 transition hover:bg-orange-700 hover:-translate-y-1 active:scale-95">
              今すぐ無料で始める
            </Link>
            <Link href="/help" className="w-full sm:w-auto rounded-2xl border-2 border-slate-200 bg-white px-10 py-5 text-lg font-black text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 active:scale-95">
              ヘルプを見る
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-3 text-left sm:grid-cols-3 sm:gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black text-slate-500">運用の軸</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">顧客 × 案件 × 課題</div>
              <div className="mt-1 text-xs font-bold text-slate-600">すべての情報が自然に紐づくので迷いません。</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black text-slate-500">工数の見える化</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">カレンダーで即入力</div>
              <div className="mt-1 text-xs font-bold text-slate-600">登録/編集が早いので記録が続きます。</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black text-slate-500">セキュリティ</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">ワークスペース分離</div>
              <div className="mt-1 text-xs font-bold text-slate-600">事業ごとのデータを完全に分離します。</div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities (based on global menu) */}
      <section id="capabilities" className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <div className="text-sm font-black uppercase tracking-widest text-orange-600">Global Menu</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                できることが、一目で分かる
              </h2>
              <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
                左のグローバルメニューを軸に、情報が分散しない運用を作ります。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/signup"
                className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-700 active:scale-95"
              >
                無料で始める
              </Link>
              <Link
                href="/login"
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 active:scale-95"
              >
                ログイン
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MenuCard icon="🏠" title="ダッシュボード" description="今日やること、通知、進捗の入口。チームの状況を俯瞰できます。" />
            <MenuCard icon="📋" title="課題" description="タスクの作成・担当・ステータス管理。案件と紐づいて流れが途切れません。" />
            <MenuCard icon="📚" title="Wiki" description="ナレッジをタブで整理。会議メモ・手順・要件を一箇所に集約。" />
            <MenuCard icon="👥" title="顧客" description="顧客情報と稼働状況を管理。案件の入口として迷いが減ります。" />
            <MenuCard icon="💼" title="案件" description="稼働/停止や売上など運用に必要な情報を管理。担当者別の把握も。" />
            <MenuCard icon="💴" title="収支" description="メンバー×月の収支を集計。コスト/売上は手動編集にも対応。" />
            <MenuCard icon="💾" title="ドライブ" description="案件/顧客に紐づくファイルを管理。チーム共有がスムーズに。" />
            <MenuCard icon="📅" title="カレンダー" description="工数入力を日々の習慣に。見積もりと実績の差分が見えます。" />
            <MenuCard icon="⚙️" title="設定" description="メンバー管理・権限・ワークスペース設定など運用面を整備。" />
          </div>
        </div>
      </section>

      {/* Feature Highlights Section */}
      <section id="features" className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 max-w-2xl">
            <h2 className="text-base font-black uppercase tracking-widest text-orange-600">Core Features</h2>
            <p className="mt-4 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              運用の“迷子”をなくす、<br />統合型の工数管理
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard icon="📅" title="工数カレンダー" description="日々の予定を工数として登録・編集。ドラッグ＆ドロップや繰り返し予定にも対応。" />
            <FeatureCard icon="🧩" title="ワークスペース分離" description="複数事業をワークスペースで分離。切替もスムーズで、データが混ざりません。" />
            <FeatureCard icon="💼" title="顧客/案件管理" description="顧客と案件を整理し、課題・Wiki・ファイルを「顧客×案件」に集約します。" />
            <FeatureCard icon="📚" title="Wiki & ドライブ" description="ナレッジとファイルを一箇所に。作成者/紐づきが見えるので情報が資産になります。" />
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-slate-50 p-8">
            <div className="text-sm font-extrabold text-slate-900">導入の流れ（最短30秒）</div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-white p-5 border border-slate-200">
                <div className="text-xs font-black text-slate-500">STEP 1</div>
                <div className="mt-1 text-sm font-extrabold text-slate-900">ワークスペース作成</div>
                <div className="mt-1 text-xs font-bold text-slate-600">社名・電話番号・氏名を入力して開始。</div>
              </div>
              <div className="rounded-2xl bg-white p-5 border border-slate-200">
                <div className="text-xs font-black text-slate-500">STEP 2</div>
                <div className="mt-1 text-sm font-extrabold text-slate-900">顧客/案件を登録</div>
                <div className="mt-1 text-xs font-bold text-slate-600">運用の軸を作るだけで整理が進みます。</div>
              </div>
              <div className="rounded-2xl bg-white p-5 border border-slate-200">
                <div className="text-xs font-black text-slate-500">STEP 3</div>
                <div className="mt-1 text-sm font-extrabold text-slate-900">課題→工数を記録</div>
                <div className="mt-1 text-xs font-bold text-slate-600">記録→見える化→改善が回り出します。</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Latest Updates Section */}
      <section className="py-20 sm:py-28">
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

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:shadow-md">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">2026-01-03</span>
                <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">MAJOR</span>
              </div>
              <h3 className="text-lg font-black text-slate-900">ワークスペース作成/切替・権限強化</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                事業ごとにデータを完全分離。切替や権限設定も管理画面で運用できるようになりました。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:shadow-md">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">2026-01-02</span>
                <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-700">UX</span>
              </div>
              <h3 className="text-lg font-black text-slate-900">カレンダー操作感の大幅改善</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                予定の編集、繰り返し、ドラッグ&ドロップ移動、ゲスト招待など、日々の入力が速くなりました。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-slate-900 px-8 py-16 text-center shadow-2xl">
          <div className="absolute top-0 left-0 -z-10 h-full w-full opacity-20 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-500 via-transparent to-transparent" />

          <h2 className="mb-4 text-4xl font-black tracking-tight text-white sm:text-6xl">今日から、もっと生産的なチームへ。</h2>
          <p className="mx-auto mb-8 max-w-xl text-lg font-bold text-slate-400 leading-relaxed">
            まずはワークスペースを作成して、顧客/案件/課題をひとつに整理しましょう。
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/signup" className="w-full sm:w-auto rounded-2xl bg-orange-600 px-12 py-5 text-xl font-black text-white shadow-xl shadow-orange-900/20 transition hover:bg-orange-500 hover:-translate-y-1 active:scale-95">
              無料で始める
            </Link>
            <Link href="/help" className="w-full sm:w-auto rounded-2xl bg-white/10 px-12 py-5 text-xl font-black text-white backdrop-blur-md transition hover:bg-white/20 active:scale-95">
              使い方を見る
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white pt-14 pb-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-12 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            <div className="col-span-2">
              <Link href="/" className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white font-black text-base">P</div>
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
                <li><Link href="/login" className="hover:text-orange-600 transition">ログイン</Link></li>
                <li><Link href="/signup" className="hover:text-orange-600 transition">無料で始める</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-14 border-t border-slate-100 pt-8 flex flex-col sm:flex-row justify-between gap-4">
            <p className="text-xs font-bold text-slate-400 tracking-wider">© {new Date().getFullYear()} Seisanryoku</p>
            <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
              <Link href="/releases" className="hover:text-orange-600 transition">Releases</Link>
              <Link href="/help" className="hover:text-orange-600 transition">Help</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}


