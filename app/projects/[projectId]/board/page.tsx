"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
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
import { auth, db } from "../../../../lib/firebase";
import type { Issue, Project } from "../../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, formatLocalDate } from "../../../../lib/backlog";
import { logActivity } from "../../../../lib/activity";
import { AppShell } from "../../../AppShell";

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

function categoryFromIssue(i: Issue) {
  return (i.labels && i.labels[0]) ? String(i.labels[0]) : "";
}

function milestoneFromIssue(i: Issue) {
  return i.dueDate ? String(i.dueDate).slice(0, 7) : "";
}

export default function ProjectBoardPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [hideFilters, setHideFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Issue["status"] | null>(null);

  const todayStr = useMemo(() => formatLocalDate(new Date()), []);

  const assigneeName = (uid?: string | null) => {
    if (!uid) return "";
    if (uid === user?.uid) return profile?.displayName || user?.email?.split("@")[0] || "私";
    return employees.find(e => e.authUid === uid)?.name || "";
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

      try {
        const pSnap = await getDoc(doc(db, "projects", projectId));
        if (!pSnap.exists()) {
          setLoading(false);
          router.push("/projects");
          return;
        }
        setProject({ ...(pSnap.data() as Project), id: projectId });

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

        // issues: companyCodeのみ→projectId filter（index回避）
        if (prof.companyCode) {
          const snap = await getDocs(query(collection(db, "issues"), where("companyCode", "==", prof.companyCode)));
          const items = snap.docs
            .map(d => ({ id: d.id, ...d.data() } as Issue))
            .filter(i => i.projectId === projectId);
          items.sort((a, b) => {
            const am = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
            const bm = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
            return bm - am;
          });
          setIssues(items);
        } else {
          setIssues([]);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, projectId]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) {
      const c = categoryFromIssue(i);
      if (c) s.add(c);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const milestones = useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) {
      const m = milestoneFromIssue(i);
      if (m) s.add(m);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const filtered = useMemo(() => {
    return issues.filter(i => {
      if (categoryFilter && categoryFromIssue(i) !== categoryFilter) return false;
      if (milestoneFilter && milestoneFromIssue(i) !== milestoneFilter) return false;
      if (assigneeFilter && (i.assigneeUid || "") !== assigneeFilter) return false;
      return true;
    });
  }, [issues, categoryFilter, milestoneFilter, assigneeFilter]);

  const overdue = useMemo(() => {
    return filtered.filter(i => !!i.dueDate && String(i.dueDate) < todayStr && i.status !== "DONE");
  }, [filtered, todayStr]);

  const lanes = useMemo(() => {
    const todo = filtered.filter(i => i.status === "TODO");
    const prog = filtered.filter(i => i.status === "IN_PROGRESS");
    const done = filtered.filter(i => i.status === "DONE");
    return { todo, prog, done };
  }, [filtered]);

  const startDrag = (id: string) => setDraggingIssueId(id);
  const endDrag = () => {
    setDraggingIssueId(null);
    setDragOver(null);
  };

  const onDropToStatus = async (status: Issue["status"]) => {
    if (!user || !profile || !draggingIssueId) return;
    const issue = issues.find(i => i.id === draggingIssueId);
    if (!issue) return;
    if (issue.status === status) return;

    // optimistic
    setIssues(prev => prev.map(i => (i.id === draggingIssueId ? { ...i, status } : i)));
    try {
      await updateDoc(doc(db, "issues", draggingIssueId), {
        status,
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "ISSUE_UPDATED",
        projectId,
        issueId: draggingIssueId,
        entityId: draggingIssueId,
        message: `状態変更: ${issue.issueKey} → ${ISSUE_STATUSES.find(s => s.value === status)?.label || status}`,
        link: `/projects/${projectId}/issues/${draggingIssueId}`,
      });
    } catch (e) {
      // rollback
      setIssues(prev => prev.map(i => (i.id === draggingIssueId ? { ...i, status: issue.status } : i)));
      console.error("drop update failed:", e);
    } finally {
      endDrag();
    }
  };

  const Card = ({ i }: { i: Issue }) => {
    const who = assigneeName(i.assigneeUid) || "";
    const due = i.dueDate || "";
    return (
      <Link
        href={`/projects/${projectId}/issues/${i.id}`}
        draggable
        onDragStart={() => startDrag(i.id)}
        onDragEnd={endDrag}
        className={clsx(
          "block rounded-lg border bg-white p-3 shadow-sm",
          draggingIssueId === i.id ? "border-emerald-300 opacity-70" : "border-slate-200 hover:border-slate-300",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-700">
                {ISSUE_PRIORITIES.find(p => p.value === i.priority)?.label || "その他"}
              </span>
              <span className="text-xs font-extrabold text-emerald-700">{i.issueKey}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-sm font-bold text-slate-900">{i.title}</div>
          </div>
          <div className="text-slate-400">•••</div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
          <div className="truncate">{who || "—"}</div>
          <div className={clsx(due && due < todayStr && i.status !== "DONE" ? "text-red-600" : "")}>
            {due || ""}
          </div>
        </div>
      </Link>
    );
  };

  const Lane = (props: { title: string; count: number; colorDot: string; status?: Issue["status"]; items: Issue[]; allowDrop?: boolean }) => {
    const { title, count, colorDot, status, items, allowDrop = true } = props;
    return (
      <div
        className={clsx(
          "min-w-[280px] flex-1 rounded-lg border border-slate-200 bg-slate-50/40",
          allowDrop && dragOver === status ? "ring-2 ring-emerald-300" : "",
        )}
        onDragOver={(e) => {
          if (!allowDrop || !status) return;
          e.preventDefault();
          setDragOver(status);
        }}
        onDragLeave={() => {
          if (!allowDrop) return;
          setDragOver(null);
        }}
        onDrop={(e) => {
          if (!allowDrop || !status) return;
          e.preventDefault();
          void onDropToStatus(status);
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={clsx("h-3 w-3 rounded-full", colorDot)} />
            <div className="text-sm font-extrabold text-slate-900">{title}</div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-700">{count}</span>
          </div>
          {status ? (
            <Link
              href={`/projects/new?projectId=${encodeURIComponent(projectId)}&status=${encodeURIComponent(status)}`}
              className="rounded-md px-2 py-1 text-sm font-extrabold text-slate-600 hover:bg-slate-100"
              title="課題の追加"
            >
              ＋
            </Link>
          ) : (
            <span className="text-slate-400" />
          )}
        </div>
        <div className="space-y-3 p-3">
          {items.map((i) => (
            <Card key={i.id} i={i} />
          ))}
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs font-bold text-slate-500">
              ここには課題がありません
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <AppShell title="ボード" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell 
      title={`${project?.key || ""} ${project?.name || ""}`.trim() || "ボード"}
      subtitle="ボード"
      projectId={projectId}
      headerRight={
        <Link
          href={`/projects/new?projectId=${encodeURIComponent(projectId)}`}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-700"
        >
          課題の追加
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xl font-extrabold text-slate-900">ボード</div>
        <button
          onClick={() => setHideFilters(v => !v)}
          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
        >
          {hideFilters ? "フィルタを表示" : "フィルタを隠す"}
        </button>
      </div>

          {!hideFilters && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-500">カテゴリ</div>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">すべて</option>
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-500">マイルストーン</div>
                  <select
                    value={milestoneFilter}
                    onChange={(e) => setMilestoneFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">すべて</option>
                    {milestones.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-500">担当者</div>
                  <select
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">すべて</option>
                    <option value={user.uid}>私</option>
                    {employees.filter(e => !!e.authUid && e.authUid !== user.uid).map(e => (
                      <option key={e.id} value={e.authUid}>{e.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4 overflow-x-auto pb-4">
            <Lane title="未対応" count={lanes.todo.length} colorDot="bg-rose-500" status="TODO" items={lanes.todo} />
            <Lane title="処理中" count={lanes.prog.length} colorDot="bg-sky-500" status="IN_PROGRESS" items={lanes.prog} />
            <Lane title="処理済み" count={lanes.done.length} colorDot="bg-emerald-500" status="DONE" items={lanes.done} />
            <Lane title="[危険] 納期遅れ中" count={overdue.length} colorDot="bg-red-600" items={overdue} allowDrop={false} />
          </div>

          <div className="mt-2 text-xs font-bold text-slate-500">
            ドラッグ&ドロップで状態を更新できます。
          </div>
    </AppShell>
  );
}

