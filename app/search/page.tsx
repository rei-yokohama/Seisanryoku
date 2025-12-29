"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";

function SearchInner() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";

  return (
    <AppShell title="検索結果" subtitle={q ? `「${q}」の検索結果` : "検索"}>
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="text-sm font-bold text-slate-500">
          {q ? `「${q}」の検索結果は準備中です` : "検索キーワードを入力してください"}
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

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="検索" subtitle="読み込み中...">
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="text-sm font-bold text-slate-600">読み込み中...</div>
          </div>
        </AppShell>
      }
    >
      <SearchInner />
    </Suspense>
  );
}

