"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, addDoc, Timestamp, deleteDoc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import type { Issue, Project } from "../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, formatLocalDate } from "../../lib/backlog";
import { logActivity } from "../../lib/activity";
import { ensureProperties, getCategoryValue, statusToLabel, statusToValue, statusColor } from "../../lib/properties";
import { AppShell } from "../AppShell";
import { useLocalStorageState } from "../../lib/useLocalStorageState";
import {
  DEFAULT_DATA_VISIBILITY,
  parseDataVisibility,
  resolveVisibleUids,
  filterByVisibleUids,
} from "../../lib/visibilityPermissions";
import { FilterSearchSelect } from "../../lib/FilterSearchSelect";

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

// 納期超過チェック（今日を過ぎていて完了でない場合）
function isOverdue(issue: Issue): boolean {
  if (!issue.dueDate || issue.status === "DONE") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(issue.dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export default function IssueHomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [isOwner, setIsOwner] = useState(false);
  const [visibleUids, setVisibleUids] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [propertyCategories, setPropertyCategories] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<{ value: string; label: string }[]>(ISSUE_STATUSES);

  // filters
  type IssueFilterState = {
    projectFilter: string;
    statusFilter: string;
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
  const [statusFilter, setStatusFilter] = useState<string>("NOT_DONE");
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

  // 課題の複数選択・編集モード
  const [editMode, setEditMode] = useState(false);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // ソート
  type SortKey = "manualOrder" | "title" | "project" | "customer" | "assignee" | "status" | "priority" | "dueDate" | "updatedAt";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "updatedAt" || key === "dueDate" ? "desc" : "asc");
    }
  };

  // ユンセンド: 行のドラッグ並べ替え
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  // 表示モード
  type ViewMode = "list" | "kanban" | "gantt";
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // 看板用ドラッグ&ドロップ
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Issue["status"] | null>(null);
  const todayStr = useMemo(() => formatLocalDate(new Date()), []);

  const router = useRouter();

  // viewMode復元
  useEffect(() => {
    const saved = localStorage.getItem("issueViewMode");
    if (saved === "kanban" || saved === "gantt") setViewMode(saved);
  }, []);

  // localStorage -> state (初回のみ、URLパラメータがあればそちらを優先)
  useEffect(() => {
    if (!filterStorage.loaded) return;
    const params = new URLSearchParams(window.location.search);
    const hasUrlParams = params.get("status") || params.get("project") || params.get("assignee") || params.get("priority") || params.get("q") || params.get("archived");

    if (hasUrlParams) {
      const pStatus = params.get("status") || "";
      if (pStatus) setStatusFilter(pStatus);
      const pProject = params.get("project") || "";
      if (pProject) setProjectFilter(pProject);
      const pAssignee = params.get("assignee") || "";
      if (pAssignee) setAssigneeFilter(pAssignee);
      const pPriority = params.get("priority") || "";
      if (pPriority) setPriorityFilter(pPriority);
      const pQ = params.get("q") || "";
      if (pQ) setKeyword(pQ);
      if (params.get("archived") === "1") setShowArchived(true);
    } else {
      const s = filterStorage.state;
      setProjectFilter(s.projectFilter ?? "ALL");
      setStatusFilter((s.statusFilter as any) ?? "NOT_DONE");
      setAssigneeFilter(s.assigneeFilter ?? "");
      setPriorityFilter(s.priorityFilter ?? "");
      setCategoryFilter(s.categoryFilter ?? "");
      setKeyword(s.keyword ?? "");
      setShowArchived(!!s.showArchived);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStorage.loaded]);

  // state -> localStorage + URLパラメータ同期
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

    // URLパラメータ同期（デフォルト値と異なる場合のみパラメータ付与）
    const params = new URLSearchParams();
    // statusFilter: デフォルト "NOT_DONE"。それ以外のときパラメータ付与
    if (statusFilter !== "NOT_DONE") params.set("status", statusFilter);
    if (projectFilter !== "ALL") params.set("project", projectFilter);
    if (assigneeFilter) params.set("assignee", assigneeFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (keyword.trim()) params.set("q", keyword.trim());
    // showArchived: デフォルト false。trueのときだけパラメータ付与
    if (showArchived) params.set("archived", "1");
    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", newUrl);
    }
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

      // オーナー判定 & 課題閲覧権限取得
      if (prof.companyCode) {
        try {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          if (compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid) {
            setIsOwner(true);
            setVisibleUids(new Set());
          } else {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            const perms = msSnap.exists()
              ? parseDataVisibility(msSnap.data(), "issuePermissions")
              : DEFAULT_DATA_VISIBILITY;
            const uids = await resolveVisibleUids(u.uid, prof.companyCode, perms);
            setVisibleUids(uids);
          }
        } catch {
          setVisibleUids(new Set([u.uid]));
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

        // プロパティからカテゴリ・ステータス選択肢を取得
        if (prof.companyCode) {
          const props = await ensureProperties(prof.companyCode);
          const catProp = props.find((p) => p.key === "category");
          if (catProp) setPropertyCategories(catProp.options);
          const statusProp = props.find((p) => p.key === "issueStatus");
          if (statusProp) {
            setStatusOptions(statusProp.options.map((label) => ({ value: statusToValue(label), label })));
          }
        }

        // 納期超過の課題がある場合、担当者にのみ警告通知を送る
        const overdueIssues = issItems.filter(
          (issue) => issue.assigneeUid === u.uid && isOverdue(issue)
        );
        if (overdueIssues.length > 0 && prof.companyCode) {
          // 既に今日通知を送っていないかチェック（localStorageで管理）
          const todayKey = new Date().toISOString().split("T")[0];
          const notifiedKey = `overdueNotified_${u.uid}_${todayKey}`;
          if (!localStorage.getItem(notifiedKey)) {
            // 通知を送る
            await addDoc(collection(db, "notifications"), {
              companyCode: prof.companyCode,
              recipientUid: u.uid,
              type: "SYSTEM",
              title: `⚠️ 納期超過の課題が${overdueIssues.length}件あります`,
              body: overdueIssues.slice(0, 3).map((iss) => iss.title).join("、") + (overdueIssues.length > 3 ? " 他" : ""),
              link: "/issue",
              read: false,
              createdAt: Timestamp.now(),
            });
            localStorage.setItem(notifiedKey, "1");
          }
        }
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
    const set = new Set<string>(propertyCategories);
    for (const i of issues) {
      const c = getCategoryValue(i);
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [issues, propertyCategories]);

  // 担当者選択の切り替え
  const toggleAssignee = (uid: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(uid) ? prev.filter((a) => a !== uid) : [...prev, uid]
    );
  };

  // 担当者リスト（自分 + 社員）— 権限でフィルタ
  const assigneeList = useMemo(() => {
    const list: { uid: string; name: string; color?: string }[] = [];
    if (user) {
      const myName = profile?.displayName || user.email?.split("@")[0] || "ユーザー";
      list.push({ uid: user.uid, name: myName, color: "#F97316" });
    }
    for (const emp of employees) {
      if (emp.authUid && emp.authUid !== user?.uid) {
        if (!isOwner && visibleUids.size > 0 && !visibleUids.has(emp.authUid)) continue;
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color });
      }
    }
    return list;
  }, [user, employees, profile?.displayName, isOwner, visibleUids]);

  // 権限によるフィルタ済みリスト
  const visibleIssues = useMemo(() => {
    if (isOwner) return issues;
    return filterByVisibleUids(issues, (i) => {
      // 自分が報告者の課題は常に表示
      if (user && i.reporterUid === user.uid) return [user.uid];
      return i.assigneeUid ? [i.assigneeUid] : [];
    }, visibleUids);
  }, [issues, visibleUids, isOwner, user]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const out = visibleIssues.filter((i) => {
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
      if (categoryFilter && getCategoryValue(i) !== categoryFilter) return false;
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
    // ソート
    const priorityOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "manualOrder":
          cmp = (a.manualOrder ?? 999999) - (b.manualOrder ?? 999999);
          break;
        case "title":
          cmp = (a.title || "").localeCompare(b.title || "");
          break;
        case "project": {
          const pa = projectsById[a.projectId]?.name || "";
          const pb = projectsById[b.projectId]?.name || "";
          cmp = pa.localeCompare(pb);
          break;
        }
        case "customer": {
          const ca = a.customerId ? customersById[a.customerId]?.name || "" : "";
          const cb = b.customerId ? customersById[b.customerId]?.name || "" : "";
          cmp = ca.localeCompare(cb);
          break;
        }
        case "assignee": {
          const na = assigneeName(a.assigneeUid) || "";
          const nb = assigneeName(b.assigneeUid) || "";
          cmp = na.localeCompare(nb);
          break;
        }
        case "status":
          cmp = (a.status || "").localeCompare(b.status || "");
          break;
        case "priority":
          cmp = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
          break;
        case "dueDate":
          cmp = (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
          break;
        case "updatedAt":
        default: {
          const am = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
          const bm = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
          cmp = am - bm;
          break;
        }
      }
      if (cmp === 0) {
        return (a.issueKey || "").localeCompare(b.issueKey || "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIssues, keyword, projectFilter, statusFilter, assigneeFilter, priorityFilter, categoryFilter, projectsById, customersById, showArchived, selectedAssignees, sortKey, sortDir, employees, user, profile]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  // ユンセンド: 並べ替え関数（filtered 定義後に配置）
  const swapManualOrder = useCallback(async (issueA: Issue, issueB: Issue) => {
    const orderA = issueA.manualOrder ?? 999999;
    const orderB = issueB.manualOrder ?? 999999;
    // 同じ値の場合は連番を振り直す
    const aIdx = filtered.findIndex(x => x.id === issueA.id);
    const bIdx = filtered.findIndex(x => x.id === issueB.id);
    const realA = orderA === orderB ? aIdx + 1 : orderA;
    const realB = orderA === orderB ? bIdx + 1 : orderB;
    setIssues(prev => prev.map(i => {
      if (i.id === issueA.id) return { ...i, manualOrder: realB };
      if (i.id === issueB.id) return { ...i, manualOrder: realA };
      return i;
    }));
    try {
      await Promise.all([
        updateDoc(doc(db, "issues", issueA.id), { manualOrder: realB }),
        updateDoc(doc(db, "issues", issueB.id), { manualOrder: realA }),
      ]);
    } catch { /* silent */ }
  }, [filtered]);

  const moveIssue = useCallback(async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIdx = filtered.findIndex(i => i.id === fromId);
    const toIdx = filtered.findIndex(i => i.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const items = [...filtered];
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);

    const updates: { id: string; order: number }[] = [];
    const orderMap = new Map<string, number>();
    items.forEach((item, idx) => {
      const newOrder = idx + 1;
      orderMap.set(item.id, newOrder);
      if ((item.manualOrder ?? 999999) !== newOrder) {
        updates.push({ id: item.id, order: newOrder });
      }
    });

    setIssues(prev => prev.map(i => {
      const o = orderMap.get(i.id);
      return o !== undefined ? { ...i, manualOrder: o } : i;
    }));

    try {
      await Promise.all(
        updates.map(u => updateDoc(doc(db, "issues", u.id), { manualOrder: u.order }))
      );
    } catch { /* silent */ }
  }, [filtered]);

  useEffect(() => {
    setPage(1);
  }, [projectFilter, statusFilter, assigneeFilter, priorityFilter, categoryFilter, keyword, showArchived]);

  // フィルター変更時に選択をクリア
  useEffect(() => {
    setSelectedIssueIds(new Set());
  }, [projectFilter, statusFilter, assigneeFilter, priorityFilter, categoryFilter, keyword, showArchived]);

  // 編集モード終了時に選択をクリア
  const handleEditModeToggle = () => {
    if (editMode) {
      setSelectedIssueIds(new Set());
    }
    setEditMode((prev) => !prev);
  };

  // 全選択/解除
  const toggleSelectAll = () => {
    if (selectedIssueIds.size === pageItems.length) {
      setSelectedIssueIds(new Set());
    } else {
      setSelectedIssueIds(new Set(pageItems.map((i) => i.id)));
    }
  };

  // 個別選択の切り替え
  const toggleIssueSelection = (issueId: string) => {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  };

  // 一括削除
  const handleBulkDelete = async () => {
    if (selectedIssueIds.size === 0) return;
    if (!confirm(`選択した ${selectedIssueIds.size} 件の課題を削除しますか？`)) return;

    setDeleting(true);
    try {
      const deletePromises = Array.from(selectedIssueIds).map((issueId) =>
        deleteDoc(doc(db, "issues", issueId))
      );
      await Promise.all(deletePromises);

      // ローカルのissuesからも削除
      setIssues((prev) => prev.filter((i) => !selectedIssueIds.has(i.id)));
      setSelectedIssueIds(new Set());
    } catch (e: any) {
      alert("削除に失敗しました: " + (e?.message || ""));
    } finally {
      setDeleting(false);
    }
  };

  // ステータス一括変更
  const handleBulkStatusChange = async (newStatus: Issue["status"]) => {
    if (selectedIssueIds.size === 0) return;

    setUpdatingStatus(true);
    try {
      const updatePromises = Array.from(selectedIssueIds).map((issueId) =>
        updateDoc(doc(db, "issues", issueId), {
          status: newStatus,
          updatedAt: Timestamp.now(),
        })
      );
      await Promise.all(updatePromises);

      // ローカルのissuesも更新
      setIssues((prev) =>
        prev.map((i) =>
          selectedIssueIds.has(i.id)
            ? { ...i, status: newStatus, updatedAt: Timestamp.now() }
            : i
        )
      );
      setSelectedIssueIds(new Set());
    } catch (e: any) {
      alert("ステータス変更に失敗しました: " + (e?.message || ""));
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ── 看板ビュー: ドラッグ&ドロップ ──
  const onDropToStatus = useCallback(async (status: Issue["status"]) => {
    if (!user || !profile || !draggingIssueId) return;
    const issue = issues.find(i => i.id === draggingIssueId);
    if (!issue || issue.status === status) {
      setDraggingIssueId(null);
      setDragOver(null);
      return;
    }
    setIssues(prev => prev.map(i => (i.id === draggingIssueId ? { ...i, status } : i)));
    try {
      await updateDoc(doc(db, "issues", draggingIssueId), { status, updatedAt: Timestamp.now() });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "ISSUE_UPDATED",
        projectId: issue.projectId,
        issueId: draggingIssueId,
        entityId: draggingIssueId,
        message: `状態変更: ${issue.issueKey} → ${statusOptions.find(s => s.value === status)?.label || statusToLabel(status)}`,
        link: `/issue/${draggingIssueId}`,
      });
    } catch {
      setIssues(prev => prev.map(i => (i.id === draggingIssueId ? { ...i, status: issue.status } : i)));
    } finally {
      setDraggingIssueId(null);
      setDragOver(null);
    }
  }, [user, profile, draggingIssueId, issues, statusOptions]);

  const kanbanLanes = useMemo(() => {
    const lanes = statusOptions.map(opt => ({
      ...opt,
      items: filtered.filter(i => i.status === opt.value),
    }));
    return {
      lanes,
      overdue: filtered.filter(i => !!i.dueDate && String(i.dueDate) < todayStr && i.status !== "DONE"),
    };
  }, [filtered, todayStr, statusOptions]);

  // ── ガントチャート: タイムライン計算 ──
  const ganttData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const issuesWithDates = filtered.filter(i => i.startDate || i.dueDate);
    const allDates = issuesWithDates
      .flatMap(i => [i.startDate, i.dueDate].filter(Boolean) as string[])
      .map(d => new Date(d).getTime());
    const minTs = allDates.length > 0 ? Math.min(...allDates, today.getTime()) : today.getTime();
    const maxTs = allDates.length > 0 ? Math.max(...allDates, today.getTime() + 21 * 86400000) : today.getTime() + 28 * 86400000;
    const rangeStart = new Date(minTs);
    rangeStart.setDate(rangeStart.getDate() - 3);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(maxTs);
    rangeEnd.setDate(rangeEnd.getDate() + 7);
    rangeEnd.setHours(0, 0, 0, 0);
    const days: Date[] = [];
    const d = new Date(rangeStart);
    while (d <= rangeEnd) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return { days, rangeStart, today };
  }, [filtered]);

  const switchView = useCallback((v: ViewMode) => {
    setViewMode(v);
    localStorage.setItem("issueViewMode", v);
  }, []);

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
              <button
                onClick={handleEditModeToggle}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  editMode
                    ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                )}
              >
                {editMode ? "完了" : "編集"}
              </button>
              {editMode && selectedIssueIds.size > 0 && (
                <>
                  <select
                    onChange={(e) => {
                      const status = e.target.value as Issue["status"];
                      if (status && confirm(`選択した ${selectedIssueIds.size} 件の課題のステータスを「${statusOptions.find((s) => s.value === status)?.label || statusToLabel(status)}」に変更しますか？`)) {
                        handleBulkStatusChange(status);
                      }
                      e.target.value = "";
                    }}
                    disabled={updatingStatus}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                    defaultValue=""
                  >
                    <option value="" disabled>ステータス変更</option>
                    {statusOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}に変更
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleBulkDelete}
                    disabled={deleting || updatingStatus}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {deleting ? "削除中..." : `削除 (${selectedIssueIds.size})`}
                  </button>
                </>
              )}
              <Link
                href={projectFilter !== "ALL" ? `/issue/new?projectId=${encodeURIComponent(projectFilter)}` : "/issue/new"}
                className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-orange-700 transition"
              >
                ＋ 課題作成
              </Link>
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
                {statusOptions.map((s) => (
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
                  <div className="text-xs font-extrabold text-slate-500">案件</div>
                  <FilterSearchSelect
                    value={projectFilter}
                    onChange={setProjectFilter}
                    allValue="ALL"
                    options={projects.map((p) => ({ value: p.id, label: `${p.key} ${p.name}` }))}
                    className="mt-1"
                  />
                </div>

                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">担当者</div>
                  <FilterSearchSelect
                    value={assigneeFilter}
                    onChange={setAssigneeFilter}
                    allValue=""
                    options={[
                      { value: user.uid, label: "私" },
                      ...employees
                        .filter((e) => !!e.authUid && e.authUid !== user.uid
                          && (isOwner || visibleUids.size === 0 || visibleUids.has(e.authUid!)))
                        .map((e) => ({ value: e.authUid!, label: e.name })),
                    ]}
                    className="mt-1"
                  />
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

        {/* ── ビュー切替 ── */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {([
              { key: "list" as const, label: "リスト", icon: <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"/></svg> },
              { key: "kanban" as const, label: "看板", icon: <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z"/></svg> },
              { key: "gantt" as const, label: "ガント", icon: <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12"/></svg> },
            ]).map(v => (
              <button
                key={v.key}
                onClick={() => switchView(v.key)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all",
                  viewMode === v.key
                    ? "bg-white text-orange-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {v.icon}
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            ))}
          </div>
          <div className="text-sm font-bold text-slate-500">
            {total} 件
          </div>
        </div>

        {/* ═══ リストビュー ═══ */}
        {viewMode === "list" && (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-700">
                全 {total} 件中 {total === 0 ? 0 : pageStart + 1} 〜 {Math.min(total, pageStart + pageSize)} 件を表示
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                    <tr>
                      {editMode && (
                        <th className="px-4 py-3 text-left whitespace-nowrap w-12">
                          <input
                            type="checkbox"
                            checked={pageItems.length > 0 && selectedIssueIds.size === pageItems.length}
                            onChange={toggleSelectAll}
                            className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                            title="すべて選択/解除"
                          />
                        </th>
                      )}
                      {([
                        { key: "manualOrder" as SortKey, label: "ユンセンド" },
                        { key: "title" as SortKey, label: "件名" },
                        { key: "project" as SortKey, label: "案件" },
                        { key: "customer" as SortKey, label: "顧客" },
                        { key: "assignee" as SortKey, label: "担当" },
                        { key: "status" as SortKey, label: "状態" },
                        { key: "priority" as SortKey, label: "優先度" },
                        { key: "dueDate" as SortKey, label: "期限日" },
                        { key: "updatedAt" as SortKey, label: "更新日" },
                      ]).map((col) => (
                        <th
                          key={col.key}
                          className="px-4 py-3 text-left whitespace-nowrap cursor-pointer select-none hover:bg-slate-100 transition-colors"
                          onClick={() => handleSort(col.key)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {sortKey === col.key ? (
                              <span className="text-orange-600">{sortDir === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <span className="text-slate-300">⇅</span>
                            )}
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-3 text-left whitespace-nowrap">共有</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pageItems.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                          該当する課題がありません
                        </td>
                      </tr>
                    ) : (
                      pageItems.map((i, rowIdx) => {
                        const globalIdx = pageStart + rowIdx;
                        const p = projectsById[i.projectId];
                        const cust = i.customerId ? customersById[i.customerId] : undefined;
                        const st = statusToLabel(i.status);
                        const pr = ISSUE_PRIORITIES.find((pp) => pp.value === i.priority)?.label || i.priority;
                        const cat = getCategoryValue(i);
                        const href = `/issue/${encodeURIComponent(i.id)}`;
                        const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/share/issues/${i.id}`;

                        const copyShareUrl = () => {
                          navigator.clipboard.writeText(shareUrl);
                          alert('共有URLをコピーしました！');
                        };

                        const assignee = assigneeName(i.assigneeUid);
                        const overdue = isOverdue(i);

                        const isSelected = selectedIssueIds.has(i.id);
                        const isDragSorted = sortKey === "manualOrder";
                        return (
                          <tr
                            key={i.id}
                            draggable={isDragSorted}
                            onDragStart={isDragSorted ? () => setDraggingRowId(i.id) : undefined}
                            onDragEnd={isDragSorted ? () => { setDraggingRowId(null); setDragOverRowId(null); } : undefined}
                            onDragOver={isDragSorted ? (e) => { e.preventDefault(); setDragOverRowId(i.id); } : undefined}
                            onDrop={isDragSorted ? () => { if (draggingRowId) moveIssue(draggingRowId, i.id); setDraggingRowId(null); setDragOverRowId(null); } : undefined}
                            className={clsx(
                              "hover:bg-slate-50 transition-colors",
                              overdue && "bg-red-50",
                              editMode && isSelected && "bg-orange-50",
                              isDragSorted && draggingRowId === i.id && "opacity-40",
                              isDragSorted && dragOverRowId === i.id && draggingRowId !== i.id && "border-t-2 border-orange-400",
                            )}
                          >
                            {editMode && (
                              <td className="px-4 py-3 whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleIssueSelection(i.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                                />
                              </td>
                            )}
                            {/* ユンセンド列 */}
                            <td className="px-2 py-2 whitespace-nowrap text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                {isDragSorted && (
                                  <button
                                    type="button"
                                    disabled={globalIdx === 0}
                                    onClick={() => {
                                      if (globalIdx > 0) swapManualOrder(i, filtered[globalIdx - 1]);
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-orange-600 disabled:opacity-20"
                                    title="上へ"
                                  >
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/></svg>
                                  </button>
                                )}
                                <span className={clsx(
                                  "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full text-xs font-extrabold",
                                  isDragSorted ? "bg-orange-100 text-orange-700 cursor-grab" : "bg-slate-100 text-slate-500",
                                )}>
                                  {globalIdx + 1}
                                </span>
                                {isDragSorted && (
                                  <button
                                    type="button"
                                    disabled={globalIdx >= filtered.length - 1}
                                    onClick={() => {
                                      if (globalIdx < filtered.length - 1) swapManualOrder(i, filtered[globalIdx + 1]);
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-orange-600 disabled:opacity-20"
                                    title="下へ"
                                  >
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-bold whitespace-nowrap">
                              <Link href={href} className={clsx("hover:underline block max-w-[200px] truncate", overdue ? "text-red-700" : "text-slate-900")} title={i.title}>
                                {overdue && <span className="mr-1">⚠️</span>}
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
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={clsx(
                                  "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                                  statusColor(i.status),
                                )}
                              >
                                {st}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{pr}</td>
                            <td className={clsx("px-4 py-3 whitespace-nowrap font-bold", overdue ? "text-red-600" : "text-slate-700")}>
                              {i.dueDate ? (
                                <span className={overdue ? "flex items-center gap-1" : ""}>
                                  {overdue && <span className="text-red-500">●</span>}
                                  {i.dueDate}
                                </span>
                              ) : "-"}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                              {i.updatedAt && typeof (i.updatedAt as any).toDate === "function"
                                ? formatLocalDate((i.updatedAt as any).toDate())
                                : "-"}
                            </td>
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
          </>
        )}

        {/* ═══ 看板ビュー ═══ */}
        {viewMode === "kanban" && (
          <div className="mt-4">
            <div className="flex gap-4 overflow-x-auto pb-4">
              {kanbanLanes.lanes.map(lane => {
                const laneColor = (value: string) => {
                  if (value === "DONE") return "bg-orange-500";
                  if (value === "IN_PROGRESS") return "bg-sky-500";
                  if (value === "TODO") return "bg-rose-500";
                  return "bg-slate-500";
                };
                return (
                <div
                  key={lane.value}
                  className={clsx(
                    "min-w-[280px] flex-1 rounded-lg border border-slate-200 bg-slate-50/40 transition-shadow",
                    dragOver === lane.value && "ring-2 ring-orange-300 shadow-md",
                  )}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(lane.value as Issue["status"]); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => { e.preventDefault(); void onDropToStatus(lane.value as Issue["status"]); }}
                >
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 rounded-t-lg">
                    <div className="flex items-center gap-2">
                      <span className={clsx("h-2.5 w-2.5 rounded-full", laneColor(lane.value))} />
                      <span className="text-sm font-extrabold text-slate-900">{lane.label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-600">{lane.items.length}</span>
                    </div>
                  </div>
                  <div className="space-y-2 p-3">
                    {lane.items.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-center text-xs font-bold text-slate-400">
                        課題なし
                      </div>
                    )}
                    {lane.items.map(issue => {
                      const p = projectsById[issue.projectId];
                      const who = assigneeName(issue.assigneeUid);
                      const overdue = !!issue.dueDate && issue.dueDate < todayStr && issue.status !== "DONE";
                      return (
                        <Link
                          key={issue.id}
                          href={`/issue/${issue.id}`}
                          draggable
                          onDragStart={() => setDraggingIssueId(issue.id)}
                          onDragEnd={() => { setDraggingIssueId(null); setDragOver(null); }}
                          className={clsx(
                            "block rounded-lg border bg-white p-3 shadow-sm transition-all",
                            draggingIssueId === issue.id
                              ? "border-orange-300 opacity-60 scale-[0.98]"
                              : "border-slate-200 hover:border-slate-300 hover:shadow",
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={clsx(
                              "rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                              issue.priority === "URGENT" ? "bg-red-100 text-red-700"
                                : issue.priority === "HIGH" ? "bg-orange-100 text-orange-700"
                                : issue.priority === "MEDIUM" ? "bg-sky-100 text-sky-700"
                                : "bg-slate-100 text-slate-600",
                            )}>
                              {ISSUE_PRIORITIES.find(pp => pp.value === issue.priority)?.label}
                            </span>
                            {p && <span className="text-[10px] font-bold text-slate-400 truncate">{p.key}</span>}
                          </div>
                          <div className="text-sm font-bold text-slate-900 line-clamp-2">{issue.title}</div>
                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="font-bold text-slate-500 truncate max-w-[120px]">{who || "未割当"}</span>
                            {issue.dueDate && (
                              <span className={clsx("font-bold", overdue ? "text-red-600" : "text-slate-400")}>
                                {overdue && "● "}{issue.dueDate.slice(5)}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
                );
              })}

              {/* 納期遅れレーン */}
              {kanbanLanes.overdue.length > 0 && (
                <div className="min-w-[280px] flex-1 rounded-lg border border-red-200 bg-red-50/30">
                  <div className="flex items-center gap-2 border-b border-red-200 bg-white px-3 py-2 rounded-t-lg">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                    <span className="text-sm font-extrabold text-red-700">納期遅れ</span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-extrabold text-red-600">{kanbanLanes.overdue.length}</span>
                  </div>
                  <div className="space-y-2 p-3">
                    {kanbanLanes.overdue.map(issue => {
                      const p = projectsById[issue.projectId];
                      const who = assigneeName(issue.assigneeUid);
                      return (
                        <Link
                          key={issue.id}
                          href={`/issue/${issue.id}`}
                          className="block rounded-lg border border-red-200 bg-white p-3 shadow-sm hover:shadow transition-shadow"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-700">
                              {ISSUE_PRIORITIES.find(pp => pp.value === issue.priority)?.label}
                            </span>
                            {p && <span className="text-[10px] font-bold text-slate-400 truncate">{p.key}</span>}
                          </div>
                          <div className="text-sm font-bold text-red-800 line-clamp-2">{issue.title}</div>
                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="font-bold text-slate-500 truncate max-w-[120px]">{who || "未割当"}</span>
                            <span className="font-bold text-red-600">{issue.dueDate?.slice(5)}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-1 text-xs font-bold text-slate-400">
              ドラッグ&ドロップでステータスを変更
            </div>
          </div>
        )}

        {/* ═══ ガントチャートビュー ═══ */}
        {viewMode === "gantt" && (() => {
          const { days, rangeStart, today } = ganttData;
          const dayW = 32;
          const leftW = 260;
          const totalW = days.length * dayW;

          const dateToX = (ds: string) => {
            const dt = new Date(ds);
            dt.setHours(0, 0, 0, 0);
            return ((dt.getTime() - rangeStart.getTime()) / 86400000) * dayW;
          };
          const todayX = ((today.getTime() - rangeStart.getTime()) / 86400000) * dayW;

          // 月ヘッダーを生成
          const months: { label: string; span: number }[] = [];
          let curMonth = "";
          for (const d of days) {
            const m = `${d.getFullYear()}/${d.getMonth() + 1}`;
            if (m !== curMonth) {
              months.push({ label: m, span: 1 });
              curMonth = m;
            } else {
              months[months.length - 1].span++;
            }
          }

          const issuesForGantt = filtered;

          return (
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <div style={{ minWidth: leftW + totalW }}>
                  {/* ── ヘッダー ── */}
                  <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
                    {/* 月行 */}
                    <div className="flex">
                      <div className="flex-shrink-0 border-r border-slate-200 bg-slate-50" style={{ width: leftW }} />
                      <div className="flex">
                        {months.map((m, idx) => (
                          <div
                            key={idx}
                            className="border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-extrabold text-slate-700"
                            style={{ width: m.span * dayW }}
                          >
                            {m.label}月
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* 日行 */}
                    <div className="flex">
                      <div className="flex-shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-1.5" style={{ width: leftW }}>
                        <span className="text-[11px] font-extrabold text-slate-600">課題名</span>
                      </div>
                      <div className="flex">
                        {days.map((d, idx) => {
                          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                          const isToday = d.toDateString() === today.toDateString();
                          return (
                            <div
                              key={idx}
                              className={clsx(
                                "flex-shrink-0 border-r border-slate-100 py-1.5 text-center text-[10px] font-bold",
                                isToday ? "bg-orange-50 text-orange-700" : isWeekend ? "bg-slate-50/60 text-slate-400" : "text-slate-500",
                              )}
                              style={{ width: dayW }}
                            >
                              {d.getDate()}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── 課題行 ── */}
                  {issuesForGantt.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                      該当する課題がありません
                    </div>
                  ) : (
                    issuesForGantt.map(issue => {
                      const p = projectsById[issue.projectId];
                      const who = assigneeName(issue.assigneeUid);
                      const hasRange = issue.startDate || issue.dueDate;
                      const barStart = issue.startDate ? dateToX(issue.startDate) : issue.dueDate ? dateToX(issue.dueDate) : 0;
                      const barEnd = issue.dueDate ? dateToX(issue.dueDate) + dayW : issue.startDate ? dateToX(issue.startDate) + dayW : 0;
                      const barW = Math.max(barEnd - barStart, dayW);
                      const overdue = !!issue.dueDate && issue.dueDate < todayStr && issue.status !== "DONE";

                      return (
                        <div key={issue.id} className="flex border-b border-slate-50 hover:bg-slate-50/50 group">
                          {/* 左: 課題情報 */}
                          <div className="sticky left-0 z-[5] flex-shrink-0 bg-white border-r border-slate-200 px-3 py-2 group-hover:bg-slate-50/50" style={{ width: leftW }}>
                            <Link href={`/issue/${issue.id}`} className={clsx("text-xs font-bold hover:text-orange-600 truncate block", overdue ? "text-red-700" : "text-slate-900")} title={issue.title}>
                              {issue.title}
                            </Link>
                            <div className="flex items-center gap-2 mt-0.5">
                              {p && <span className="text-[10px] font-bold text-slate-400">{p.key}</span>}
                              <span className="text-[10px] text-slate-400 truncate">{who || "未割当"}</span>
                              <span className={clsx(
                                "rounded-full px-1.5 py-0 text-[9px] font-extrabold",
                                statusColor(issue.status),
                              )}>
                                {statusToLabel(issue.status)}
                              </span>
                            </div>
                          </div>

                          {/* 右: タイムライン */}
                          <div className="relative" style={{ width: totalW, minHeight: 44 }}>
                            {/* 今日マーカー */}
                            <div
                              className="absolute top-0 bottom-0 w-[2px] bg-orange-400/30 z-[1]"
                              style={{ left: todayX + dayW / 2 }}
                            />

                            {hasRange ? (
                              <div
                                className={clsx(
                                  "absolute top-2.5 h-5 rounded-full transition-all cursor-pointer",
                                  issue.status === "DONE" ? "bg-emerald-400/80"
                                    : overdue ? "bg-red-400/80"
                                    : issue.status === "IN_PROGRESS" ? "bg-sky-400/80"
                                    : "bg-orange-400/80",
                                )}
                                style={{ left: barStart, width: barW }}
                                title={`${issue.startDate || "?"} → ${issue.dueDate || "?"}`}
                              >
                                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white truncate px-1">
                                  {barW > 60 ? issue.title.slice(0, 12) : ""}
                                </span>
                              </div>
                            ) : (
                              <div className="absolute top-3.5 left-2 text-[10px] font-bold text-slate-300">
                                日付未設定
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}


