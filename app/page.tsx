"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/navigation";

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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100">
        <div className="text-2xl font-bold text-emerald-900">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-50 to-orange-50">
      {/* Header */}
      <header className="border-b border-emerald-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-2xl shadow-lg">
              🐝
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-900">生産力</p>
              <p className="text-xs text-emerald-700">Seisanryoku</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/employee-login"
              className="hidden rounded-full border-2 border-blue-500 bg-blue-50 px-5 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 sm:block"
            >
              👤 社員ログイン
            </Link>
            <Link
              href="/login"
              className="rounded-full border-2 border-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50"
            >
              管理者ログイン
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 px-6 py-2 font-semibold text-emerald-950 shadow-lg transition hover:scale-105 hover:shadow-xl"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-6 py-20 text-center">
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="absolute -inset-4 animate-pulse rounded-full bg-emerald-300/30 blur-2xl"></div>
            <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-7xl shadow-2xl">
              🐝
            </div>
          </div>
        </div>
        <h1 className="mb-6 text-5xl font-extrabold leading-tight text-emerald-950 md:text-6xl lg:text-7xl">
          働く時間を、<br />
          <span className="bg-gradient-to-r from-emerald-500 to-emerald-600 bg-clip-text text-transparent">
            蜂のように見える化
          </span>
        </h1>
        <p className="mx-auto mb-10 max-w-2xl text-xl text-emerald-800 md:text-2xl">
          チームの生産性を最大化する、Googleカレンダー連携の次世代工数管理SaaS
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/signup"
            className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 px-8 py-4 text-lg font-bold text-emerald-950 shadow-2xl transition hover:scale-105 hover:shadow-amber-400/50"
          >
            <span>今すぐ無料で始める</span>
            <span className="transition group-hover:translate-x-1">→</span>
          </Link>
          <a
            href="#features"
            className="rounded-full border-2 border-emerald-500 px-8 py-4 text-lg font-semibold text-emerald-900 transition hover:bg-emerald-50"
          >
            機能を見る
          </a>
        </div>
        <p className="mt-6 text-sm text-emerald-700">
          ✓ クレジットカード不要 ✓ 即日利用開始 ✓ いつでも解約可能
        </p>
      </section>

      {/* Stats Section */}
      <section className="border-y border-emerald-200 bg-white/60 py-16">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mb-2 text-5xl font-extrabold text-emerald-600">98%</div>
              <p className="text-lg font-semibold text-emerald-900">工数記録の効率化</p>
              <p className="text-sm text-emerald-700">手入力からの解放</p>
            </div>
            <div className="text-center">
              <div className="mb-2 text-5xl font-extrabold text-emerald-600">5分</div>
              <p className="text-lg font-semibold text-emerald-900">セットアップ時間</p>
              <p className="text-sm text-emerald-700">すぐに使い始められる</p>
            </div>
            <div className="text-center">
              <div className="mb-2 text-5xl font-extrabold text-emerald-600">100%</div>
              <p className="text-lg font-semibold text-emerald-900">カレンダー連携</p>
              <p className="text-sm text-emerald-700">Googleと完全同期</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-bold text-emerald-950">
            蜂のように効率的な機能
          </h2>
          <p className="text-xl text-emerald-700">
            チームの生産性を最大化する、厳選された機能群
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          <div className="group rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:border-emerald-400 hover:shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
              📅
            </div>
            <h3 className="mb-3 text-2xl font-bold text-emerald-950">
              カレンダー連携
            </h3>
            <p className="text-emerald-800">
              Googleカレンダーと双方向に同期。予定を自動で工数に変換し、手間を削減します。
            </p>
          </div>
          <div className="group rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:border-emerald-400 hover:shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
              📊
            </div>
            <h3 className="mb-3 text-2xl font-bold text-emerald-950">
              リアルタイム集計
            </h3>
            <p className="text-emerald-800">
              プロジェクト別の工数を自動集計。月次レポートも一瞬で作成できます。
            </p>
          </div>
          <div className="group rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:border-emerald-400 hover:shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
              👥
            </div>
            <h3 className="mb-3 text-2xl font-bold text-emerald-950">
              チーム管理
            </h3>
            <p className="text-emerald-800">
              会社コードでチームを作成。社員の招待も簡単で、権限管理も柔軟です。
            </p>
          </div>
          <div className="group rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:border-emerald-400 hover:shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
              🔒
            </div>
            <h3 className="mb-3 text-2xl font-bold text-emerald-950">
              セキュリティ
            </h3>
            <p className="text-emerald-800">
              Firebaseによる堅牢な認証。データは暗号化され、安全に保護されます。
            </p>
          </div>
          <div className="group rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:border-emerald-400 hover:shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
              ⚡
            </div>
            <h3 className="mb-3 text-2xl font-bold text-emerald-950">
              高速動作
            </h3>
            <p className="text-emerald-800">
              Next.jsの最新技術で構築。ストレスフリーな操作感を実現しています。
            </p>
          </div>
          <div className="group rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:border-emerald-400 hover:shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
              📱
            </div>
            <h3 className="mb-3 text-2xl font-bold text-emerald-950">
              モバイル対応
            </h3>
            <p className="text-emerald-800">
              スマートフォンでも快適に利用可能。外出先でも工数管理ができます。
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-y border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-50 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-emerald-950">
              3ステップで始められる
            </h2>
            <p className="text-xl text-emerald-700">
              複雑な設定は一切不要。今すぐ始められます
            </p>
          </div>
          <div className="grid gap-12 md:grid-cols-3">
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl font-bold text-emerald-950 shadow-xl">
                  1
                </div>
              </div>
              <h3 className="mb-3 text-2xl font-bold text-emerald-950">アカウント作成</h3>
              <p className="text-emerald-800">
                メールアドレスとパスワードだけで、30秒でアカウントを作成できます
              </p>
            </div>
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl font-bold text-emerald-950 shadow-xl">
                  2
                </div>
              </div>
              <h3 className="mb-3 text-2xl font-bold text-emerald-950">会社コード発行</h3>
              <p className="text-emerald-800">
                会社名を入力するだけで、チーム用の会社コードが自動発行されます
              </p>
            </div>
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl font-bold text-emerald-950 shadow-xl">
                  3
                </div>
              </div>
              <h3 className="mb-3 text-2xl font-bold text-emerald-950">カレンダー連携</h3>
              <p className="text-emerald-800">
                Googleカレンダーと連携して、すぐに工数管理を開始できます
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section - For Managers */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-orange-500 p-12 text-center shadow-2xl">
          <div className="mb-6 flex justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/90 text-6xl shadow-lg">
              🐝
            </div>
          </div>
          <h2 className="mb-4 text-4xl font-bold text-emerald-950 md:text-5xl">
            今すぐ、チームの生産性を最大化
          </h2>
          <p className="mb-8 text-xl text-emerald-900">
            クレジットカード不要で、今日から無料でお試しいただけます
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="inline-block rounded-full bg-emerald-950 px-10 py-4 text-lg font-bold text-emerald-400 shadow-2xl transition hover:scale-105 hover:bg-emerald-900"
            >
              管理者として無料で始める →
            </Link>
          </div>
          <p className="mt-6 text-sm text-emerald-900">
            アカウント作成は30秒で完了します
          </p>
        </div>
      </section>

      {/* Employee Login Section */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-3xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-sky-100 p-10 text-center shadow-lg">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-4xl shadow-lg">
              👤
            </div>
          </div>
          <h2 className="mb-3 text-3xl font-bold text-blue-950">
            社員の方はこちら
          </h2>
          <p className="mb-6 text-lg text-blue-800">
            管理者から受け取ったメールアドレスとパスワードで
            <br />
            すぐにログインできます
          </p>
          <Link
            href="/employee-login"
            className="inline-block rounded-full bg-blue-500 px-8 py-3 text-lg font-bold text-white shadow-xl transition hover:scale-105 hover:bg-blue-600"
          >
            社員ログインページへ →
          </Link>
          <p className="mt-4 text-sm text-blue-700">
            アカウントは管理者が作成します
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-emerald-200 bg-white/80 py-8">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-xl">
              🐝
            </div>
          </div>
          <p className="mb-2 text-lg font-bold text-emerald-900">生産力 - Seisanryoku</p>
          <p className="text-sm text-emerald-700">
            © 2025 Seisanryoku. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
