"use client";

import Link from "next/link";
import { AppShell } from "../AppShell";

export default function FiltersPage() {
  return (
    <AppShell title="フィルタ" subtitle="保存されたフィルタ">
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="text-sm font-bold text-slate-500">
          フィルタ機能は準備中です
        </div>
        <div className="mt-4">
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

