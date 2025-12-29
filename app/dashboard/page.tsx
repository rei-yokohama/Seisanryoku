"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { auth, db } from "../../lib/firebase";
import { AppShell } from "../AppShell";
import type { Issue, Project } from "../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../lib/backlog";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  companyCode: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const selectedProjectId = searchParams.get("projectId") || projects[0]?.id || "";
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  // Load data
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }

      try {
        const pSnap = await getDoc(doc(db, "profiles", u.uid));
        const p = pSnap.exists() ? (pSnap.data() as MemberProfile) : null;
        setProfile(p);

        // Load projects
        const pq = query(collection(db, "projects"), where("companyCode", "==", p?.companyCode || ""));
        const pSnaps = await getDocs(pq);
        const projs: Project[] = [];
        pSnaps.forEach((doc) => {
          projs.push({ ...(doc.data() as Project), id: doc.id });
        });
        setProjects(projs);

        // Load issues
        const iq = query(collection(db, "issues"), where("companyCode", "==", p?.companyCode || ""));
        const iSnaps = await getDocs(iq);
        const iss: Issue[] = [];
        iSnaps.forEach((doc) => {
          iss.push({ ...(doc.data() as Issue), id: doc.id });
        });
        setIssues(iss);

        // Load employees
        const eq = query(collection(db, "employees"), where("companyCode", "==", p?.companyCode || ""));
        const eSnaps = await getDocs(eq);
        const emps: Employee[] = [];
        eSnaps.forEach((doc) => {
          const data = doc.data();
          emps.push({ id: doc.id, name: data.name, authUid: data.authUid });
        });
        setEmployees(emps);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <AppShell title="ダッシュボード">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title={selectedProject ? `${selectedProject.key} ${selectedProject.name}` : "PPC/GMB/BS"}
      subtitle="課題一覧"
      projectId={selectedProjectId}
    >
      <div className="px-0 py-1">
          {/* Backlog Style Issue List Search Section */}
          <div className="rounded-lg border border-slate-200 bg-[#f8f9f8] p-4 shadow-sm mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                   <span className="text-slate-400">∨</span> 検索条件
                </div>
                <button className="rounded bg-[#40a58e] px-4 py-1.5 text-xs font-bold text-white">
                  シンプルな検索
                </button>
                <button className="rounded border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  高度な検索
                </button>
              </div>
                <div className="flex items-center gap-2">
                <button className="flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <span className="text-slate-400 text-[10px]">🔗</span> 短いURL
                  </button>
                <button className="flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <span className="text-slate-400 text-[10px]">📍</span> 検索条件を保存
                  </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] font-bold text-slate-600 mb-4">
              <div className="flex items-center gap-3">
                <span className="shrink-0">状態:</span>
                <div className="flex flex-wrap gap-2">
                  {["すべて", "未対応", "処理中", "処理済み", "【危険】納期遅れ中", "契約中", "停止中", "解約", "完了"].map((label) => (
                    <button
                      key={label}
                      className={classNames(
                        "rounded px-2 py-0.5 transition-colors",
                        label === "すべて" ? "bg-[#40a58e] text-white" : "hover:bg-slate-200"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <button className="rounded bg-[#40a58e] px-2 py-0.5 text-white">完了以外</button>
                </div>
                </div>
              <div className="flex items-center gap-2">
                 <span>親子課題:</span>
                 <div className="flex gap-2">
                    <button className="bg-[#40a58e] text-white rounded px-2 py-0.5">すべて</button>
                    <button className="hover:bg-slate-200 rounded px-2 py-0.5">親課題</button>
                    <button className="hover:bg-slate-200 rounded px-2 py-0.5">子課題以外</button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-4 text-xs text-slate-500 font-bold">
              <div>
                <div className="mb-1">種別</div>
                <select className="w-full rounded border border-slate-300 bg-white px-2 py-2 outline-none focus:ring-1 focus:ring-emerald-500">
                  <option>すべて</option>
                </select>
              </div>
              <div>
                <div className="mb-1">カテゴリー</div>
                <select className="w-full rounded border border-slate-300 bg-white px-2 py-2 outline-none focus:ring-1 focus:ring-emerald-500">
                  <option>すべて</option>
                </select>
              </div>
              <div>
                <div className="mb-1">マイルストーン</div>
                <select className="w-full rounded border border-slate-300 bg-white px-2 py-2 outline-none focus:ring-1 focus:ring-emerald-500">
                  <option>すべて</option>
                </select>
          </div>
              <div>
                <div className="mb-1">担当者</div>
                <select className="w-full rounded border border-slate-300 bg-white px-2 py-2 outline-none focus:ring-1 focus:ring-emerald-500">
                  <option>すべて</option>
                </select>
              </div>
                </div>
            
            <div className="mt-4 flex items-center gap-4">
               <div className="flex-1">
                  <div className="font-bold text-slate-500 mb-1 text-xs">キーワード</div>
                  <input
                    type="text"
                    placeholder="キーワードを入力"
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                  />
               </div>
               <div className="pt-5">
                  <button className="bg-slate-100 p-2 rounded border border-slate-300 hover:bg-slate-200">
                    <svg className="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

          {/* List Toolbar */}
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold text-slate-700 flex items-center gap-4">
              <span>全 {issues.length} 件中 1 件 〜 {Math.min(issues.length, 20)} 件を表示</span>
              <div className="flex items-center gap-1">
                <span className="h-6 w-6 rounded-full bg-[#40a58e] text-white flex items-center justify-center text-[11px]">1</span>
                <span className="h-6 w-6 rounded-full hover:bg-slate-200 flex items-center justify-center text-[11px] text-slate-500">2</span>
                <span className="h-6 w-6 rounded-full hover:bg-slate-200 flex items-center justify-center text-[11px] text-slate-400 px-4">次へ &gt;</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
               <button className="flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all">
                  📝 まとめて操作
                </button>
               <button className="flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all">
                  📤 一括登録
                  </button>
               <button className="flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all">
                  ⚙️ 表示設定
                  </button>
               <button className="text-slate-400 p-1 hover:text-slate-600">•••</button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto bg-white border border-slate-200 rounded shadow-sm">
            <table className="w-full text-left text-[11px] font-bold">
              <thead className="bg-[#f8f9f8] text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 border-r border-slate-200">種別</th>
                  <th className="px-4 py-2 border-r border-slate-200">キー</th>
                  <th className="px-4 py-2 border-r border-slate-200 w-1/3">件名</th>
                  <th className="px-4 py-2 border-r border-slate-200 text-center">担当者</th>
                  <th className="px-4 py-2 border-r border-slate-200 text-center">状態</th>
                  <th className="px-4 py-2 border-r border-slate-200">カテゴリー</th>
                  <th className="px-4 py-2 border-r border-slate-200">優先度</th>
                  <th className="px-4 py-2 border-r border-slate-200">発生バージョン</th>
                  <th className="px-4 py-2 border-r border-slate-200">マイルストーン</th>
                  <th className="px-4 py-2">登録日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {issues.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400 bg-white italic font-medium">
                       該当する課題はありません。
                    </td>
                  </tr>
                ) : (
                  issues.slice(0, 20).map((i) => (
                    <tr key={i.id} className="hover:bg-[#fcfdfc] bg-white transition-colors">
                      <td className="px-4 py-3 border-r border-slate-200">
                         <span className="rounded-full bg-sky-500 px-3 py-1 text-[10px] text-white">その他</span>
                      </td>
                      <td className="px-4 py-3 border-r border-slate-200 text-sky-600 hover:underline cursor-pointer">
                        {i.issueKey}
                      </td>
                      <td className="px-4 py-3 border-r border-slate-200 text-slate-800 leading-tight">
                        {i.title}
                      </td>
                      <td className="px-4 py-3 border-r border-slate-200 text-center">
                         <div className="flex flex-col items-center gap-1">
                            <div className="h-6 w-6 rounded-full bg-emerald-500 text-[10px] text-white flex items-center justify-center">零</div>
                            <span className="text-[9px] text-slate-500 font-normal">根本百恵</span>
                    </div>
                      </td>
                      <td className="px-4 py-3 border-r border-slate-200 text-center">
                         <span className={classNames(
                           "rounded px-3 py-1 text-white text-[10px] min-w-[60px] inline-block",
                           i.status === "DONE" ? "bg-emerald-500" : i.status === "IN_PROGRESS" ? "bg-sky-500" : "bg-rose-400"
                         )}>
                           {i.status === "DONE" ? "完了" : i.status === "IN_PROGRESS" ? "処理中" : "未対応"}
                         </span>
                      </td>
                      <td className="px-4 py-3 border-r border-slate-200 text-slate-500 font-normal">PPC-箱タスク</td>
                      <td className="px-4 py-3 border-r border-slate-200 text-center text-sky-600">→</td>
                      <td className="px-4 py-3 border-r border-slate-200 font-normal"></td>
                      <td className="px-4 py-3 border-r border-slate-200 font-normal"></td>
                      <td className="px-4 py-3 text-slate-400 font-normal">2025/12/...</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
            </div>
    </AppShell>
  );
}

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-emerald-800">読み込み中...</div>
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
