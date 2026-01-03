"use client";

import Link from "next/link";
import { AppShell } from "../AppShell";

export default function RecentPage() {
  return (
    <AppShell title="最近見た項目" subtitle="最近アクセスした項目">
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="text-sm font-bold text-slate-500">
          最近見た項目の機能は準備中です
        </div>
        <div className="mt-4">
          <Link
            href="/dashboard"
            className="text-sm font-bold text-orange-700 hover:underline"
          >
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

