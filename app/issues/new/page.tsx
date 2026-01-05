"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import type { Issue, Project } from "../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, normalizeProjectKey } from "../../../lib/backlog";
import { logActivity, pushNotification } from "../../../lib/activity";
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

function toHoursText(minutes?: number | null) {
  if (!minutes || minutes <= 0) return "";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
}

function fromHoursText(text: string) {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 60);
}

function NewIssueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get("projectId") || "";
  const statusParam = (searchParams.get("status") || "").toUpperCase();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [issuesInProject, setIssuesInProject] = useState<Issue[]>([]);

  // form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Issue["status"]>("TODO");
  const [priority, setPriority] = useState<Issue["priority"]>("MEDIUM");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimateHours, setEstimateHours] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [parentIssueId, setParentIssueId] = useState("");

  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const descRef = useRef<HTMLTextAreaElement | null>(null);

  const labelList = useMemo(() => {
    const raw = labelsText
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    return Array.from(new Set(raw)).slice(0, 20);
  }, [labelsText]);

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "私";
  }, [profile?.displayName, user?.email]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const prof = (await ensureProfile(u)) as MemberProfile | null;
      if (!prof) {
        setLoading(false);
        router.push("/login");
        return;
      }
      setProfile(prof);

      // projects: companyCode + createdBy (過去データ救済)
      const mergedProjects: Project[] = [];
      if (prof.companyCode) {
        const snapByCompany = await getDocs(query(collection(db, "projects"), where("companyCode", "==", prof.companyCode)));
        mergedProjects.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      }
      const snapByCreator = await getDocs(query(collection(db, "projects"), where("createdBy", "==", u.uid)));
      mergedProjects.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      const byId = new Map<string, Project>();
      for (const p of mergedProjects) byId.set(p.id, p);
      const projItems = Array.from(byId.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setProjects(projItems);

      // employees (for assignee)
      const mergedEmployees: Employee[] = [];
      if (prof.companyCode) {
        const snapEmpByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
        mergedEmployees.push(...snapEmpByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
      }
      const snapEmpByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
      mergedEmployees.push(...snapEmpByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
      const empById = new Map<string, Employee>();
      for (const e of mergedEmployees) empById.set(e.id, e);
      const empItems = Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setEmployees(empItems);

      // initial project
      const initial =
        projectIdParam && projItems.some(p => p.id === projectIdParam)
          ? projectIdParam
          : projItems[0]?.id || "";
      
      if (initial) {
        // プロジェクトが選択されている場合は新しいURLにリダイレクト
        router.replace(`/issue/new?projectId=${encodeURIComponent(initial)}${statusParam ? `&status=${encodeURIComponent(statusParam)}` : ""}`);
        return;
      }

      setProjectId(initial);
      setLoading(false);
    });
    return () => unsub();
  }, [router, projectIdParam]);

  useEffect(() => {
    if (statusParam === "TODO" || statusParam === "IN_PROGRESS" || statusParam === "DONE") {
      setStatus(statusParam as Issue["status"]);
    }
  }, [statusParam]);

  useEffect(() => {
    const loadProjectAndIssues = async () => {
      if (!projectId) {
        setProject(null);
        setIssuesInProject([]);
        return;
      }
      const p = projects.find(pp => pp.id === projectId) || null;
      setProject(p);
      if (!profile?.companyCode) {
        setIssuesInProject([]);
        return;
      }
      // companyでまとめて取って projectIdでフィルタ（index回避）
      const snap = await getDocs(query(collection(db, "issues"), where("companyCode", "==", profile.companyCode)));
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Issue))
        .filter(i => i.projectId === projectId);
      items.sort((a, b) => (a.issueKey || "").localeCompare(b.issueKey || ""));
      setIssuesInProject(items);
    };
    void loadProjectAndIssues();
  }, [projectId, projects, profile?.companyCode]);

  const goDashboard = () => {
    router.push(`/dashboard${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
  };

  const insertAtCursor = (before: string, after = "") => {
    const el = descRef.current;
    if (!el) {
      setDescription(prev => prev + before + after);
      return;
    }
    const start = el.selectionStart ?? description.length;
    const end = el.selectionEnd ?? description.length;
    const selected = description.slice(start, end);
    const next = description.slice(0, start) + before + selected + after + description.slice(end);
    setDescription(next);
    // restore selection
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + before.length + selected.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleProjectChange = (id: string) => {
    setProjectId(id);
    router.replace(`/issues/new?projectId=${encodeURIComponent(id)}`);
  };

  const handleSubmit = async () => {
    if (!user || !profile) return;
    setError("");
    const t = title.trim();
    if (!projectId) {
      setError("プロジェクトを選択してください");
      return;
    }
    if (!t) {
      setError("件名を入力してください");
      return;
    }
    if (!project?.key) {
      setError("プロジェクトキーが未設定です（プロジェクト設定を確認してください）");
      return;
    }

    setSaving(true);
    try {
      const projectRef = doc(db, "projects", projectId);
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(projectRef);
        if (!snap.exists()) throw new Error("プロジェクトが見つかりません");
        const data = snap.data() as Project;
        const nextSeq = (data.issueSeq || 0) + 1;
        tx.update(projectRef, { issueSeq: nextSeq });
        const issueKey = `${normalizeProjectKey(data.key)}-${nextSeq}`;
        const issueRef = doc(collection(db, "issues"));
        tx.set(issueRef, {
          companyCode: profile.companyCode,
          projectId,
          issueKey,
          title: t,
          description: description.trim() || "",
          status,
          priority,
          assigneeUid: assigneeUid || null,
          reporterUid: user.uid,
          labels: labelList,
          startDate: startDate || null,
          dueDate: dueDate || null,
          estimateMinutes: fromHoursText(estimateHours) || null,
          parentIssueId: parentIssueId || null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        return { issueId: issueRef.id, issueKey };
      });

      await setDoc(doc(db, "issues", result.issueId), { id: result.issueId }, { merge: true });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "ISSUE_CREATED",
        projectId,
        issueId: result.issueId,
        entityId: result.issueId,
        message: `課題を作成: ${result.issueKey} ${t}`,
        link: `/projects/${projectId}/issues/${result.issueId}`,
      });

      if (assigneeUid && assigneeUid !== user.uid) {
        await pushNotification({
          companyCode: profile.companyCode,
          recipientUid: assigneeUid,
          actorUid: user.uid,
          type: "ASSIGNED",
          title: `課題が割り当てられました: ${result.issueKey}`,
          body: t,
          link: `/projects/${projectId}?tab=issues`,
        });
      }

      router.push(`/issue/${result.issueId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "課題の作成に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="課題の追加" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell 
      title="課題の追加" 
      subtitle={project ? `${project.key} ${project.name}` : ""}
      projectId={projectId}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(v => !v)}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {showPreview ? "編集" : "プレビュー"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={clsx(
              "rounded-md px-4 py-2 text-sm font-extrabold text-white",
              saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700",
            )}
          >
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      }
    >
      {/* Project Selector */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs font-bold text-slate-600 mb-2">プロジェクト</div>
        <select
          value={projectId}
          onChange={(e) => handleProjectChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-600">優先度</div>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Issue["priority"])}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    {ISSUE_PRIORITIES.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-8 flex items-end justify-end gap-2">
                  <button
                    onClick={() => setParentIssueId("")}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    親課題を設定する
                  </button>
                </div>

                <div className="md:col-span-12">
                  <div className="text-xs font-extrabold text-slate-600">件名</div>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-orange-300 bg-orange-50/30 px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500"
                    placeholder="件名"
                  />
                </div>

                <div className="md:col-span-12">
                  <div className="text-xs font-extrabold text-slate-600">課題の詳細（@ を入力してメンバーに通知：準備中）</div>
                  <div className="mt-2 rounded-md border border-slate-200">
                    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
                      <button onClick={() => insertAtCursor("**", "**")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">B</button>
                      <button onClick={() => insertAtCursor("*", "*")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">I</button>
                      <button onClick={() => insertAtCursor("~~", "~~")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">S</button>
                      <button onClick={() => insertAtCursor("\n- ")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">•</button>
                      <button onClick={() => insertAtCursor("\n> ")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">"</button>
                      <button onClick={() => insertAtCursor("`", "`")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">{"{}"}</button>
                      <button onClick={() => insertAtCursor("[", "](url)")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">🔗</button>
                      <div className="ml-auto">
                        <button
                          onClick={() => setShowPreview(v => !v)}
                          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                        >
                          {showPreview ? "編集" : "プレビュー"}
                        </button>
                      </div>
                    </div>

                    {!showPreview ? (
                      <textarea
                        ref={descRef}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="min-h-[260px] w-full resize-y px-3 py-3 text-sm text-slate-800 outline-none"
                        placeholder="ここに詳細を書いてください"
                      />
                    ) : (
                      <div className="min-h-[260px] whitespace-pre-wrap px-3 py-3 text-sm text-slate-800">
                        {description.trim() ? description : "（プレビュー：内容がありません）"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="md:col-span-12 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">状態</div>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as Issue["status"])}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                      >
                        {ISSUE_STATUSES.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-6">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-extrabold text-slate-600">担当者</div>
                        <button
                          type="button"
                          onClick={() => setAssigneeUid(user.uid)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                        >
                          👤 私が担当
                        </button>
                      </div>
                      <select
                        value={assigneeUid}
                        onChange={(e) => setAssigneeUid(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                      >
                        <option value="">未割当</option>
                        <option value={user.uid}>{myDisplayName}</option>
                        {employees
                          .filter(e => !!e.authUid && e.authUid !== user.uid)
                          .map(e => (
                            <option key={e.id} value={e.authUid}>
                              {e.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">開始日</div>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                      />
                    </div>

                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">期限日</div>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                      />
                    </div>

                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">予定時間（hours）</div>
                      <input
                        value={estimateHours}
                        onChange={(e) => setEstimateHours(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                        placeholder={toHoursText(60)}
                      />
                    </div>

                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">ラベル（カンマ区切り）</div>
                      <input
                        value={labelsText}
                        onChange={(e) => setLabelsText(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                        placeholder="例: フロント,急ぎ"
                      />
                      {labelList.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {labelList.map(l => (
                            <span key={l} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-12">
                      <div className="text-xs font-extrabold text-slate-600">親課題（任意）</div>
                      <select
                        value={parentIssueId}
                        onChange={(e) => setParentIssueId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                      >
                        <option value="">なし</option>
                        {issuesInProject.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.issueKey} {i.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={goDashboard}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className={clsx(
                "rounded-md px-4 py-2 text-sm font-extrabold text-white",
                saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700",
              )}
            >
              {saving ? "追加中..." : "追加"}
            </button>
          </div>
        </AppShell>
  );
}

export default function NewIssuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
        </div>
      }
    >
      <NewIssueInner />
    </Suspense>
  );
}

