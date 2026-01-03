"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import type { Issue, IssueComment, Project, ProjectFile, WikiPage } from "../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, normalizeProjectKey } from "../../../lib/backlog";
import { logActivity, pushNotification } from "../../../lib/activity";

type MemberProfile = {
  uid: string;
  companyCode: string;
};

type Company = {
  ownerUid: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
};

type Tab = "overview" | "issues" | "board" | "gantt" | "wiki" | "files";

function ProjectDetailInner() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const searchParams = useSearchParams();
  const router = useRouter();

  const tab = (searchParams.get("tab") as Tab) || "issues";

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [wikiPages, setWikiPages] = useState<WikiPage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);

  // Issue create/edit modal
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDesc, setIssueDesc] = useState("");
  const [issueStatus, setIssueStatus] = useState<Issue["status"]>("TODO");
  const [issuePriority, setIssuePriority] = useState<Issue["priority"]>("MEDIUM");
  const [issueAssignee, setIssueAssignee] = useState<string>("");
  const [issueStart, setIssueStart] = useState("");
  const [issueDue, setIssueDue] = useState("");
  const [issueLabels, setIssueLabels] = useState("");
  const [issueError, setIssueError] = useState("");

  // Issue detail (comments)
  const [showIssueDetail, setShowIssueDetail] = useState(false);
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentBody, setCommentBody] = useState("");

  // Wiki
  const [showWikiEditor, setShowWikiEditor] = useState(false);
  const [editingWiki, setEditingWiki] = useState<WikiPage | null>(null);
  const [wikiTitle, setWikiTitle] = useState("");
  const [wikiSlug, setWikiSlug] = useState("");
  const [wikiBody, setWikiBody] = useState("");
  const [wikiError, setWikiError] = useState("");

  // Files (metadata)
  const [showFileModal, setShowFileModal] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileError, setFileError] = useState("");

  const isManager = useMemo(() => !!(user && company && company.ownerUid === user.uid), [user, company]);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(searchParams.toString());
    if (next === "issues") p.delete("tab");
    else p.set("tab", next);
    router.push(`/projects/${projectId}?${p.toString()}`);
  };

  const loadEmployees = useCallback(async (uid: string, companyCode: string) => {
    const merged: Employee[] = [];
    if (companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", companyCode)));
      merged.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }
    const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", uid)));
    merged.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    const items = Array.from(byId.values());
    setEmployees(items);
    return items;
  }, []);

  const loadAll = useCallback(async (uid: string, companyCode: string) => {
    const pSnap = await getDoc(doc(db, "projects", projectId));
    if (!pSnap.exists()) {
      setProject(null);
      setLoading(false);
      return;
    }
    const p = { ...(pSnap.data() as Project), id: projectId } as Project;
    setProject(p);

    // 課題
    const issuesSnap = await getDocs(
      query(
        collection(db, "issues"),
        where("companyCode", "==", companyCode),
        where("projectId", "==", projectId),
      ),
    );
    const issueItems = issuesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Issue));
    issueItems.sort((a, b) => (a.issueKey || "").localeCompare(b.issueKey || ""));
    setIssues(issueItems);

    // Wiki
    const wikiSnap = await getDocs(
      query(
        collection(db, "wikiPages"),
        where("companyCode", "==", companyCode),
        where("projectId", "==", projectId),
      ),
    );
    const wikiItems = wikiSnap.docs.map(d => ({ id: d.id, ...d.data() } as WikiPage));
    wikiItems.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    setWikiPages(wikiItems);

    // Files
    const fileSnap = await getDocs(
      query(
        collection(db, "projectFiles"),
        where("companyCode", "==", companyCode),
        where("projectId", "==", projectId),
      ),
    );
    const fileItems = fileSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectFile));
    fileItems.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setFiles(fileItems);
  }, [projectId]);

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

      if (prof.companyCode) {
        const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
        if (compSnap.exists()) setCompany(compSnap.data() as Company);
      }

      await loadEmployees(u.uid, prof.companyCode);
      await loadAll(u.uid, prof.companyCode);
      setLoading(false);
    });
    return () => unsub();
  }, [router, loadAll, loadEmployees]);

  const canAccess = useMemo(() => {
    if (!user || !project) return false;
    if (isManager) return true;
    return Array.isArray(project.memberUids) && project.memberUids.includes(user.uid);
  }, [user, project, isManager]);

  useEffect(() => {
    if (!loading && project && user && !canAccess) {
      router.push("/projects");
    }
  }, [loading, project, user, canAccess, router]);

  const openCreateIssue = () => {
    if (!project || !user) return;
    setIssueError("");
    setEditingIssue(null);
    setIssueTitle("");
    setIssueDesc("");
    setIssueStatus("TODO");
    setIssuePriority("MEDIUM");
    setIssueAssignee("");
    setIssueStart("");
    setIssueDue("");
    setIssueLabels("");
    setShowIssueModal(true);
  };

  const openEditIssue = (i: Issue) => {
    setIssueError("");
    setEditingIssue(i);
    setIssueTitle(i.title || "");
    setIssueDesc(i.description || "");
    setIssueStatus(i.status);
    setIssuePriority(i.priority);
    setIssueAssignee(i.assigneeUid || "");
    setIssueStart(i.startDate || "");
    setIssueDue(i.dueDate || "");
    setIssueLabels((i.labels || []).join(", "));
    setShowIssueModal(true);
  };

  const saveIssue = async () => {
    if (!user || !profile || !project) return;
    setIssueError("");
    const title = issueTitle.trim();
    if (!title) {
      setIssueError("タイトルを入力してください");
      return;
    }
    const labels = issueLabels
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 20);

    if (editingIssue) {
      const prevAssignee = editingIssue.assigneeUid || null;
      const nextAssignee = issueAssignee || null;
      await updateDoc(doc(db, "issues", editingIssue.id), {
        title,
        description: issueDesc.trim(),
        status: issueStatus,
        priority: issuePriority,
        assigneeUid: nextAssignee,
        startDate: issueStart || null,
        dueDate: issueDue || null,
        labels,
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "ISSUE_UPDATED",
        projectId,
        issueId: editingIssue.id,
        entityId: editingIssue.id,
        message: `課題を更新: ${editingIssue.issueKey} ${title}`,
        link: `/projects/${projectId}?tab=issues`,
      });

      if (nextAssignee && nextAssignee !== prevAssignee && nextAssignee !== user.uid) {
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "ASSIGNEE_CHANGED",
          projectId,
          issueId: editingIssue.id,
          entityId: editingIssue.id,
          message: `担当者変更: ${editingIssue.issueKey} → ${employees.find(e => e.authUid === nextAssignee)?.name || "ユーザー"}`,
          link: `/projects/${projectId}?tab=issues`,
        });
        await pushNotification({
          companyCode: profile.companyCode,
          recipientUid: nextAssignee,
          actorUid: user.uid,
          type: "ASSIGNED",
          title: `課題が割り当てられました: ${editingIssue.issueKey}`,
          body: title,
          link: `/projects/${projectId}?tab=issues`,
        });
      }
      setShowIssueModal(false);
      await loadAll(user.uid, profile.companyCode);
      return;
    }

    // 新規は連番キーを transaction で生成
    const projectRef = doc(db, "projects", projectId);
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(projectRef);
      if (!snap.exists()) throw new Error("プロジェクトが見つかりません");
      const data = snap.data() as Project;
      const nextSeq = (data.issueSeq || 0) + 1;
      tx.update(projectRef, { issueSeq: nextSeq });
      const issueKey = `${normalizeProjectKey(data.key || project.key)}-${nextSeq}`;
      const issueRef = doc(collection(db, "issues"));
      tx.set(issueRef, {
        companyCode: profile.companyCode,
        projectId,
        issueKey,
        title,
        description: issueDesc.trim(),
        status: issueStatus,
        priority: issuePriority,
        assigneeUid: issueAssignee || null,
        reporterUid: user.uid,
        labels,
        startDate: issueStart || null,
        dueDate: issueDue || null,
        parentIssueId: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      return { issueId: issueRef.id, issueKey };
    });

    // 互換性でidを入れたい場合
    await setDoc(doc(db, "issues", result.issueId), { id: result.issueId }, { merge: true });
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "ISSUE_CREATED",
      projectId,
      issueId: result.issueId,
      entityId: result.issueId,
      message: `課題を作成: ${result.issueKey} ${title}`,
      link: `/projects/${projectId}?tab=issues`,
    });
    if (issueAssignee && issueAssignee !== user.uid) {
      await pushNotification({
        companyCode: profile.companyCode,
        recipientUid: issueAssignee,
        actorUid: user.uid,
        type: "ASSIGNED",
        title: `課題が割り当てられました: ${result.issueKey}`,
        body: title,
        link: `/projects/${projectId}?tab=issues`,
      });
    }

    setShowIssueModal(false);
    await loadAll(user.uid, profile.companyCode);
  };

  const deleteIssueById = async (issueId: string) => {
    if (!user || !profile) return;
    if (!confirm("この課題を削除しますか？")) return;
    await deleteDoc(doc(db, "issues", issueId));
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "ISSUE_DELETED",
      projectId,
      issueId,
      entityId: issueId,
      message: `課題を削除`,
      link: `/projects/${projectId}?tab=issues`,
    });
    // コメント等はMVPでは孤児になり得る（必要ならCloud Functionで掃除）
    await loadAll(user.uid, profile.companyCode);
    if (detailIssue?.id === issueId) {
      setShowIssueDetail(false);
      setDetailIssue(null);
    }
  };

  const openIssueDetail = async (i: Issue) => {
    if (!user || !profile) return;
    setDetailIssue(i);
    setShowIssueDetail(true);
    const snap = await getDocs(
      query(
        collection(db, "issueComments"),
        where("companyCode", "==", profile.companyCode),
        where("issueId", "==", i.id),
      ),
    );
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as IssueComment));
    items.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    setComments(items);
  };

  const addComment = async () => {
    if (!user || !profile || !detailIssue) return;
    const body = commentBody.trim();
    if (!body) return;
    await addDoc(collection(db, "issueComments"), {
      companyCode: profile.companyCode,
      issueId: detailIssue.id,
      authorUid: user.uid,
      body,
      createdAt: Timestamp.now(),
    });
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "COMMENT_ADDED",
      projectId,
      issueId: detailIssue.id,
      entityId: detailIssue.id,
      message: `コメント追加: ${detailIssue.issueKey}`,
      link: `/projects/${projectId}?tab=issues`,
    });
    setCommentBody("");
    await openIssueDetail(detailIssue);
  };

  const openNewWiki = () => {
    setWikiError("");
    setEditingWiki(null);
    setWikiTitle("");
    setWikiSlug("");
    setWikiBody("");
    setShowWikiEditor(true);
  };

  const openEditWiki = (w: WikiPage) => {
    setWikiError("");
    setEditingWiki(w);
    setWikiTitle(w.title || "");
    setWikiSlug(w.slug || "");
    setWikiBody(w.body || "");
    setShowWikiEditor(true);
  };

  const saveWiki = async () => {
    if (!user || !profile || !project) return;
    setWikiError("");
    const title = wikiTitle.trim();
    const slug = wikiSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 64);
    if (!title) {
      setWikiError("タイトルを入力してください");
      return;
    }
    if (!slug) {
      setWikiError("slug（URL用識別子）を入力してください");
      return;
    }
    if (editingWiki) {
      await updateDoc(doc(db, "wikiPages", editingWiki.id), {
        title,
        slug,
        body: wikiBody,
        updatedBy: user.uid,
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "WIKI_UPDATED",
        projectId,
        entityId: editingWiki.id,
        message: `Wiki更新: ${title}`,
        link: `/projects/${projectId}?tab=wiki`,
      });
    } else {
      const ref = await addDoc(collection(db, "wikiPages"), {
        companyCode: profile.companyCode,
        projectId,
        title,
        slug,
        body: wikiBody,
        updatedBy: user.uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "wikiPages", ref.id), { id: ref.id }, { merge: true });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "WIKI_CREATED",
        projectId,
        entityId: ref.id,
        message: `Wiki作成: ${title}`,
        link: `/projects/${projectId}?tab=wiki`,
      });
    }
    setShowWikiEditor(false);
    await loadAll(user.uid, profile.companyCode);
  };

  const deleteWikiById = async (id: string) => {
    if (!user || !profile) return;
    if (!confirm("Wikiページを削除しますか？")) return;
    await deleteDoc(doc(db, "wikiPages", id));
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "WIKI_DELETED",
      projectId,
      entityId: id,
      message: `Wiki削除`,
      link: `/projects/${projectId}?tab=wiki`,
    });
    await loadAll(user.uid, profile.companyCode);
  };

  const addFileMeta = async () => {
    if (!user || !profile || !project) return;
    setFileError("");
    const name = fileName.trim();
    if (!name) {
      setFileError("ファイル名を入力してください");
      return;
    }
    await addDoc(collection(db, "projectFiles"), {
      companyCode: profile.companyCode,
      projectId,
      name,
      url: fileUrl.trim() || null,
      uploadedBy: user.uid,
      createdAt: Timestamp.now(),
    });
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "FILE_ADDED",
      projectId,
      message: `ファイル追加: ${name}`,
      link: `/projects/${projectId}?tab=files`,
    });
    setFileName("");
    setFileUrl("");
    setShowFileModal(false);
    await loadAll(user.uid, profile.companyCode);
  };

  const deleteFileById = async (id: string) => {
    if (!user || !profile) return;
    if (!confirm("ファイル情報を削除しますか？（実ファイルの削除は別途）")) return;
    await deleteDoc(doc(db, "projectFiles", id));
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "FILE_DELETED",
      projectId,
      entityId: id,
      message: `ファイル削除`,
      link: `/projects/${projectId}?tab=files`,
    });
    await loadAll(user.uid, profile.companyCode);
  };

  const groupedByStatus = useMemo(() => {
    const map: Record<Issue["status"], Issue[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
    for (const i of issues) map[i.status]?.push(i);
    return map;
  }, [issues]);

  const ganttRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100">
        <div className="text-2xl font-bold text-orange-900">読み込み中...</div>
      </div>
    );
  }
  if (!user || !profile) return null;

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-50">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="rounded-2xl border-2 border-orange-200 bg-white p-8">
            <div className="text-xl font-bold text-orange-950">プロジェクトが見つかりません</div>
            <div className="mt-4">
              <Link href="/projects" className="font-bold text-orange-900 underline">
                ← プロジェクト一覧へ
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Backlog風：上部ナビ（簡易） */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3">
          <Link
            href={`/dashboard?projectId=${encodeURIComponent(projectId)}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white font-extrabold"
          >
            B
          </Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-slate-900">
              {project.key} {project.name}
            </div>
            <div className="truncate text-xs font-bold text-slate-500">
              <Link href="/projects" className="hover:underline">プロジェクト</Link>
              <span className="mx-2">/</span>
              <span className="text-slate-700">{tab === "issues" ? "課題" : tab}</span>
            </div>
          </div>
          <div className="flex flex-1" />
            <Link
              href={`/issue/new?projectId=${encodeURIComponent(projectId)}`}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
            >
              課題の追加
            </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        {/* Left Sidebar（全リンクを実在ルートへ統一） */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-orange-600 text-white md:block">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="font-extrabold">☰</div>
              <div className="text-sm font-bold opacity-90">{project.key}</div>
              <div />
            </div>
          </div>
          <div className="px-2 pb-6">
            <Link href={`/projects/${projectId}/home`} className="mx-2 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              🏠 ホーム
            </Link>
            <Link href={`/issue/new?projectId=${encodeURIComponent(projectId)}`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              ➕ 課題の追加
            </Link>
            <Link href={`/projects/${projectId}/issues`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg bg-white/20 px-3 py-3 text-sm font-extrabold">
              📋 課題
            </Link>
            <Link href={`/projects/${projectId}/board`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              🧱 ボード
            </Link>
            <Link href={`/projects/${projectId}/gantt`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              📈 ガントチャート
            </Link>
            <Link href={`/projects/${projectId}/documents`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              📄 ドキュメント
            </Link>
            <Link href={`/projects/${projectId}/wiki`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              📚 Wiki
            </Link>
            <Link href={`/projects/${projectId}/files`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              📎 ファイル
            </Link>
            <Link href={`/projects/${projectId}/settings`} className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold hover:bg-white/15">
              ⚙️ プロジェクト設定
            </Link>
          </div>
        </aside>

        <main className="flex-1 px-4 py-6">
          <div className="mx-auto max-w-7xl px-2">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-orange-700">{project.key}</div>
            <h1 className="text-3xl font-bold text-orange-950">{project.name}</h1>
            {project.description ? (
              <div className="mt-2 max-w-3xl text-sm text-orange-800">{project.description}</div>
            ) : null}
            <div className="mt-2 text-xs text-orange-700">
              会社: <span className="font-semibold text-orange-900">{profile.companyCode}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/projects"
              className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 shadow-sm transition hover:shadow"
            >
              ← 一覧へ
            </Link>
            <Link
              href="/my/tasks"
              className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 shadow-sm transition hover:shadow"
            >
              自分のタスク
            </Link>
            <button
              onClick={openCreateIssue}
              className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
            >
              + 課題を追加
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              { key: "issues", label: "課題一覧" },
              { key: "board", label: "カンバン" },
              { key: "gantt", label: "ガント" },
              { key: "wiki", label: "Wiki" },
              { key: "files", label: "ファイル" },
              { key: "overview", label: "概要" },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                tab === t.key ? "bg-orange-900 text-white" : "bg-orange-100 text-orange-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "issues" && (
          <div className="rounded-2xl border-2 border-orange-200 bg-white">
            <div className="grid grid-cols-12 bg-orange-50 px-4 py-3 text-xs font-bold text-orange-900">
              <div className="col-span-2">キー</div>
              <div className="col-span-4">タイトル</div>
              <div className="col-span-2">状態</div>
              <div className="col-span-2">優先度</div>
              <div className="col-span-2">担当</div>
            </div>
            {issues.length === 0 ? (
              <div className="p-6 text-sm text-orange-800">課題がありません。右上から追加できます。</div>
            ) : (
              issues.map((i) => {
                const statusLabel = ISSUE_STATUSES.find(s => s.value === i.status)?.label || i.status;
                const prioLabel = ISSUE_PRIORITIES.find(p => p.value === i.priority)?.label || i.priority;
                const assigneeName =
                  employees.find(e => e.authUid === i.assigneeUid)?.name ||
                  (i.assigneeUid ? "（不明）" : "未割当");
                return (
                  <div
                    key={i.id}
                    className="grid cursor-pointer grid-cols-12 items-center border-t border-orange-100 px-4 py-3 text-sm hover:bg-orange-50"
                    onClick={() => openIssueDetail(i)}
                  >
                    <div className="col-span-2 font-bold text-orange-900">{i.issueKey}</div>
                    <div className="col-span-4 text-orange-950">{i.title}</div>
                    <div className="col-span-2 text-orange-800">{statusLabel}</div>
                    <div className="col-span-2 text-orange-800">{prioLabel}</div>
                    <div className="col-span-2 text-orange-800">{assigneeName}</div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "board" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ISSUE_STATUSES.map((s) => (
              <div key={s.value} className="rounded-2xl border-2 border-orange-200 bg-white">
                <div className="flex items-center justify-between border-b border-orange-100 bg-orange-50 px-4 py-3">
                  <div className="text-sm font-bold text-orange-950">{s.label}</div>
                  <div className="rounded-full bg-orange-200 px-2 py-0.5 text-xs font-bold text-orange-900">
                    {groupedByStatus[s.value].length}
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  {groupedByStatus[s.value].length === 0 ? (
                    <div className="rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-700">なし</div>
                  ) : (
                    groupedByStatus[s.value].map((i) => (
                      <button
                        key={i.id}
                        onClick={() => openIssueDetail(i)}
                        className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-left shadow-sm transition hover:shadow"
                      >
                        <div className="text-xs font-bold text-orange-700">{i.issueKey}</div>
                        <div className="mt-0.5 text-sm font-semibold text-orange-950">{i.title}</div>
                        {i.dueDate ? (
                          <div className="mt-1 text-xs text-orange-700">期限: {i.dueDate}</div>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "gantt" && (
          <div className="rounded-2xl border-2 border-orange-200 bg-white p-5">
            <div className="mb-3 text-sm font-bold text-orange-950">
              ガント（今月） <span className="ml-2 text-xs text-orange-700">※MVP: 期限/開始日がある課題のみ</span>
            </div>
            <div className="space-y-3">
              {issues
                .filter(i => i.startDate || i.dueDate)
                .map((i) => {
                  const start = i.startDate ? new Date(`${i.startDate}T00:00:00`) : ganttRange.start;
                  const due = i.dueDate ? new Date(`${i.dueDate}T00:00:00`) : ganttRange.end;
                  const total = Math.max(1, (ganttRange.end.getTime() - ganttRange.start.getTime()) / 86400000 + 1);
                  const left = Math.max(0, (start.getTime() - ganttRange.start.getTime()) / 86400000) / total;
                  const right = Math.min(total - 1, (due.getTime() - ganttRange.start.getTime()) / 86400000) / total;
                  const width = Math.max(0.02, right - left + 1 / total);
                  return (
                    <div key={i.id} className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-orange-700">{i.issueKey}</div>
                          <div className="truncate text-sm font-semibold text-orange-950">{i.title}</div>
                        </div>
                        <button
                          onClick={() => openIssueDetail(i)}
                          className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-bold text-orange-900"
                        >
                          開く
                        </button>
                      </div>
                      <div className="mt-2 h-3 w-full rounded-full bg-white">
                        <div
                          className="h-3 rounded-full bg-gradient-to-r from-orange-400 to-orange-500"
                          style={{ marginLeft: `${left * 100}%`, width: `${width * 100}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-orange-700">
                        {i.startDate ? `開始: ${i.startDate}` : "開始: -"} / {i.dueDate ? `期限: ${i.dueDate}` : "期限: -"}
                      </div>
                    </div>
                  );
                })}
              {issues.filter(i => i.startDate || i.dueDate).length === 0 && (
                <div className="text-sm text-orange-700">開始日または期限がある課題がありません。</div>
              )}
            </div>
          </div>
        )}

        {tab === "wiki" && (
          <div className="rounded-2xl border-2 border-orange-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-bold text-orange-950">Wiki</div>
              <button
                onClick={openNewWiki}
                className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
              >
                + 新規ページ
              </button>
            </div>
            <div className="space-y-2">
              {wikiPages.length === 0 ? (
                <div className="text-sm text-orange-700">Wikiページがありません。</div>
              ) : (
                wikiPages.map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-orange-950">{w.title}</div>
                      <div className="truncate text-xs text-orange-700">slug: {w.slug}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditWiki(w)}
                        className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-orange-900"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => deleteWikiById(w.id)}
                        className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-red-700"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "files" && (
          <div className="rounded-2xl border-2 border-orange-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-orange-950">ファイル共有</div>
                <div className="mt-1 text-xs text-orange-700">
                  ※MVP: URL/メタデータ保存。実ファイルアップロードはFirebase Storage接続で拡張できます。
                </div>
              </div>
              <button
                onClick={() => {
                  setFileError("");
                  setFileName("");
                  setFileUrl("");
                  setShowFileModal(true);
                }}
                className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
              >
                + 追加
              </button>
            </div>

            <div className="space-y-2">
              {files.length === 0 ? (
                <div className="text-sm text-orange-700">ファイルがありません。</div>
              ) : (
                files.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-orange-950">{f.name}</div>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer" className="truncate text-xs font-semibold text-orange-900 underline">
                          {f.url}
                        </a>
                      ) : (
                        <div className="text-xs text-orange-700">URLなし</div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteFileById(f.id)}
                      className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-red-700"
                    >
                      削除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "overview" && (
          <div className="rounded-2xl border-2 border-orange-200 bg-white p-6">
            <div className="text-sm font-bold text-orange-950">概要</div>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-xs font-bold text-orange-700">課題数</div>
                <div className="mt-1 text-2xl font-extrabold text-orange-950">{issues.length}</div>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-xs font-bold text-orange-700">未対応</div>
                <div className="mt-1 text-2xl font-extrabold text-orange-950">{groupedByStatus.TODO.length}</div>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-xs font-bold text-orange-700">完了</div>
                <div className="mt-1 text-2xl font-extrabold text-orange-950">{groupedByStatus.DONE.length}</div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
              <div className="font-bold text-orange-950">次に追加できる機能（Backlog互換の拡張）</div>
              <ul className="mt-2 list-disc pl-5">
                <li>ドラッグ&ドロップのカンバン</li>
                <li>親子課題・サブタスクの本格対応</li>
                <li>バーンダウン（スプリント）</li>
                <li>ファイルの実アップロード（Firebase Storage）</li>
                <li>通知・メンション</li>
              </ul>
            </div>
          </div>
        )}
          </div>
        </main>
      </div>

      {/* Issue create/edit modal */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-3xl border-2 border-orange-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-orange-700">{editingIssue ? "編集" : "新規"}</div>
                <div className="text-2xl font-bold text-orange-950">課題</div>
              </div>
              <button
                onClick={() => setShowIssueModal(false)}
                className="rounded-xl border-2 border-orange-200 bg-white px-3 py-2 text-sm font-bold text-orange-900"
              >
                閉じる
              </button>
            </div>

            {issueError && (
              <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {issueError}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-bold text-orange-900">タイトル</div>
                <input
                  value={issueTitle}
                  onChange={(e) => setIssueTitle(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="例: 見積もり作成"
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">状態</div>
                <select
                  value={issueStatus}
                  onChange={(e) => setIssueStatus(e.target.value as Issue["status"])}
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                >
                  {ISSUE_STATUSES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">優先度</div>
                <select
                  value={issuePriority}
                  onChange={(e) => setIssuePriority(e.target.value as Issue["priority"])}
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                >
                  {ISSUE_PRIORITIES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">担当者</div>
                <select
                  value={issueAssignee}
                  onChange={(e) => setIssueAssignee(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                >
                  <option value="">未割当</option>
                  {employees
                    .filter(e => !!e.authUid)
                    .map(e => (
                      <option key={e.id} value={e.authUid}>{e.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">開始日</div>
                <input
                  type="date"
                  value={issueStart}
                  onChange={(e) => setIssueStart(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">期限</div>
                <input
                  type="date"
                  value={issueDue}
                  onChange={(e) => setIssueDue(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-bold text-orange-900">ラベル（カンマ区切り）</div>
                <input
                  value={issueLabels}
                  onChange={(e) => setIssueLabels(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="例: 営業, 緊急, UI"
                />
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-bold text-orange-900">詳細</div>
                <textarea
                  value={issueDesc}
                  onChange={(e) => setIssueDesc(e.target.value)}
                  className="h-28 w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="課題の詳細（任意）"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              {editingIssue && (
                <button
                  onClick={() => deleteIssueById(editingIssue.id)}
                  className="rounded-xl border-2 border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700"
                >
                  削除
                </button>
              )}
              <button
                onClick={() => setShowIssueModal(false)}
                className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900"
              >
                キャンセル
              </button>
              <button
                onClick={saveIssue}
                className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue detail modal (comments + quick actions) */}
      {showIssueDetail && detailIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-3xl border-2 border-orange-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-orange-700">{detailIssue.issueKey}</div>
                <div className="text-2xl font-bold text-orange-950">{detailIssue.title}</div>
                <div className="mt-2 text-sm text-orange-800 whitespace-pre-wrap">{detailIssue.description || "（詳細なし）"}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-orange-100 px-3 py-1 font-bold text-orange-900">
                    状態: {ISSUE_STATUSES.find(s => s.value === detailIssue.status)?.label || detailIssue.status}
                  </span>
                  <span className="rounded-full bg-orange-100 px-3 py-1 font-bold text-orange-900">
                    優先度: {ISSUE_PRIORITIES.find(p => p.value === detailIssue.priority)?.label || detailIssue.priority}
                  </span>
                  {detailIssue.dueDate ? (
                    <span className="rounded-full bg-orange-100 px-3 py-1 font-bold text-orange-900">期限: {detailIssue.dueDate}</span>
                  ) : null}
                  {(detailIssue.labels || []).map(l => (
                    <span key={l} className="rounded-full bg-white px-3 py-1 font-bold text-orange-900 border border-orange-200">
                      #{l}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => {
                    setShowIssueDetail(false);
                    openEditIssue(detailIssue);
                  }}
                  className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900"
                >
                  編集
                </button>
                <Link
                  href={`/calendar?create=1&prefillSummary=${encodeURIComponent(`${detailIssue.issueKey} ${detailIssue.title}`)}&prefillProject=${encodeURIComponent(project.name)}`}
                  className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-center text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
                >
                  工数をカレンダーに追加
                </Link>
                <button
                  onClick={() => setShowIssueDetail(false)}
                  className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900"
                >
                  閉じる
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-sm font-bold text-orange-950">コメント</div>
                <div className="mt-3 space-y-2">
                  {comments.length === 0 ? (
                    <div className="text-sm text-orange-700">コメントはまだありません。</div>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="rounded-xl bg-white p-3">
                        <div className="text-xs font-bold text-orange-700">{c.authorUid === user.uid ? "あなた" : c.authorUid}</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-orange-950">{c.body}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3">
                  <textarea
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    className="h-24 w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    placeholder="コメントを書く…"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={addComment}
                      className="rounded-xl bg-orange-900 px-4 py-2 text-sm font-bold text-white"
                    >
                      追加
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-sm font-bold text-orange-950">クイック更新</div>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <div>
                    <div className="mb-1 text-xs font-bold text-orange-900">状態</div>
                    <select
                      value={detailIssue.status}
                      onChange={async (e) => {
                        if (!user || !profile) return;
                        const next = e.target.value as Issue["status"];
                        await updateDoc(doc(db, "issues", detailIssue.id), { status: next, updatedAt: Timestamp.now() });
                        const updated = { ...detailIssue, status: next };
                        setDetailIssue(updated);
                        await logActivity({
                          companyCode: profile.companyCode,
                          actorUid: user.uid,
                          type: "ISSUE_UPDATED",
                          projectId,
                          issueId: detailIssue.id,
                          entityId: detailIssue.id,
                          message: `状態変更: ${detailIssue.issueKey} → ${ISSUE_STATUSES.find(s => s.value === next)?.label || next}`,
                          link: `/projects/${projectId}?tab=board`,
                        });
                        await loadAll(user.uid, profile.companyCode);
                      }}
                      className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 outline-none"
                    >
                      {ISSUE_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-bold text-orange-900">担当</div>
                    <select
                      value={detailIssue.assigneeUid || ""}
                      onChange={async (e) => {
                        if (!user || !profile) return;
                        const next = e.target.value || null;
                        await updateDoc(doc(db, "issues", detailIssue.id), { assigneeUid: next, updatedAt: Timestamp.now() });
                        const updated = { ...detailIssue, assigneeUid: next };
                        setDetailIssue(updated);
                        await logActivity({
                          companyCode: profile.companyCode,
                          actorUid: user.uid,
                          type: "ASSIGNEE_CHANGED",
                          projectId,
                          issueId: detailIssue.id,
                          entityId: detailIssue.id,
                          message: `担当者変更: ${detailIssue.issueKey}`,
                          link: `/projects/${projectId}?tab=issues`,
                        });
                        if (next && next !== user.uid) {
                          await pushNotification({
                            companyCode: profile.companyCode,
                            recipientUid: next,
                            actorUid: user.uid,
                            type: "ASSIGNED",
                            title: `課題が割り当てられました: ${detailIssue.issueKey}`,
                            body: detailIssue.title,
                            link: `/projects/${projectId}?tab=issues`,
                          });
                        }
                        await loadAll(user.uid, profile.companyCode);
                      }}
                      className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 outline-none"
                    >
                      <option value="">未割当</option>
                      {employees.filter(e => !!e.authUid).map(e => (
                        <option key={e.id} value={e.authUid}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => deleteIssueById(detailIssue.id)}
                    className="rounded-xl border-2 border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700"
                  >
                    この課題を削除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wiki editor modal */}
      {showWikiEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-3xl border-2 border-orange-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-orange-700">{editingWiki ? "編集" : "新規"}</div>
                <div className="text-2xl font-bold text-orange-950">Wikiページ</div>
              </div>
              <button
                onClick={() => setShowWikiEditor(false)}
                className="rounded-xl border-2 border-orange-200 bg-white px-3 py-2 text-sm font-bold text-orange-900"
              >
                閉じる
              </button>
            </div>

            {wikiError && (
              <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {wikiError}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">タイトル</div>
                <input
                  value={wikiTitle}
                  onChange={(e) => setWikiTitle(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">slug（URL用）</div>
                <input
                  value={wikiSlug}
                  onChange={(e) => setWikiSlug(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="例: how-to-deploy"
                />
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-bold text-orange-900">本文</div>
                <textarea
                  value={wikiBody}
                  onChange={(e) => setWikiBody(e.target.value)}
                  className="h-80 w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="MarkdownでもOK（プレビューは次の拡張で）"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowWikiEditor(false)}
                className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900"
              >
                キャンセル
              </button>
              <button
                onClick={saveWiki}
                className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File meta modal */}
      {showFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl border-2 border-orange-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-orange-700">追加</div>
                <div className="text-2xl font-bold text-orange-950">ファイル</div>
              </div>
              <button
                onClick={() => setShowFileModal(false)}
                className="rounded-xl border-2 border-orange-200 bg-white px-3 py-2 text-sm font-bold text-orange-900"
              >
                閉じる
              </button>
            </div>

            {fileError && (
              <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {fileError}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">名前</div>
                <input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="例: 要件定義書"
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-orange-900">URL（任意）</div>
                <input
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-orange-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  placeholder="例: Google Drive / Notion / S3 / Storage URL"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowFileModal(false)}
                className="rounded-xl border-2 border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900"
              >
                キャンセル
              </button>
              <button
                onClick={addFileMeta}
                className="rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2 text-sm font-bold text-orange-950 shadow-lg transition hover:scale-[1.02]"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-900">読み込み中...</div>
        </div>
      }
    >
      <ProjectDetailInner />
    </Suspense>
  );
}


