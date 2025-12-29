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
import type { Issue, IssueComment, Project } from "../../../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../../../lib/backlog";
import { logActivity, pushNotification } from "../../../../../lib/activity";
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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<Issue["status"]>("TODO");
  const [editPriority, setEditPriority] = useState<Issue["priority"]>("MEDIUM");
  const [editAssigneeUid, setEditAssigneeUid] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");

  const [commentBody, setCommentBody] = useState("");
  const commentRef = useRef<HTMLTextAreaElement | null>(null);

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "私";
  }, [profile?.displayName, user?.email]);

  const assigneeName = (uid?: string | null) => {
    if (!uid) return "";
    if (uid === user?.uid) return myDisplayName;
    return employees.find(e => e.authUid === uid)?.name || "";
  };

  const loadAll = async (u: User, prof: MemberProfile) => {
    // project
    const pSnap = await getDoc(doc(db, "projects", projectId));
    if (pSnap.exists()) setProject({ ...(pSnap.data() as Project), id: projectId });

    // employees (company + createdBy fallback)
    const mergedEmp: Employee[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
      mergedEmp.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }
    const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
    mergedEmp.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    const empById = new Map<string, Employee>();
    for (const e of mergedEmp) empById.set(e.id, e);
    const empItems = Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setEmployees(empItems);

    // issue
    const iSnap = await getDoc(doc(db, "issues", issueId));
    if (!iSnap.exists()) {
      setIssue(null);
      return;
    }
    const i = { ...(iSnap.data() as Issue), id: issueId } as Issue;
    setIssue(i);
    setEditTitle(i.title || "");
    setEditDescription(i.description || "");
    setEditStatus(i.status || "TODO");
    setEditPriority(i.priority || "MEDIUM");
    setEditAssigneeUid((i.assigneeUid as any) || "");
    setEditStartDate((i.startDate as any) || "");
    setEditDueDate((i.dueDate as any) || "");

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
    } else {
      setComments([]);
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
      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profSnap.exists()) {
        setLoading(false);
        router.push("/login");
        return;
      }
      const prof = profSnap.data() as MemberProfile;
      setProfile(prof);
      await loadAll(u, prof);
      setLoading(false);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, projectId, issueId]);

  const save = async () => {
    if (!user || !profile || !issue) return;
    setError("");
    const t = editTitle.trim();
    if (!t) {
      setError("件名を入力してください");
      return;
    }
    setSaving(true);
    try {
      const prevAssignee = issue.assigneeUid || null;
      const nextAssignee = editAssigneeUid || null;
      await updateDoc(doc(db, "issues", issue.id), {
        title: t,
        description: editDescription.trim(),
        status: editStatus,
        priority: editPriority,
        assigneeUid: nextAssignee,
        startDate: editStartDate || null,
        dueDate: editDueDate || null,
        updatedAt: Timestamp.now(),
      });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "ISSUE_UPDATED",
        projectId,
        issueId: issue.id,
        entityId: issue.id,
        message: `課題を更新: ${issue.issueKey} ${t}`,
        link: `/projects/${projectId}/issues/${issue.id}`,
      });

      if (nextAssignee && nextAssignee !== prevAssignee && nextAssignee !== user.uid) {
        await pushNotification({
          companyCode: profile.companyCode,
          recipientUid: nextAssignee,
          actorUid: user.uid,
          type: "ASSIGNED",
          title: `課題が割り当てられました: ${issue.issueKey}`,
          body: t,
          link: `/projects/${projectId}/issues/${issue.id}`,
        });
      }

      await loadAll(user, profile);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "更新に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const addComment = async () => {
    if (!user || !profile || !issue) return;
    setError("");
    const body = commentBody.trim();
    if (!body) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "issueComments"), {
        companyCode: profile.companyCode,
        issueId: issue.id,
        authorUid: user.uid,
        body,
        createdAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "COMMENT_ADDED",
        projectId,
        issueId: issue.id,
        entityId: issue.id,
        message: `コメント追加: ${issue.issueKey}`,
        link: `/projects/${projectId}/issues/${issue.id}`,
      });
      setCommentBody("");
      await loadAll(user, profile);
      requestAnimationFrame(() => commentRef.current?.focus());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "コメントの追加に失敗しました";
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
            <Link href={`/projects/${projectId}/issues`} className="text-sm font-bold text-emerald-700 hover:underline">
              課題一覧へ戻る
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const statusLabel = ISSUE_STATUSES.find(s => s.value === editStatus)?.label || editStatus;
  const priorityLabel = ISSUE_PRIORITIES.find(p => p.value === editPriority)?.label || editPriority;

  return (
    <AppShell 
      title={`${project?.key || ""} ${project?.name || ""}`.trim() || "課題詳細"}
      subtitle={
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/projects/${projectId}/issues`} className="hover:underline text-slate-500">課題</Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">{issue.issueKey}</span>
        </div>
      }
      projectId={projectId}
      headerRight={
        <button
          onClick={saveChanges}
          disabled={saving}
          className={clsx(
            "rounded-md px-4 py-2 text-sm font-extrabold text-white",
            saving ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700",
          )}
        >
          {saving ? "保存中..." : "更新"}
        </button>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-emerald-700">{issue.issueKey}</div>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 w-full max-w-[760px] rounded-md border border-slate-200 px-3 py-2 text-lg font-extrabold text-slate-900 outline-none focus:border-emerald-500"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={clsx(
                  "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                  editStatus === "DONE" ? "bg-emerald-100 text-emerald-700" :
                  editStatus === "IN_PROGRESS" ? "bg-sky-100 text-sky-700" :
                  "bg-rose-100 text-rose-700",
                )}>
                  {statusLabel}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
                  優先度: {priorityLabel}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
                  担当: {assigneeName(editAssigneeUid) || "未割当"}
                </span>
              </div>
            </div>
            <Link
              href={`/projects/new?projectId=${encodeURIComponent(projectId)}`}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              ＋課題追加
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="text-xs font-extrabold text-slate-500">状態</div>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as Issue["status"])}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
              >
                {ISSUE_STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <div className="text-xs font-extrabold text-slate-500">優先度</div>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as Issue["priority"])}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
              >
                {ISSUE_PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold text-slate-500">担当者</div>
                <button
                  type="button"
                  onClick={() => setEditAssigneeUid(user.uid)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  👤 私が担当
                </button>
              </div>
              <select
                value={editAssigneeUid}
                onChange={(e) => setEditAssigneeUid(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
              >
                <option value="">未割当</option>
                <option value={user.uid}>{myDisplayName}</option>
                {employees.filter(e => !!e.authUid && e.authUid !== user.uid).map(e => (
                  <option key={e.id} value={e.authUid}>{e.name}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">開始日</div>
              <input
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
              />
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">期限日</div>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
              />
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-extrabold text-slate-500">詳細</div>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="mt-1 min-h-[180px] w-full rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-800 outline-none focus:border-emerald-500"
              placeholder="詳細を入力"
            />
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900">コメント</div>
          <div className="mt-4 space-y-4">
            {comments.length === 0 ? (
              <div className="text-sm text-slate-600">コメントはまだありません。</div>
            ) : (
              comments.map((c) => {
                const dt = (c.createdAt as any)?.toDate?.() ? (c.createdAt as any).toDate() as Date : null;
                const who = c.authorUid === user.uid ? myDisplayName : (employees.find(e => e.authUid === c.authorUid)?.name || "ユーザー");
                return (
                  <div key={c.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-extrabold text-slate-900">{who}</div>
                      <div className="text-xs text-slate-500">{dt ? relativeFromNow(dt) : ""}</div>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{c.body}</div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-5">
            <textarea
              ref={commentRef}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              className="min-h-[90px] w-full rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-800 outline-none focus:border-emerald-500"
              placeholder="コメントを入力"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={addComment}
                disabled={saving}
                className={clsx(
                  "rounded-md px-4 py-2 text-sm font-extrabold text-white",
                  saving ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700",
                )}
              >
                {saving ? "送信中..." : "コメント"}
              </button>
            </div>
          </div>
        </div>
    </AppShell>
  );
}

