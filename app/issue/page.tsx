"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import type { Issue, Project } from "../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../lib/backlog";
import { AppShell } from "../AppShell";
import { useLocalStorageState } from "../../lib/useLocalStorageState";

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
  color?: string;
};

type Customer = {
  id: string;
  name: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getCategoryFromIssue(i: Issue) {
  // MVP: labelsの先頭をカテゴリ扱い
  return i.labels && i.labels[0] ? String(i.labels[0]) : "";
}

export default function IssueHomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // filters
  type IssueFilterState = {
    projectFilter: string;
    statusFilter: "ALL" | "NOT_DONE" | Issue["status"];
    assigneeFilter: string;
    priorityFilter: string;
    categoryFilter: string;
    keyword: string;
    showArchived: boolean;
  };

  const filterStorage = useLocalStorageState<IssueFilterState>("issueFilters:v1", {
    projectFilter: "ALL",
    statusFilter: "NOT_DONE", // デフォルト: 完了は非表示
    assigneeFilter: "",
    priorityFilter: "",
    categoryFilter: "",
    keyword: "",
    showArchived: false, // デフォルト: アーカイブは非表示
  });

  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "NOT_DONE" | Issue["status"]>("NOT_DONE");
  const [assigneeFilter, setAssigneeFilter] = useState<string>(""); // authUid
  const [priorityFilter, setPriorityFilter] = useState<string>(""); // IssuePriority
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");
  const [showArchived, setShowArchived] = useState<boolean>(false);

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  
  // 担当者別ショートカット
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  // localStorage -> state (初回のみ)
  useEffect(() => {
    if (!filterStorage.loaded) return;
    const s = filterStorage.state;
    setProjectFilter(s.projectFilter ?? "ALL");
    setStatusFilter((s.statusFilter as any) ?? "NOT_DONE");
    setAssigneeFilter(s.assigneeFilter ?? "");
    setPriorityFilter(s.priorityFilter ?? "");
    setCategoryFilter(s.categoryFilter ?? "");
    setKeyword(s.keyword ?? "");
    setShowArchived(!!s.showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStorage.loaded]);

  // state -> localStorage（ユーザーが変えた条件を保持）
  useEffect(() => {
    if (!filterStorage.loaded) return;
    filterStorage.setState({
      projectFilter,
      statusFilter,
      assigneeFilter,
      priorityFilter,
      categoryFilter,
      keyword,
      showArchived,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, statusFilter, assigneeFilter, priorityFilter, categoryFilter, keyword, showArchived, filterStorage.loaded]);

  // 担当者別ドロップダウンの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setAssigneeDropdownOpen(false);
      }
    };
    if (assigneeDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [assigneeDropdownOpen]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
      if (!prof) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setProfile(prof);

      // 権限チェック
      if (prof.companyCode) {
        try {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          const isOwner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
          if (!isOwner) {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            if (msSnap.exists()) {
              const perms = (msSnap.data() as any).permissions || {};
              if (perms.issues === false) {
                window.location.href = "/";
                return;
              }
            }
          }
        } catch (e) {
          console.warn("permission check failed:", e);
        }
      }

      try {
        // deals (案件) を取得: /projects に表示される案件一覧
        const mergedDeals: any[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
          mergedDeals.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() })));
        } else {
          const snapByCreator = await getDocs(query(collection(db, "deals"), where("createdBy", "==", u.uid)));
          mergedDeals.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
        const projById = new Map<string, any>();
        for (const p of mergedDeals) projById.set(p.id, p);
        // deal を project として扱えるように name を生成
        const projItems = Array.from(projById.values()).map((d) => ({
          ...d,
          name: d.title || "無題",
          key: d.key || d.title?.slice(0, 5)?.toUpperCase() || "DEAL",
        } as Project)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setProjects(projItems);

        // employees (company + createdBy fallback)
        const mergedEmp: Employee[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          mergedEmp.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        } else {
          const snapByCreator2 = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
          mergedEmp.push(...snapByCreator2.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        }
        const empById = new Map<string, Employee>();
        for (const e of mergedEmp) empById.set(e.id, e);
        const empItems = Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setEmployees(empItems);

        // customers
        const mergedCustomers: Customer[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
          mergedCustomers.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Customer)));
        } else {
          const snapByCreator3 = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
          mergedCustomers.push(...snapByCreator3.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Customer)));
        }
        const custById = new Map<string, Customer>();
        for (const c of mergedCustomers) custById.set(c.id, c);
        const custItems = Array.from(custById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setCustomers(custItems);

        // issues (index回避: companyCodeだけで取得→クライアントで絞り込み)
        const mergedIssues: Issue[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "issues"), where("companyCode", "==", prof.companyCode)));
          mergedIssues.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Issue)));
        } else {
          // 会社コードが未設定の過去データ救済（ワークスペース分離のため通常は使わない）
          const snapByReporter = await getDocs(query(collection(db, "issues"), where("reporterUid", "==", u.uid)));
          mergedIssues.push(...snapByReporter.docs.map((d) => ({ id: d.id, ...d.data() } as Issue)));
        }
        const issById = new Map<string, Issue>();
        for (const i of mergedIssues) issById.set(i.id, i);
        const issItems = Array.from(issById.values()).sort((a, b) => (b.updatedAt as any)?.toMillis?.() - (a.updatedAt as any)?.toMillis?.());
        setIssues(issItems);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const projectsById = useMemo(() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const customersById = useMemo(() => {
    const m: Record<string, Customer> = {};
    for (const c of customers) m[c.id] = c;
    return m;
  }, [customers]);

  const assigneeName = (uid?: string | null) => {
    if (!uid) return "";
    if (uid === user?.uid) return profile?.displayName || user?.email?.split("@")[0] || "ユーザー";
    return employees.find((e) => e.authUid === uid)?.name || "";
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) {
      const c = getCategoryFromIssue(i);
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  // 担当者選択の切り替え
  const toggleAssignee = (uid: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(uid) ? prev.filter((a) => a !== uid) : [...prev, uid]
    );
  };

  // 担当者リスト（自分 + 社員）を取得
  const assigneeList = useMemo(() => {
    const list: { uid: string; name: string; color?: string }[] = [];
    if (user) {
      const myName = profile?.displayName || user.email?.split("@")[0] || "ユーザー";
      list.push({ uid: user.uid, name: myName, color: "#F97316" });
    }
    for (const emp of employees) {
      if (emp.authUid && emp.authUid !== user?.uid) {
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color });
      }
    }
    return list;
  }, [user, employees, profile?.displayName]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const out = issues.filter((i) => {
      // デフォルト: アーカイブ済みは非表示
      const isArchived = !!i.archivedAt;
      if (!showArchived && isArchived) return false;
      if (projectFilter !== "ALL" && i.projectId !== projectFilter) return false;
      if (statusFilter === "NOT_DONE" && i.status === "DONE") return false;
      if (statusFilter !== "ALL" && statusFilter !== "NOT_DONE" && i.status !== statusFilter) return false;
      if (assigneeFilter && (i.assigneeUid || "") !== assigneeFilter) return false;
      // 担当者別ショートカットフィルタ
      if (selectedAssignees.length > 0 && !selectedAssignees.includes(i.assigneeUid || "")) return false;
      if (priorityFilter && i.priority !== priorityFilter) return false;
      if (categoryFilter && getCategoryFromIssue(i) !== categoryFilter) return false;
      if (k) {
        const p = projectsById[i.projectId];
        const cust = i.customerId ? customersById[i.customerId] : undefined;
        const hay =
          `${i.issueKey} ${i.title} ${i.description || ""} ${(i.labels || []).join(" ")} ` +
          `${p?.key || ""} ${p?.name || ""} ${cust?.name || ""}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
    // 更新日時があれば新しい順、なければキー順
    out.sort((a, b) => {
      const am = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
      const bm = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
      if (am !== bm) return bm - am;
      return (a.issueKey || "").localeCompare(b.issueKey || "");
    });
    return out;
  }, [issues, keyword, projectFilter, statusFilter, assigneeFilter, priorityFilter, categoryFilter, projectsById, showArchived, selectedAssignees]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [projectFilter, statusFilter, assigneeFilter, priorityFilter, categoryFilter, keyword, showArchived]);

  if (loading) {
    return (
      <AppShell title="課題" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="課題"
      subtitle="全体の課題一覧"
      headerRight={
        <Link
          href={projectFilter !== "ALL" ? `/issue/new?projectId=${encodeURIComponent(projectFilter)}` : "/issue/new"}
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 transition"
        >
          ＋ 課題作成
        </Link>
      }
    >
      <div className="px-0 py-1">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold text-slate-900">検索条件</div>
              <button
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  isFilterExpanded ? "bg-slate-200 text-slate-700" : "bg-orange-600 text-white",
                )}
              >
                {isFilterExpanded ? "▲ 閉じる" : "▼ フィルタを表示"}
              </button>
              
              {/* 担当者別ショートカット */}
              <div className="relative" ref={assigneeDropdownRef}>
                <button
                  onClick={() => setAssigneeDropdownOpen((v) => !v)}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-xs font-extrabold transition flex items-center gap-1.5",
                    selectedAssignees.length > 0
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  担当者別
                  {selectedAssignees.length > 0 && (
                    <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{selectedAssignees.length}</span>
                  )}
                </button>
                
                {assigneeDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="p-2 border-b border-slate-100">
                      <div className="text-[10px] font-bold text-slate-500">担当者を選択</div>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {assigneeList.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">社員データを読み込み中...</div>
                      ) : (
                        assigneeList.map((a) => (
                          <label
                            key={a.uid}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedAssignees.includes(a.uid)}
                              onChange={() => toggleAssignee(a.uid)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                            />
                            <div
                              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white flex-shrink-0"
                              style={{ backgroundColor: a.color || "#CBD5E1" }}
                            >
                              {a.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-bold text-slate-700 truncate">{a.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {selectedAssignees.length > 0 && (
                      <div className="p-2 border-t border-slate-100">
                        <button
                          onClick={() => {
                            setSelectedAssignees([]);
                            setAssigneeDropdownOpen(false);
                          }}
                          className="w-full rounded-md bg-slate-100 px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-200"
                        >
                          クリア
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700">検索条件を保存</button>
            </div>
          </div>

          {isFilterExpanded && (
            <div className="mt-4 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold text-slate-700">
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className={clsx("rounded-full px-3 py-1.5", statusFilter === "ALL" ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  すべて
                </button>
                {ISSUE_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStatusFilter(s.value)}
                    className={clsx("rounded-full px-3 py-1.5", statusFilter === s.value ? "bg-orange-600 text-white" : "bg-slate-100")}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  onClick={() => setStatusFilter("NOT_DONE")}
                  className={clsx("rounded-full px-3 py-1.5", statusFilter === "NOT_DONE" ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  完了以外
                </button>

                <button
                  onClick={() => setShowArchived((v) => !v)}
                  className={clsx(
                    "rounded-full px-3 py-1.5",
                    showArchived ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
                  )}
                  title="アーカイブ済み課題の表示/非表示"
                >
                  {showArchived ? "アーカイブ表示中" : "アーカイブ"}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">プロジェクト</div>
                  <select
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="ALL">すべて</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.key} {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">カテゴリ</div>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">すべて</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">担当者</div>
                  <select
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">すべて</option>
                    <option value={user.uid}>私</option>
                    {employees.filter((e) => !!e.authUid && e.authUid !== user.uid).map((e) => (
                      <option key={e.id} value={e.authUid}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="キーワードを入力"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  />
                </div>

                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">優先度</div>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">すべて</option>
                    {ISSUE_PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-700">
            全 {total} 件中 {total === 0 ? 0 : pageStart + 1} 〜 {Math.min(total, pageStart + pageSize)} 件を表示
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left whitespace-nowrap">件名</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">案件</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">顧客</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">担当</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">サブ担当</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">状態</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">カテゴリ</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">優先度</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">期限日</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">共有</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      該当する課題がありません
                    </td>
                  </tr>
                ) : (
                  pageItems.map((i) => {
                    const p = projectsById[i.projectId];
                    const cust = i.customerId ? customersById[i.customerId] : undefined;
                    const st = ISSUE_STATUSES.find((s) => s.value === i.status)?.label || i.status;
                    const pr = ISSUE_PRIORITIES.find((pp) => pp.value === i.priority)?.label || i.priority;
                    const cat = getCategoryFromIssue(i);
                    const href = `/issue/${encodeURIComponent(i.id)}`;
                    const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/share/issues/${i.id}`;
                    
                    const copyShareUrl = () => {
                      navigator.clipboard.writeText(shareUrl);
                      alert('共有URLをコピーしました！');
                    };

                    const assignee = assigneeName(i.assigneeUid);
                    const subAssignee = assigneeName(i.subAssigneeUid);

                    return (
                      <tr key={i.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                          <Link href={href} className="hover:underline block max-w-[200px] truncate" title={i.title}>
                            {i.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-800 font-bold whitespace-nowrap">
                          {p ? (
                            <Link href={`/projects/${p.id}/issues`} className="hover:underline block max-w-[120px] truncate" title={p.name}>
                              {p.name}
                            </Link>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-800 font-bold whitespace-nowrap">
                          {cust ? (
                            <Link href={`/customers/${encodeURIComponent(cust.id)}`} className="hover:underline block max-w-[100px] truncate" title={cust.name}>
                              {cust.name}
                            </Link>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {assignee ? (
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-extrabold text-orange-700">
                                {assignee.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-bold max-w-[80px] truncate" title={assignee}>{assignee}</span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {subAssignee ? (
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-extrabold text-slate-600">
                                {subAssignee.charAt(0).toUpperCase()}
                              </div>
                              <span className="max-w-[80px] truncate" title={subAssignee}>{subAssignee}</span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={clsx(
                              "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                              i.status === "DONE"
                                ? "bg-orange-100 text-orange-700"
                                : i.status === "IN_PROGRESS"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-rose-100 text-rose-700",
                            )}
                          >
                            {st}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{cat || "-"}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{pr}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{i.dueDate || "-"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={copyShareUrl}
                            className="rounded-md bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100"
                          >
                            🔗
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            disabled={pageSafe <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={clsx(
              "rounded-md border px-3 py-2 text-xs font-extrabold",
              pageSafe <= 1 ? "border-slate-200 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            前へ
          </button>
          <div className="flex items-center gap-2">
            {Array.from({ length: Math.min(9, totalPages) }).map((_, idx) => {
              const n = idx + 1;
              return (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={clsx(
                    "h-8 w-8 rounded-full text-xs font-extrabold",
                    n === pageSafe ? "bg-orange-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {n}
                </button>
              );
            })}
            {totalPages > 9 ? <span className="text-xs font-bold text-slate-500">…</span> : null}
          </div>
          <button
            disabled={pageSafe >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className={clsx(
              "rounded-md border px-3 py-2 text-xs font-extrabold",
              pageSafe >= totalPages ? "border-slate-200 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            次へ
          </button>
        </div>
      </div>
    </AppShell>
  );
}


