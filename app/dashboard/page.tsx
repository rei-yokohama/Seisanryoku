"use client";

import { Suspense, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { AppShell } from "../AppShell";
import type { Issue } from "../../lib/backlog";
import { type Activity } from "../../lib/activity";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  companyCode: string;
  companyName?: string | null;
  email?: string | null;
};

type Company = {
  companyName?: string;
  phone?: string;
  ownerUid: string;
};

type Deal = {
  id: string;
  title: string;
  status: string;
};

type Employee = {
  id: string;
  name: string;
  email: string;
  authUid?: string;
  companyCode?: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function relativeFromNow(date: Date) {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `約 ${min} 分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `約 ${hr} 時間前`;
  const day = Math.floor(hr / 24);
  return `約 ${day} 日前`;
}

function DashboardInner() {
  const router = useRouter();
  
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [activeTab, setActiveTab] = useState<"updates" | "activity">("updates");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }

      try {
        // profiles（サインアップ直後の反映遅延に備えて軽くリトライ）
        let p: MemberProfile | null = null;
        // まず profiles が無い社員ログインを救済してから読む
        p = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!p) {
          // それでも無い場合は、反映遅延の可能性があるので軽くリトライ
          for (let i = 0; i < 5; i++) {
            const pSnap = await getDoc(doc(db, "profiles", u.uid));
            if (pSnap.exists()) {
              p = pSnap.data() as MemberProfile;
              break;
            }
            await sleep(300);
          }
        }

        const companyCode = (p?.companyCode || "").trim();
        if (!companyCode) {
          setProfile(null);
          setLoading(false);
          return;
        }

        // 先に profile を確定（以降のクエリが permission-denied でも画面は出す）
        setProfile(p);

        // 会社情報を取得して管理者かどうかを判定
        try {
          const compSnap = await getDoc(doc(db, "companies", companyCode));
          if (compSnap.exists()) {
            const companyData = compSnap.data() as Company;
            setCompany(companyData);
            setIsManager(companyData.ownerUid === u.uid);
            // companyName 表示用（companies側が companyName を持つ）
            setProfile((prev) =>
              prev
                ? {
                    ...prev,
                    companyName: prev.companyName || companyData.companyName || null,
                    displayName: prev.displayName || u.email?.split("@")[0] || "ユーザー",
                    email: prev.email || u.email || null,
                  }
                : prev,
            );
          } else {
            setCompany(null);
            setIsManager(false);
          }
        } catch (e) {
          console.warn("companies read failed:", e);
          setCompany(null);
          setIsManager(false);
        }

        // 以降は permission-denied が出ても画面を壊さない（新規ワークスペースでは空配列でOK）
        try {
          const dealsSnap = await getDocs(query(collection(db, "deals"), where("companyCode", "==", companyCode)));
          const dealItems = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal));
          setDeals(dealItems);
        } catch (e) {
          console.warn("deals read failed:", e);
          setDeals([]);
        }

        try {
          const issuesSnap = await getDocs(query(collection(db, "issues"), where("companyCode", "==", companyCode)));
          const issueItems = issuesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Issue));
          setIssues(issueItems);
        } catch (e) {
          console.warn("issues read failed:", e);
          setIssues([]);
        }

        try {
          const empsSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", companyCode)));
          const empItems = empsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
          setEmployees(empItems);
          setEmployee(empItems.find((x) => x.authUid === u.uid) || null);
        } catch (e) {
          console.warn("employees read failed:", e);
          setEmployees([]);
          setEmployee(null);
        }

        try {
          const actSnap = await getDocs(query(collection(db, "activity"), where("companyCode", "==", companyCode)));
          const actItems = actSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)) as Activity[];
          actItems.sort((a, b) => {
            const am = (a.createdAt as any)?.toMillis?.() || 0;
            const bm = (b.createdAt as any)?.toMillis?.() || 0;
            return bm - am;
          });
          setActivities(actItems.slice(0, 50));
        } catch (e) {
          console.warn("activity read failed:", e);
          setActivities([]);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ステータス別カウント
  const statusCounts = {
    TODO: issues.filter(i => i.status === "TODO").length,
    IN_PROGRESS: issues.filter(i => i.status === "IN_PROGRESS").length,
    DONE: issues.filter(i => i.status === "DONE").length,
  };

  const totalIssues = issues.length;
  const completionRate = totalIssues > 0 ? Math.round((statusCounts.DONE / totalIssues) * 100) : 0;

  if (loading) {
    return (
      <AppShell title="ホーム" subtitle="Dashboard">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  // profilesもemployeesも紐づけが見つからない場合に黒画面にならないようにする
  if (!profile) {
    return (
      <AppShell title="ホーム" subtitle="Dashboard">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900 space-y-3">
          <div>初期設定がまだ完了していません。数秒後に自動で反映されます。</div>
          <div className="text-xs font-bold text-amber-800">
            もし解消しない場合は、ページを再読み込みするか、一度ログアウト→ログインをお試しください。
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-orange-700"
          >
            再読み込み
          </button>
        </div>
      </AppShell>
    );
  }

  const myDisplayName = profile.displayName || user.email?.split("@")[0] || "ユーザー";

  // ワークスペース用ダッシュボード（社員・管理者共通）
  return (
    <AppShell title="ワークスペース" subtitle="最近の更新">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側：アクティビティフィード */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("updates")}
                  className={clsx(
                    "px-4 py-2 text-sm font-bold rounded-lg transition",
                    activeTab === "updates"
                      ? "bg-orange-100 text-orange-700"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  最近の更新
                </button>
                <button
                  onClick={() => setActiveTab("activity")}
                  className={clsx(
                    "px-4 py-2 text-sm font-bold rounded-lg transition",
                    activeTab === "activity"
                      ? "bg-orange-100 text-orange-700"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  アクティビティー
                </button>
              </div>
            </div>

            <div className="p-5">
              {activeTab === "updates" && (
                <div className="space-y-4">
                  {activities.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-sm text-slate-600">最近の更新はありません。</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activities.slice(0, 20).map((act, idx) => {
                        const dt = (act.createdAt as any)?.toDate?.() ? (act.createdAt as any).toDate() as Date : null;
                        const actorName = act.actorUid === user.uid ? myDisplayName : (employees.find(e => e.authUid === act.actorUid)?.name || "ユーザー");
                        const showDate = idx === 0 || (dt && activities[idx - 1] && (activities[idx - 1].createdAt as any)?.toDate?.()?.toDateString() !== dt.toDateString());

                        return (
                          <div key={idx}>
                            {showDate && dt && (
                              <div className="text-xs font-extrabold text-slate-500 mb-2 mt-4">
                                {dt.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
                              </div>
                            )}
                            <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-sm font-extrabold text-orange-700 flex-shrink-0">
                                {actorName.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 mb-1">
                                  <span className="text-sm font-bold text-slate-900">{actorName}</span>
                                  <span className="text-xs text-slate-500">が</span>
                                  <span className={clsx(
                                    "text-xs font-bold px-2 py-0.5 rounded",
                                    act.type === "ISSUE_CREATED" || act.type === "ISSUE_UPDATED" ? "bg-orange-100 text-orange-700" :
                                    act.type === "COMMENT_ADDED" ? "bg-sky-100 text-sky-700" :
                                    "bg-slate-100 text-slate-700"
                                  )}>
                                    {act.type === "ISSUE_CREATED" ? "課題" :
                                     act.type === "ISSUE_UPDATED" ? "更新" :
                                     act.type === "COMMENT_ADDED" ? "コメント" :
                                     act.type === "DEAL_UPDATED" ? "案件" :
                                     "課題"}
                                  </span>
                                  <span className="text-xs text-slate-500">を追加</span>
                                  <span className="text-xs text-slate-400">{dt ? relativeFromNow(dt) : ""}</span>
                                </div>
                                <div className="text-sm text-slate-700 mt-1">{act.message}</div>
                                {act.link && (
                                  <Link href={act.link} className="inline-flex items-center gap-1 mt-2 text-xs font-bold text-orange-700 hover:underline">
                                    詳細を見る →
                                  </Link>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                                  💬 0
                  </button>
                                <button className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                                  ⭐ 0
                  </button>
                </div>
            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "activity" && (
                <div className="space-y-3">
                  {activities.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-sm text-slate-600">アクティビティはまだありません。</div>
                    </div>
                  ) : (
                    activities.map((act, idx) => {
                      const dt = (act.createdAt as any)?.toDate?.() ? (act.createdAt as any).toDate() as Date : null;
                      const actorName = act.actorUid === user.uid ? myDisplayName : (employees.find(e => e.authUid === act.actorUid)?.name || "ユーザー");
                      return (
                        <div key={idx} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-xs font-extrabold text-sky-700 flex-shrink-0">
                            {actorName.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-sm font-bold text-slate-900">{actorName}</span>
                              <span className="text-xs text-slate-500">{dt ? relativeFromNow(dt) : ""}</span>
                            </div>
                            <div className="text-sm text-slate-700">{act.message}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
                </div>
              </div>
            </div>

        {/* 右側：状態サマリーとチャート */}
        <div className="lg:col-span-4 space-y-4">
          {/* カレンダー連携（Google等）は一旦停止 */}

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-sm font-extrabold text-slate-900 mb-4">状態</div>
            
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500">完了率</span>
                <span className="text-xs font-bold text-slate-900">{completionRate}% 完了</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-500"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-400"></div>
                  <span className="text-sm text-slate-700">未対応</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-900">{statusCounts.TODO}</span>
                  <div className="w-16 h-6 rounded bg-rose-100 flex items-center justify-center">
                    <span className="text-xs font-bold text-rose-700">{statusCounts.TODO}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-sky-400"></div>
                  <span className="text-sm text-slate-700">処理中</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-900">{statusCounts.IN_PROGRESS}</span>
                  <div className="w-16 h-6 rounded bg-sky-100 flex items-center justify-center">
                    <span className="text-xs font-bold text-sky-700">{statusCounts.IN_PROGRESS}</span>
          </div>
              </div>
                </div>
            
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-400"></div>
                  <span className="text-sm text-slate-700">完了</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-900">{statusCounts.DONE}</span>
                  <div className="w-16 h-6 rounded bg-orange-100 flex items-center justify-center">
                    <span className="text-xs font-bold text-orange-700">{statusCounts.DONE}</span>
               </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-slate-900">合計</span>
                <span className="font-extrabold text-slate-900">{totalIssues}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-extrabold text-slate-900">バーンダウンチャート</div>
              <div className="flex gap-1">
                <button className="rounded p-1 hover:bg-slate-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <button className="rounded p-1 hover:bg-slate-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  </button>
              </div>
            </div>
            <div className="text-center py-12 text-sm text-slate-600">
              現在進行中のマイルストーンはありません。
            </div>
            <Link href="#" className="block text-center text-xs font-bold text-orange-700 hover:underline">
              バーンダウンチャートを表示するには？
            </Link>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
            <Link
              href="/issue/new"
              className="block w-full rounded-lg bg-orange-600 px-4 py-2 text-center text-sm font-extrabold text-white hover:bg-orange-700 transition"
            >
              ＋ 課題を追加
            </Link>
            <Link
              href="/projects"
              className="block w-full rounded-lg border border-orange-200 px-4 py-2 text-center text-sm font-bold text-orange-700 hover:bg-orange-50 transition"
            >
              案件一覧
            </Link>
            <Link
              href="/issue"
              className="block w-full rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              課題一覧
            </Link>
                    </div>
          </div>
            </div>
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-900">読み込み中...</div>
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
