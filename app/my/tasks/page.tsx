"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import type { Issue, Project } from "../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../lib/backlog";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
};

function TasksInner() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, Project>>({});

  const searchParams = useSearchParams();
  const router = useRouter();

  const status = searchParams.get("status") || "ALL";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (profSnap.exists()) {
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        // 自分の担当タスク（会社コードで絞る）
        const q = query(
          collection(db, "issues"),
          where("companyCode", "==", prof.companyCode),
          where("assigneeUid", "==", u.uid),
        );
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Issue));
        items.sort((a, b) => (a.issueKey || "").localeCompare(b.issueKey || ""));
        setIssues(items);

        // 参照用にプロジェクトもロード（重くなったらキャッシュ化）
        const projectIds = Array.from(new Set(items.map(i => i.projectId).filter(Boolean)));
        const projMap: Record<string, Project> = {};
        for (const pid of projectIds) {
          const pSnap = await getDoc(doc(db, "projects", pid));
          if (pSnap.exists()) projMap[pid] = { ...(pSnap.data() as Project), id: pid };
        }
        setProjectsById(projMap);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const filtered = useMemo(() => {
    if (status === "ALL") return issues;
    if (status === "TODO" || status === "IN_PROGRESS" || status === "DONE") {
      return issues.filter(i => i.status === status);
    }
    return issues;
  }, [issues, status]);

  const setStatusFilter = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") params.delete("status");
    else params.set("status", next);
    router.push(`/tasks?${params.toString()}`);
  };

  if (loading) {
    return (
      <AppShell title="自分のタスク" subtitle="Tasks">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }
  if (!user) return null;

  return (
    <AppShell title="自分のタスク" subtitle="Tasks">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-emerald-700">Backlog（案件・タスク管理）</div>
            <h1 className="text-3xl font-bold text-emerald-950">自分のタスク</h1>
            <div className="mt-1 text-xs text-emerald-700">
              会社: <span className="font-semibold text-emerald-900">{profile?.companyCode || "-"}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/projects"
              className="rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2 text-sm font-extrabold text-emerald-950 shadow-lg transition hover:scale-[1.02]"
            >
              ＋ タスクを追加
            </Link>
            <Link
              href="/projects"
              className="rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm transition hover:shadow"
            >
              プロジェクト一覧
            </Link>
            <Link
              href="/calendar"
              className="rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm transition hover:shadow"
            >
              カレンダーへ
            </Link>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setStatusFilter("ALL")}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              status === "ALL" ? "bg-emerald-900 text-white" : "bg-emerald-100 text-emerald-900"
            }`}
          >
            全て
          </button>
          {ISSUE_STATUSES.map(s => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                status === s.value ? "bg-emerald-900 text-white" : "bg-emerald-100 text-emerald-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-emerald-200 bg-white p-8 text-emerald-800">
            <div className="text-lg font-bold text-emerald-950">担当タスクがありません</div>
            <div className="mt-2 text-sm">管理者がタスクを割り当てると、ここに表示されます。</div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2 border-emerald-200 bg-white">
            <div className="grid grid-cols-12 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-900">
              <div className="col-span-2">キー</div>
              <div className="col-span-4">タイトル</div>
              <div className="col-span-2">状態</div>
              <div className="col-span-2">優先度</div>
              <div className="col-span-2">プロジェクト</div>
            </div>
            {filtered.map((i) => {
              const proj = projectsById[i.projectId];
              const statusLabel = ISSUE_STATUSES.find(s => s.value === i.status)?.label || i.status;
              const prioLabel = ISSUE_PRIORITIES.find(p => p.value === i.priority)?.label || i.priority;
              return (
                <div key={i.id} className="grid grid-cols-12 items-center border-t border-emerald-100 px-4 py-3 text-sm">
                  <div className="col-span-2 font-bold text-emerald-900">{i.issueKey}</div>
                  <div className="col-span-4 text-emerald-950">{i.title}</div>
                  <div className="col-span-2 text-emerald-800">{statusLabel}</div>
                  <div className="col-span-2 text-emerald-800">{prioLabel}</div>
                  <div className="col-span-2">
                    {proj ? (
                      <Link href={`/projects/${proj.id}`} className="font-bold text-emerald-900 underline">
                        {proj.key}
                      </Link>
                    ) : (
                      <span className="text-emerald-600">-</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-emerald-900">読み込み中...</div>
        </div>
      }
    >
      <TasksInner />
    </Suspense>
  );
}


