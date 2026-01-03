"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import type { Issue } from "../../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../../lib/backlog";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ShareIssuePage() {
  const params = useParams();
  const issueId = params.issueId as string;

  const [user, setUser] = useState<User | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const loadIssue = async () => {
      if (!issueId) {
        setError("課題IDが指定されていません");
        setLoading(false);
        return;
      }
      if (!user) return;

      try {
        const issueSnap = await getDoc(doc(db, "issues", issueId));
        if (!issueSnap.exists()) {
          setError("課題が見つかりませんでした");
          setLoading(false);
          return;
        }

        const issueData = { id: issueSnap.id, ...issueSnap.data() } as Issue;
        setIssue(issueData);
      } catch (e: any) {
        setError(e?.message || "課題の読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };

    void loadIssue();
  }, [issueId, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center">
          <div className="text-xl font-extrabold text-slate-900">この課題を見るにはログインが必要です</div>
          <div className="mt-2 text-sm text-slate-600">ワークスペースごとにデータを完全に分離しています。</div>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link
              href="/login"
              className="rounded-md bg-orange-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
            >
              ログイン
            </Link>
            <Link
              href="/"
              className="rounded-md border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              トップへ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <div className="text-xl font-bold text-red-700">{error || "課題が見つかりませんでした"}</div>
        </div>
      </div>
    );
  }

  const statusInfo = ISSUE_STATUSES.find((s) => s.value === issue.status);
  const priorityInfo = ISSUE_PRIORITIES.find((p) => p.value === issue.priority);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="mx-auto max-w-4xl px-4">
        {/* Header */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold text-orange-700">
              {issue.issueKey}
            </span>
            <span
              className={clsx(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                issue.status === "DONE"
                  ? "bg-orange-100 text-orange-700"
                  : issue.status === "IN_PROGRESS"
                    ? "bg-sky-100 text-sky-700"
                    : "bg-rose-100 text-rose-700",
              )}
            >
              {statusInfo?.label || issue.status}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">{issue.title}</h1>
        </div>

        {/* Details */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-extrabold text-slate-500">優先度</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{priorityInfo?.label || issue.priority}</div>
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-500">開始日</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{issue.startDate || "-"}</div>
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-500">期限日</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{issue.dueDate || "-"}</div>
            </div>

            {issue.labels && issue.labels.length > 0 && (
              <div>
                <div className="text-xs font-extrabold text-slate-500">ラベル</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {issue.labels.map((l) => (
                    <span key={l} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {issue.description && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-2 text-xs font-extrabold text-slate-500">詳細</div>
            <div className="whitespace-pre-wrap text-sm text-slate-800">{issue.description}</div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-slate-500">
          この課題は 🐝 生産力 (Seisanryoku) で管理されています
        </div>
      </div>
    </div>
  );
}

