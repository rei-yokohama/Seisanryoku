"use client";

import Link from "next/link";
import { AppShell } from "../AppShell";

export default function SettingsPage() {
  return (
    <AppShell title="設定" subtitle="アプリケーション設定">
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900 mb-4">一般設定</div>
          <div className="space-y-4 text-sm text-slate-700">
            <div>
              <div className="font-bold mb-1">通知設定</div>
              <div className="text-slate-600">通知の受信方法を設定できます。</div>
            </div>
            <div>
              <div className="font-bold mb-1">表示設定</div>
              <div className="text-slate-600">テーマや表示オプションを設定できます。</div>
            </div>
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

