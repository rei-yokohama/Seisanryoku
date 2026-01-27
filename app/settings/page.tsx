"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { AppShell } from "../AppShell";

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }
      try {
        const prof = await ensureProfile(u);
        if (prof?.companyCode) {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          const isOwner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
          if (!isOwner) {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            if (msSnap.exists()) {
              const perms = (msSnap.data() as any).permissions || {};
              if (perms.settings === false) {
                window.location.href = "/";
                return;
              }
            }
          }
        }
      } catch (e) {
        console.warn("permission check failed:", e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <AppShell title="設定" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="設定" subtitle="設定メニュー">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">設定</div>
          <div className="mt-2 text-sm font-bold text-slate-600">
            ワークスペース情報の更新、メンバー招待などの設定はここから移動できます。
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Link
              href="/settings/account"
              className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 hover:bg-white hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-slate-900">ユーザー設定</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    表示名・メールアドレス・パスワード
                  </div>
                </div>
                <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold text-orange-800 group-hover:bg-orange-200">
                  開く →
                </div>
              </div>
            </Link>

            <Link
              href="/settings/workspace"
              className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 hover:bg-white hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-slate-900">ワークスペース設定</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    ワークスペース名・ワークスペースコード（招待で使用）
                  </div>
                </div>
                <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold text-orange-800 group-hover:bg-orange-200">
                  開く →
                </div>
              </div>
            </Link>

            <Link
              href="/settings/members"
              className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 hover:bg-white hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-slate-900">メンバー設定</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    チーム招待（URL発行）・チーム全体設定
                  </div>
                </div>
                <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold text-orange-800 group-hover:bg-orange-200">
                  開く →
                </div>
              </div>
            </Link>
          </div>
        </div>

        <div className="text-center">
          <Link href="/dashboard" className="text-sm font-bold text-orange-700 hover:underline">
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

