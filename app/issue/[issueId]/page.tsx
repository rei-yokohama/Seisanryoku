"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import type { Issue, Project } from "../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../lib/backlog";
import { logActivity, type Activity } from "../../../lib/activity";
import { statusToLabel, statusColor } from "../../../lib/properties";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function GlobalIssueDetailPage() {
  const router = useRouter();
  const params = useParams<{ issueId: string }>();
  const issueId = params.issueId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<"overview" | "activity">("overview");

  // アクティビティ追加
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [activityText, setActivityText] = useState("");
  const [savingActivity, setSavingActivity] = useState(false);
  const activityInputRef = useRef<HTMLTextAreaElement | null>(null);

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "ユーザー";
  }, [profile?.displayName, user?.email]);

  const assigneeName = (uid?: string | null) => {
    if (!uid) return "";
    if (uid === user?.uid) return myDisplayName;
    return employees.find(e => e.authUid === uid)?.name || "";
  };

  // 最終更新日（アクティビティの最新日時）
  const lastActivityDate = useMemo(() => {
    if (activities.length === 0) return null;
    const ts = (activities[0].createdAt as any)?.toDate?.();
    return ts instanceof Date ? ts : null;
  }, [activities]);

  const loadAll = async (u: User, prof: MemberProfile) => {
    try {
      // 1. 課題を取得
      let iSnap;
      try {
        iSnap = await getDoc(doc(db, "issues", issueId));
      } catch (e: any) {
        console.error("Step 1 (Issue fetch) failed:", e);
        if (e.code === 'permission-denied') {
          throw new Error(`課題の取得権限がありません (会社コード: ${prof.companyCode})。所属情報が同期されるまで数秒待ってから再読み込みしてください。`);
        }
        throw new Error(`課題の取得に失敗しました: ${e.message}`);
      }

      let currentIssue: Issue | null = null;

      if (!iSnap.exists()) {
        if (prof.companyCode) {
          try {
            const q = query(
              collection(db, "issues"),
              where("companyCode", "==", prof.companyCode),
              where("issueKey", "==", issueId)
            );
            const snap = await getDocs(q);
            if (!snap.empty) {
              const foundDoc = snap.docs[0];
              currentIssue = { id: foundDoc.id, ...foundDoc.data() } as Issue;
              router.replace(`/issue/${currentIssue.id}`);
            }
          } catch (e: any) {
            console.error("Step 1 fallback failed:", e);
            if (e.code === 'permission-denied') {
              throw new Error("課題の検索権限がありません。所属情報を確認してください。");
            }
          }
        }
      } else {
        currentIssue = { id: iSnap.id, ...iSnap.data() } as Issue;
      }

      if (!currentIssue) {
        setIssue(null);
        return;
      }

      setIssue(currentIssue);
      const projectId = currentIssue.projectId;

      // 2. 案件情報を取得
      try {
        const pSnap = await getDoc(doc(db, "deals", projectId));
        if (pSnap.exists()) {
          const dealData = pSnap.data();
          setProject({
            ...dealData,
            id: projectId,
            name: dealData.title || "無題",
            key: dealData.key || dealData.title?.slice(0, 5)?.toUpperCase() || "DEAL",
          } as Project);
        }
      } catch (e: any) {
        console.warn("Step 2 (Deal fetch) failed:", e);
      }

      // 3. 社員リストを取得
      try {
        const mergedEmp: Employee[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          mergedEmp.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        }
        const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
        mergedEmp.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        const empMap = new Map<string, Employee>();
        for (const e of mergedEmp) empMap.set(e.id, e);
        setEmployees(Array.from(empMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      } catch (e) {
        console.warn("Step 3 (Employees fetch) failed:", e);
      }

      // 4. アクティビティ
      try {
        await loadSideData(currentIssue.id, prof.companyCode);
      } catch (e) {
        console.warn("Step 4 (Side data fetch) failed:", e);
      }

    } catch (e: any) {
      console.error("loadAll failed:", e);
      setError(e.message || "読み込みに失敗しました");
    }
  };

  const loadSideData = async (targetIssueId: string, companyCode: string) => {
    // activities
    const actSnap = await getDocs(query(collection(db, "activity"), where("companyCode", "==", companyCode)));
    const actItems = actSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter((a: any) => a.issueId === targetIssueId) as Activity[];
    actItems.sort((a, b) => {
      const am = (a.createdAt as any)?.toMillis?.() || 0;
      const bm = (b.createdAt as any)?.toMillis?.() || 0;
      return bm - am;
    });
    setActivities(actItems);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as MemberProfile | null;
        if (!prof) {
          setLoading(false);
          router.push("/login");
          return;
        }
        setProfile(prof);
        await loadAll(u, prof);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "読み込みに失敗しました";
        setError(msg);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, issueId]);

  const addActivity = async () => {
    if (!user || !profile || !issue) return;
    const t = activityText.trim();
    if (!t) return;
    setSavingActivity(true);
    setError("");
    try {
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "OUTPUT_ADDED",
        projectId: issue.projectId,
        issueId: issue.id,
        entityId: issue.id,
        message: t,
        link: `/issue/${issue.id}`,
      });
      setActivityText("");
      setShowActivityForm(false);
      await loadSideData(issue.id, profile.companyCode);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "アクティビティの追加に失敗しました";
      setError(msg);
    } finally {
      setSavingActivity(false);
    }
  };

  const archiveIssue = async () => {
    if (!user || !profile || !issue) return;
    if (issue.archivedAt) {
      alert("この課題は既にアーカイブ済みです");
      return;
    }
    if (!confirm("この課題をアーカイブしますか？（一覧ではデフォルト非表示になります）")) return;
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "issues", issue.id), {
        archivedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "ISSUE_UPDATED",
        projectId: issue.projectId,
        issueId: issue.id,
        entityId: issue.id,
        message: `${issue.issueKey} - アーカイブしました`,
        link: `/issue/${issue.id}`,
      });
      router.push(`/issue`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "アーカイブに失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="課題詳細" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  if (!issue) {
    return (
      <AppShell title="課題が見つかりません">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">課題が見つかりません</div>
          <div className="mt-3 text-sm text-slate-600">
            お探しの課題は削除されたか、アクセス権限がない可能性があります。
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/issue`}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              課題一覧へ戻る
            </Link>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700"
            >
              再読み込み
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  const statusLabel = statusToLabel(issue.status);
  const priorityInfo = ISSUE_PRIORITIES.find(p => p.value === issue.priority);
  const assignee = assigneeName(issue.assigneeUid);

  return (
    <AppShell
      title={`${project?.name || ""}`.trim() || "課題詳細"}
      subtitle={
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/issue`} className="hover:underline text-slate-500">課題</Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">{issue.issueKey}</span>
        </div>
      }
      projectId={issue.projectId}
    >
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-extrabold text-slate-900">{issue.issueKey} {issue.title}</h1>
        <div className="flex items-center gap-2">
          {!issue.archivedAt && (
            <button
              onClick={archiveIssue}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              アーカイブ
            </button>
          )}
          <button
            onClick={() => {
              setActiveTab("activity");
              setShowActivityForm(true);
              setTimeout(() => activityInputRef.current?.focus(), 100);
            }}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-extrabold text-emerald-700 hover:bg-emerald-100 transition flex items-center gap-1.5"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            アクティビティを追加
          </button>
          <Link
            href={`/issue/${issue.id}/edit`}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
          >
            編集
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                {issue.issueKey}
              </span>
            </div>
            <h2 className="text-lg font-extrabold text-slate-900 leading-tight">{issue.title}</h2>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">この課題の概要</div>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-500">作成日</div>
                  <div className="text-sm text-slate-900">
                    {issue.createdAt ? new Date((issue.createdAt as any).toMillis()).toLocaleDateString("ja-JP") : ""}
                  </div>
                </div>
              </div>
              {issue.startDate && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">開始日</div>
                    <div className="text-sm text-slate-900">{issue.startDate}</div>
                  </div>
                </div>
              )}
              {issue.dueDate && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">期限</div>
                    <div className="text-sm text-slate-900">{issue.dueDate}</div>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-1 h-1 rounded-full bg-emerald-400 mt-2"></div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-500">最終更新</div>
                  <div className="text-sm text-slate-900">
                    {lastActivityDate
                      ? lastActivityDate.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" }) + " " + lastActivityDate.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                      : issue.updatedAt
                        ? new Date((issue.updatedAt as any).toMillis()).toLocaleDateString("ja-JP")
                        : ""
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 flex items-center px-2">
              <button
                onClick={() => setActiveTab("overview")}
                className={clsx(
                  "px-4 py-3 text-sm font-bold border-b-2 transition",
                  activeTab === "overview"
                    ? "border-orange-600 text-orange-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                概要
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={clsx(
                  "px-4 py-3 text-sm font-bold border-b-2 transition",
                  activeTab === "activity"
                    ? "border-orange-600 text-orange-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                アクティビティ ({activities.length})
              </button>
            </div>

            <div className="p-5">
              {activeTab === "overview" && (
                <div className="space-y-5">
                  {issue.description ? (
                    <div>
                      <div className="text-xs font-extrabold text-slate-500 mb-2">詳細</div>
                      <div className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 rounded-lg p-4">
                        {issue.description}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600">詳細はまだ記入されていません。</div>
                  )}
                </div>
              )}

              {activeTab === "activity" && (
                <div className="space-y-4">
                  {/* アクティビティ追加フォーム */}
                  {!showActivityForm ? (
                    <button
                      onClick={() => {
                        setShowActivityForm(true);
                        setTimeout(() => activityInputRef.current?.focus(), 50);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm font-bold text-slate-500 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50/50 transition-all"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      アクティビティを追加
                    </button>
                  ) : (
                    <div className="rounded-lg border border-orange-200 bg-orange-50/30 p-4">
                      <div className="text-xs font-extrabold text-slate-600 mb-2">どんなアウトプットをしましたか？</div>
                      <textarea
                        ref={activityInputRef}
                        value={activityText}
                        onChange={(e) => setActivityText(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 resize-none"
                        rows={3}
                        placeholder="例: デザインカンプを提出した、APIの設計書をレビュー依頼した..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void addActivity();
                          }
                        }}
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">Ctrl+Enter で送信</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setShowActivityForm(false); setActivityText(""); }}
                            className="rounded-md px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
                          >
                            キャンセル
                          </button>
                          <button
                            onClick={addActivity}
                            disabled={savingActivity || !activityText.trim()}
                            className={clsx(
                              "rounded-md px-4 py-1.5 text-xs font-extrabold text-white transition",
                              savingActivity || !activityText.trim() ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700",
                            )}
                          >
                            {savingActivity ? "保存中..." : "追加"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* タイムライン */}
                  {activities.length === 0 ? (
                    <div className="py-6 text-center text-sm text-slate-400">アクティビティはまだありません</div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />

                      {activities.map((act, idx) => {
                        const dt = (act.createdAt as any)?.toDate?.() ? (act.createdAt as any).toDate() as Date : null;
                        const who = act.actorUid === user.uid ? myDisplayName : (employees.find(e => e.authUid === act.actorUid)?.name || "ユーザー");
                        const isOutput = act.type === "OUTPUT_ADDED";

                        return (
                          <div key={idx} className="relative flex items-start gap-3 pb-4 pl-1">
                            <div className={clsx(
                              "relative z-[1] mt-1.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
                              isOutput
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-500",
                            )}>
                              {isOutput ? (
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6V7.5z" />
                                </svg>
                              ) : (
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5" />
                                </svg>
                              )}
                            </div>

                            <div className={clsx(
                              "flex-1 min-w-0 rounded-lg px-3 py-2",
                              isOutput ? "bg-emerald-50/60 border border-emerald-100" : "",
                            )}>
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-sm font-bold text-slate-900">{who}</span>
                                {isOutput && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-700">OUTPUT</span>}
                                {dt && (
                                  <span className="text-[11px] text-slate-400" title={dt.toLocaleString("ja-JP")}>
                                    {dt.toLocaleDateString("ja-JP", { month: "short", day: "numeric" })} {dt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                              </div>
                              <div className={clsx(
                                "mt-0.5 text-sm whitespace-pre-wrap",
                                isOutput ? "text-slate-800" : "text-slate-600",
                              )}>{act.message}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">案件</div>
            {project ? (
              <Link href={`/projects/${project.id}/issues`} className="block group">
                <div className="text-sm font-bold text-slate-900 group-hover:text-orange-700 transition">
                  {project.name}
                </div>
              </Link>
            ) : (
              <div className="text-sm text-slate-400">取得中...</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="space-y-4">
              {issue.archivedAt && (
                <div>
                  <div className="text-xs font-extrabold text-slate-500 mb-2">アーカイブ</div>
                  <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold bg-slate-900 text-white">
                    アーカイブ済み
                  </span>
                </div>
              )}
              <div>
                <div className="text-xs font-extrabold text-slate-500 mb-2">ステータス</div>
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                    statusColor(issue.status),
                  )}
                >
                  {statusLabel}
                </span>
              </div>
              <div>
                <div className="text-xs font-extrabold text-slate-500 mb-2">優先度</div>
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                    issue.priority === "HIGH"
                      ? "bg-red-100 text-red-700"
                      : issue.priority === "LOW"
                        ? "bg-slate-100 text-slate-700"
                        : "bg-amber-100 text-amber-700",
                  )}
                >
                  {priorityInfo?.label || issue.priority}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">担当者</div>
            {assignee ? (
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-sm font-extrabold text-orange-700">
                  {assignee.charAt(0).toUpperCase()}
                </div>
                <div className="text-sm font-bold text-slate-900">{assignee}</div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">未割当</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="space-y-3">
              {issue.startDate && (
                <div>
                  <div className="text-xs font-extrabold text-slate-500 mb-1">開始日</div>
                  <div className="text-sm text-slate-900">{issue.startDate}</div>
                </div>
              )}
              {issue.dueDate && (
                <div>
                  <div className="text-xs font-extrabold text-slate-500 mb-1">期限</div>
                  <div className="text-sm text-slate-900">{issue.dueDate}</div>
                </div>
              )}
            </div>
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="text-xs font-extrabold text-slate-500 mb-3">ラベル</div>
              <div className="flex flex-wrap gap-2">
                {issue.labels.map((label, idx) => (
                  <span key={idx} className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
