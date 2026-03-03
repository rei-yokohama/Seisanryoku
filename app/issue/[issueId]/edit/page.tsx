"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ensureProfile } from "../../../../lib/ensureProfile";
import type { Issue, Project } from "../../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../../lib/backlog";
import { logActivity, pushNotification } from "../../../../lib/activity";
import { ensureProperties, getCategoryValue, statusToLabel, statusToValue } from "../../../../lib/properties";
import type { Property } from "../../../../lib/properties";
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

type Customer = {
  id: string;
  name: string;
};

type DealProject = {
  id: string;
  name: string;
  key: string;
  customerId?: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/* ── 検索付きドロップダウン ── */
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  allowClear,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string; sub?: string }[];
  placeholder: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub && o.sub.toLowerCase().includes(q)));
  }, [options, search]);

  const selectedLabel = options.find((o) => o.id === value)?.label || "";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setSearch("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const handleSelect = useCallback((id: string) => {
    onChange(id);
    setOpen(false);
    setSearch("");
  }, [onChange]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={clsx(
          "w-full rounded-md border bg-white px-3 py-2 text-left text-sm font-bold outline-none transition pr-14",
          disabled ? "border-slate-200 text-slate-400 cursor-not-allowed" : "border-slate-200 text-slate-900 hover:border-orange-400 focus:ring-1 focus:ring-orange-500",
        )}
      >
        {selectedLabel || <span className="text-slate-400">{placeholder}</span>}
        <span className="absolute inset-y-0 right-3 flex items-center gap-1">
          {allowClear && value && !disabled && (
            <span role="button" className="text-slate-400 hover:text-slate-600 cursor-pointer" onClick={(e) => { e.stopPropagation(); onChange(""); }}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </span>
          )}
          <span className="pointer-events-none text-slate-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-2">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="検索..."
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs font-bold text-slate-400">該当なし</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleSelect(o.id)}
                  className={clsx("w-full px-3 py-2 text-left text-sm font-bold transition hover:bg-orange-50", o.id === value ? "bg-orange-50 text-orange-700" : "text-slate-800")}
                >
                  {o.label}
                  {o.sub && <span className="ml-2 text-[10px] text-slate-400">{o.sub}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GlobalIssueEditPage() {
  const router = useRouter();
  const params = useParams<{ issueId: string }>();
  const issueId = params.issueId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allProjects, setAllProjects] = useState<DealProject[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<Issue["status"]>("TODO");
  const [editPriority, setEditPriority] = useState<Issue["priority"]>("MEDIUM");
  const [editAssigneeUid, setEditAssigneeUid] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editLabelsText, setEditLabelsText] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [isSelfCompany, setIsSelfCompany] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [categoryProperty, setCategoryProperty] = useState<Property | null>(null);
  const [statusOptions, setStatusOptions] = useState<{ value: string; label: string }[]>(ISSUE_STATUSES);

  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  /** カテゴリ + その他ラベル（保存用。カテゴリは先頭） */
  const labelList = useMemo(() => {
    const rest = editLabelsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((l) => l !== editCategory);
    const list = editCategory ? [editCategory, ...rest] : rest;
    return Array.from(new Set(list)).slice(0, 20);
  }, [editCategory, editLabelsText]);

  const categorySelectOptions = useMemo(
    () =>
      Array.from(new Set([editCategory, ...categoryOptions]))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [editCategory, categoryOptions]
  );

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "ユーザー";
  }, [profile?.displayName, user?.email]);

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

        // 1. Fetch Issue
        const iSnap = await getDoc(doc(db, "issues", issueId));
        if (!iSnap.exists()) {
          setIssue(null);
          setLoading(false);
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
        setEditCategory(getCategoryValue(i));
        setEditLabelsText((i.labels || []).slice(1).join(", "));
        setEditProjectId(i.projectId || "");
        setEditCustomerId(i.customerId || "");
        setIsSelfCompany(!i.customerId && !i.projectId);

        // 2. Fetch Project (Deal)
        const projectId = i.projectId;
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

        // 2b. Fetch all deals (projects) for search
        if (prof.companyCode) {
          const dealsSnap = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
          const deals = dealsSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.title || "無題",
              key: data.key || data.title?.slice(0, 5)?.toUpperCase() || "DEAL",
              customerId: data.customerId || "",
            } as DealProject;
          });
          setAllProjects(deals.sort((a, b) => a.name.localeCompare(b.name)));
        }

        // 2c. Fetch all customers for search
        if (prof.companyCode) {
          const custSnap = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
          const custs = custSnap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "無名" }));
          setAllCustomers(custs.sort((a, b) => a.name.localeCompare(b.name)));
        }

        // 3. Fetch Employees
        const mergedEmp: Employee[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          mergedEmp.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        }
        const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
        mergedEmp.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        const empById = new Map<string, Employee>();
        for (const e of mergedEmp) empById.set(e.id, e);
        setEmployees(Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || "")));

        // 4. プロパティから取得（カテゴリ・ステータス）
        if (prof.companyCode) {
          const props = await ensureProperties(prof.companyCode);
          const catProp = props.find((p) => p.key === "category");
          if (catProp) {
            setCategoryProperty(catProp);
            setCategoryOptions(catProp.options);
          }
          const statusProp = props.find((p) => p.key === "issueStatus");
          if (statusProp) {
            setStatusOptions(statusProp.options.map((label) => ({ value: statusToValue(label), label })));
          }
        }

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "読み込みに失敗しました";
        setError(msg);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, issueId]);

  const insertAtCursor = (before: string, after = "") => {
    const el = descRef.current;
    if (!el) {
      setEditDescription((prev) => prev + before + after);
      return;
    }
    const start = el.selectionStart ?? editDescription.length;
    const end = el.selectionEnd ?? editDescription.length;
    const selected = editDescription.slice(start, end);
    const next = editDescription.slice(0, start) + before + selected + after + editDescription.slice(end);
    setEditDescription(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + before.length + selected.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

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
      
      const changes: string[] = [];
      if (issue.title !== t) changes.push(`件名を変更: 「${issue.title}」→「${t}」`);
      if (issue.description !== editDescription.trim()) changes.push("詳細を変更");
      if (issue.status !== editStatus) {
        const oldStatus = statusOptions.find(s => s.value === issue.status)?.label || statusToLabel(issue.status);
        const newStatus = statusOptions.find(s => s.value === editStatus)?.label || statusToLabel(editStatus);
        changes.push(`ステータスを変更: ${oldStatus} → ${newStatus}`);
      }
      if (issue.priority !== editPriority) {
        const oldPriority = ISSUE_PRIORITIES.find(p => p.value === issue.priority)?.label || issue.priority;
        const newPriority = ISSUE_PRIORITIES.find(p => p.value === editPriority)?.label || editPriority;
        changes.push(`優先度を変更: ${oldPriority} → ${newPriority}`);
      }
      if (prevAssignee !== nextAssignee) {
        const oldAssignee = prevAssignee ? (prevAssignee === user.uid ? myDisplayName : employees.find(e => e.authUid === prevAssignee)?.name || "未割当") : "未割当";
        const newAssignee = nextAssignee ? (nextAssignee === user.uid ? myDisplayName : employees.find(e => e.authUid === nextAssignee)?.name || "未割当") : "未割当";
        changes.push(`担当者を変更: ${oldAssignee} → ${newAssignee}`);
      }
      if (issue.startDate !== editStartDate) {
        changes.push(`開始日を変更: ${issue.startDate || "未設定"} → ${editStartDate || "未設定"}`);
      }
      if (issue.dueDate !== editDueDate) {
        changes.push(`期限日を変更: ${issue.dueDate || "未設定"} → ${editDueDate || "未設定"}`);
      }
      const oldLabels = (issue.labels || []).join(", ");
      const newLabels = labelList.join(", ");
      if (oldLabels !== newLabels) {
        changes.push(`ラベルを変更: ${oldLabels || "なし"} → ${newLabels || "なし"}`);
      }
      if (issue.projectId !== editProjectId && editProjectId) {
        const oldProject = project?.name || issue.projectId;
        const newProject = allProjects.find((p) => p.id === editProjectId)?.name || editProjectId;
        changes.push(`案件を変更: ${oldProject} → ${newProject}`);
      }
      if ((issue.customerId || "") !== editCustomerId) {
        const oldCust = issue.customerId ? allCustomers.find((c) => c.id === issue.customerId)?.name || issue.customerId : "未設定";
        const newCust = editCustomerId ? allCustomers.find((c) => c.id === editCustomerId)?.name || editCustomerId : "未設定";
        changes.push(`顧客を変更: ${oldCust} → ${newCust}`);
      }

      await updateDoc(doc(db, "issues", issue.id), {
        title: t,
        description: editDescription.trim(),
        status: editStatus,
        priority: editPriority,
        assigneeUid: nextAssignee,
        projectId: isSelfCompany ? null : (editProjectId || null),
        customerId: isSelfCompany ? null : (editCustomerId || null),
        startDate: editStartDate || null,
        dueDate: editDueDate || null,
        labels: labelList,
        propertyValues: { category: editCategory || "" },
        updatedAt: Timestamp.now(),
      });

      for (const change of changes) {
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "ISSUE_UPDATED",
          projectId: issue.projectId,
          issueId: issue.id,
          entityId: issue.id,
          message: `${issue.issueKey} - ${change}`,
          link: `/issue/${issue.id}`,
        });
      }

      if (nextAssignee && nextAssignee !== prevAssignee && nextAssignee !== user.uid) {
        await pushNotification({
          companyCode: profile.companyCode,
          recipientUid: nextAssignee,
          actorUid: user.uid,
          type: "ASSIGNED",
          title: `課題が割り当てられました: ${issue.issueKey}`,
          body: t,
          link: `/issue/${issue.id}`,
        });
      }

      router.push(`/issue/${issueId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "更新に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="課題編集" subtitle="読み込み中...">
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
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">課題が見つかりません</div>
          <div className="mt-3">
            <Link href={`/issue`} className="text-sm font-bold text-orange-700 hover:underline">
              課題一覧へ戻る
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`${project?.name || ""}`.trim() || "課題編集"}
      subtitle={
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/issue`} className="hover:underline text-slate-500">課題</Link>
          <span className="text-slate-400">/</span>
          <Link href={`/issue/${issueId}`} className="hover:underline text-slate-500">{issue.issueKey}</Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">編集</span>
        </div>
      }
      projectId={issue.projectId}
    >
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-extrabold text-slate-900">{issue.issueKey} - 編集</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {showPreview ? "編集" : "プレビュー"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-12">
            <div className="text-xs font-extrabold text-slate-600">件名 *</div>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-orange-300 bg-orange-50/30 px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500"
              placeholder="件名"
            />
          </div>

          <div className="md:col-span-12 border-t border-slate-100 pt-4">
            <div className="text-xs font-extrabold text-slate-600 mb-2">課題の詳細</div>
            <div className="rounded-md border border-slate-200">
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
                <button onClick={() => insertAtCursor("**", "**")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">B</button>
                <button onClick={() => insertAtCursor("*", "*")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">I</button>
                <button onClick={() => insertAtCursor("~~", "~~")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">S</button>
                <button onClick={() => insertAtCursor("\n- ")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">•</button>
                <div className="ml-auto">
                  <button
                    onClick={() => setShowPreview((v) => !v)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                  >
                    {showPreview ? "編集" : "プレビュー"}
                  </button>
                </div>
              </div>

              {!showPreview ? (
                <textarea
                  ref={descRef}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="min-h-[260px] w-full resize-y px-3 py-3 text-sm text-slate-800 outline-none"
                  placeholder="ここに詳細を書いてください"
                />
              ) : (
                <div className="min-h-[260px] whitespace-pre-wrap px-3 py-3 text-sm text-slate-800">
                  {editDescription.trim() ? editDescription : "（プレビュー：内容がありません）"}
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-12 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
              {/* 自社ボタン + 顧客・案件 */}
              <div className="md:col-span-12">
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isSelfCompany;
                      setIsSelfCompany(next);
                      if (next) {
                        setEditCustomerId("");
                        setEditProjectId("");
                      }
                    }}
                    className={clsx(
                      "rounded-full px-4 py-1.5 text-xs font-extrabold transition",
                      isSelfCompany
                        ? "bg-orange-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    自社
                  </button>
                  {isSelfCompany && (
                    <span className="text-xs font-bold text-slate-500">顧客・案件なし</span>
                  )}
                </div>
                {!isSelfCompany && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">顧客 *</div>
                      <div className="mt-1">
                        <SearchableSelect
                          value={editCustomerId}
                          onChange={(id) => {
                            setEditCustomerId(id);
                            if (editProjectId) {
                              const cur = allProjects.find((p) => p.id === editProjectId);
                              if (cur && cur.customerId !== id) setEditProjectId("");
                            }
                          }}
                          options={allCustomers.map((c) => ({ id: c.id, label: c.name }))}
                          placeholder="顧客を選択"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-6">
                      <div className="text-xs font-extrabold text-slate-600">案件（任意）</div>
                      <div className="mt-1">
                        <SearchableSelect
                          value={editProjectId}
                          onChange={(id) => {
                            setEditProjectId(id);
                            if (id) {
                              const p = allProjects.find((x) => x.id === id);
                              if (p?.customerId) setEditCustomerId(p.customerId);
                            }
                          }}
                          options={allProjects
                            .filter((p) => !editCustomerId || p.customerId === editCustomerId)
                            .map((p) => ({ id: p.id, label: p.name, sub: p.key }))}
                          placeholder="案件を選択（任意）"
                          allowClear
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-6">
                <div className="text-xs font-extrabold text-slate-600">状態</div>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as Issue["status"])}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  {statusOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <div className="text-xs font-extrabold text-slate-600">優先度</div>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as Issue["priority"])}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  {ISSUE_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <div className="text-xs font-extrabold text-slate-600">カテゴリ</div>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value="">未設定</option>
                  {categorySelectOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-extrabold text-slate-600">担当(リーダー)</div>
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
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value="">未割当</option>
                  <option value={user.uid}>{myDisplayName}</option>
                  {employees
                    .filter((e) => !!e.authUid && e.authUid !== user.uid)
                    .map((e) => (
                      <option key={e.id} value={e.authUid}>{e.name}</option>
                    ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <div className="text-xs font-extrabold text-slate-600">開始日</div>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                />
              </div>

              <div className="md:col-span-6">
                <div className="text-xs font-extrabold text-slate-600">期限日</div>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                />
              </div>

              <div className="md:col-span-12">
                <div className="text-xs font-extrabold text-slate-600">ラベル（カテゴリ以外・カンマ区切り）</div>
                <input
                  value={editLabelsText}
                  onChange={(e) => setEditLabelsText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  placeholder="例: 急ぎ,検討中"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Link
          href={`/issue/${issueId}`}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          キャンセル
        </Link>
        <button
          onClick={save}
          disabled={saving}
          className={clsx(
            "rounded-md px-4 py-2 text-sm font-extrabold text-white",
            saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700",
          )}
          type="button"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </AppShell>
  );
}

