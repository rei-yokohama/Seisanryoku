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
import { auth, db } from "../../../../../lib/firebase";
import { ensureProfile } from "../../../../../lib/ensureProfile";
import type { Issue, IssueComment, Project } from "../../../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../../../lib/backlog";
import { logActivity, type Activity } from "../../../../../lib/activity";
import { AppShell } from "../../../../AppShell";

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

export default function IssueDetailPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string; issueId: string }>();
  const projectId = params.projectId;
  const issueId = params.issueId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [commentBody, setCommentBody] = useState("");
  const commentRef = useRef<HTMLTextAreaElement | null>(null);

  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "comments">("overview");

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "私";
  }, [profile?.displayName, user?.email]);

  const assigneeName = (uid?: string | null) => {
    if (!uid) return "";
    if (uid === user?.uid) return myDisplayName;
    return employees.find(e => e.authUid === uid)?.name || "";
  };

  const loadAll = async (u: User, prof: MemberProfile) => {
    // deals コレクションから案件を取得
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

    // employees (company + createdBy fallback)
    const mergedEmp: Employee[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
      mergedEmp.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }
    const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
    mergedEmp.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    const empMap = new Map<string, Employee>();
    for (const e of mergedEmp) empMap.set(e.id, e);
    const empItems = Array.from(empMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setEmployees(empItems);

    // issue
    const iSnap = await getDoc(doc(db, "issues", issueId));
    if (!iSnap.exists()) {
      // URLが issueKey 等になっているケース救済（companyCodeで全件→issueKey一致を探す）
      if (prof.companyCode) {
        const snap = await getDocs(query(collection(db, "issues"), where("companyCode", "==", prof.companyCode)));
        const found = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Issue))
          .find((x) => x.issueKey === issueId);
        if (found?.id) {
          // 正しいURLへ寄せる（履歴は置換）
          router.replace(`/projects/${projectId}/issues/${found.id}`);
          setIssue(found);
          return;
        }
      }
      setIssue(null);
      return;
    }
    const i = { ...(iSnap.data() as Issue), id: issueId } as Issue;
    setIssue(i);

    // comments (companyCodeでindex回避→issueIdでfilter)
    if (prof.companyCode) {
      const snap = await getDocs(query(collection(db, "issueComments"), where("companyCode", "==", prof.companyCode)));
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as IssueComment))
        .filter(c => c.issueId === issueId);
      items.sort((a, b) => {
        const am = (a.createdAt as any)?.toMillis?.() || 0;
        const bm = (b.createdAt as any)?.toMillis?.() || 0;
        return am - bm;
      });
      setComments(items);

      // activities (companyCodeでindex回避→issueIdでfilter)
      const actSnap = await getDocs(query(collection(db, "activity"), where("companyCode", "==", prof.companyCode)));
      const actItems = actSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter((a: any) => a.issueId === issueId) as Activity[];
      actItems.sort((a, b) => {
        const am = (a.createdAt as any)?.toMillis?.() || 0;
        const bm = (b.createdAt as any)?.toMillis?.() || 0;
        return bm - am; // 新しい順
      });
      setActivities(actItems);
    } else {
      setComments([]);
      setActivities([]);
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, projectId, issueId]);

  const addComment = async () => {
    if (!user || !profile || !issue) return;
    const t = commentBody.trim();
    if (!t) {
      setError("コメントを入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "issueComments"), {
        companyCode: profile.companyCode,
        issueId: issue.id,
        authorUid: user.uid,
        body: t,
        createdAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "COMMENT_ADDED",
        projectId,
        issueId: issue.id,
        entityId: issue.id,
        message: `${issue.issueKey} にコメントを追加しました`,
        link: `/projects/${projectId}/issues/${issue.id}`,
      });
      setCommentBody("");
      await loadAll(user, profile);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "コメントの追加に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
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
        projectId,
        issueId: issue.id,
        entityId: issue.id,
        message: `${issue.issueKey} - アーカイブしました`,
        link: `/projects/${projectId}/issues/${issue.id}`,
      });
      router.push(`/projects/${projectId}/issues`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "アーカイブに失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="課題詳細" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  if (!issue) {
    return (
      <AppShell title="課題が見つかりません" projectId={projectId}>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">課題が見つかりません</div>
          <div className="mt-3">
            <Link href={`/projects/${projectId}/issues`} className="text-sm font-bold text-orange-700 hover:underline">
              課題一覧へ戻る
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const statusInfo = ISSUE_STATUSES.find(s => s.value === issue.status);
  const priorityInfo = ISSUE_PRIORITIES.find(p => p.value === issue.priority);
  const assignee = assigneeName(issue.assigneeUid);

  return (
    <AppShell 
      title={`${project?.name || ""}`.trim() || "課題詳細"}
      subtitle={
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/projects/${projectId}/issues`} className="hover:underline text-slate-500">課題</Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">{issue.issueKey}</span>
        </div>
      }
      projectId={projectId}
      headerRight={
        <div className="flex items-center gap-2">
          {!issue.archivedAt && (
            <button
              onClick={archiveIssue}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              アーカイブ
            </button>
          )}
          <Link
            href={`/projects/${projectId}/issues/${issueId}/edit`}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
          >
            編集
          </Link>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側：基本情報 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 課題キーとタイトル */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                {issue.issueKey}
              </span>
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 leading-tight">{issue.title}</h1>
          </div>

          {/* 次のステップ */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">この課題の概要</div>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-500">作成日</div>
                  <div className="text-sm text-slate-900">
                    {issue.createdAt ? new Date((issue.createdAt as any).toMillis()).toLocaleDateString("ja-JP") : "-"}
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
            </div>
          </div>
        </div>

        {/* 中央：タブコンテンツ */}
        <div className="lg:col-span-6 space-y-4">
          {/* タブナビゲーション */}
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
                アクティビティー
              </button>
              <button
                onClick={() => setActiveTab("comments")}
                className={clsx(
                  "px-4 py-3 text-sm font-bold border-b-2 transition",
                  activeTab === "comments"
                    ? "border-orange-600 text-orange-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                コメント ({comments.length})
              </button>
            </div>

            <div className="p-5">
              {/* 概要タブ */}
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

              {/* アクティビティタブ */}
              {activeTab === "activity" && (
                <div className="space-y-3">
                  {activities.length === 0 ? (
                    <div className="text-sm text-slate-600">アクティビティはまだありません。</div>
                  ) : (
                    activities.map((act, idx) => {
                      const dt = (act.createdAt as any)?.toDate?.() ? (act.createdAt as any).toDate() as Date : null;
                      const who = act.actorUid === user.uid ? myDisplayName : (employees.find(e => e.authUid === act.actorUid)?.name || "ユーザー");
                      return (
                        <div key={idx} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-xs font-extrabold text-sky-700 flex-shrink-0">
                            {who.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-sm font-bold text-slate-900">{who}</span>
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

              {/* コメントタブ */}
              {activeTab === "comments" && (
                <div className="space-y-5">
                  <div className="space-y-4">
                    {comments.length === 0 ? (
                      <div className="text-sm text-slate-600">コメントはまだありません。</div>
                    ) : (
                      comments.map((c) => {
                        const dt = (c.createdAt as any)?.toDate?.() ? (c.createdAt as any).toDate() as Date : null;
                        const who = c.authorUid === user.uid ? myDisplayName : (employees.find(e => e.authUid === c.authorUid)?.name || "ユーザー");
                        return (
                          <div key={c.id} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-sm font-extrabold text-orange-700 flex-shrink-0">
                              {who.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-baseline gap-2 mb-1">
                                <div className="text-sm font-extrabold text-slate-900">{who}</div>
                                <div className="text-xs text-slate-500">{dt ? relativeFromNow(dt) : ""}</div>
                              </div>
                              <div className="whitespace-pre-wrap text-sm text-slate-800">{c.body}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="border-t border-slate-200 pt-4 mt-4">
                    <textarea
                      ref={commentRef}
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      className="min-h-[100px] w-full rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                      placeholder="コメントを入力..."
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={addComment}
                        disabled={saving || !commentBody.trim()}
                        className={clsx(
                          "rounded-lg px-4 py-2 text-sm font-extrabold text-white transition",
                          saving || !commentBody.trim() ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700",
                        )}
                      >
                        {saving ? "投稿中..." : "コメントを投稿"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右側：サイドバー */}
        <div className="lg:col-span-3 space-y-4">
          {/* 案件情報 */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">案件</div>
            <Link href={`/projects/${projectId}/issues`} className="block group">
              <div className="text-sm font-bold text-slate-900 group-hover:text-orange-700 transition">
                {project?.name || "案件名なし"}
              </div>
            </Link>
          </div>

          {/* ステータス・優先度 */}
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

          {/* 担当者 */}
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

          {/* 日付 */}
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

          {/* ラベル */}
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
