"use client";

import Link from "next/link";
import { AppShell } from "../AppShell";

export default function HelpPage() {
  return (
    <AppShell title="ヘルプ" subtitle="使い方ガイド">
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900 mb-4">よくある質問</div>
          <div className="space-y-4 text-sm text-slate-700">
            <div>
              <div className="font-bold mb-1">Q: 課題の追加方法は？</div>
              <div className="text-slate-600">A: 左メニューの「課題の追加」またはヘッダーの「＋」ボタンから追加できます。</div>
            </div>
            <div>
              <div className="font-bold mb-1">Q: ボードで課題を移動するには？</div>
              <div className="text-slate-600">A: ボード画面で課題カードをドラッグ&ドロップして移動できます。</div>
            </div>
            <div>
              <div className="font-bold mb-1">Q: 顧客や案件の管理は？</div>
              <div className="text-slate-600">A: 左メニューの「顧客」や「案件」から管理できます。</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900 mb-4">お問い合わせ</div>
          <div className="text-sm text-slate-700">
            ご不明な点がございましたら、お気軽にお問い合わせください。
          </div>
        </div>
        <div className="text-center">
          <Link
            href="/dashboard"
            className="text-sm font-bold text-emerald-700 hover:underline"
          >
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

