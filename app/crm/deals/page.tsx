"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { Suspense } from "react";
import { AppShell } from "../../AppShell";
import { ensureProfile } from "../../../lib/ensureProfile";
import { useLocalStorageState } from "../../../lib/useLocalStorageState";
import {
  type DataVisibilityPermissions,
  DEFAULT_DATA_VISIBILITY,
  parseDataVisibility,
  resolveVisibleUids,
  filterByVisibleUids,
} from "../../../lib/visibilityPermissions";
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
  email?: string;
  isActive?: boolean | null;
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
  assigneeUid?: string | null;
};

type DealStatus = "ACTIVE" | "CONFIRMED" | "PLANNED" | "STOPPING" | "INACTIVE";

const DEAL_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "稼働中", color: "bg-green-100 text-green-700" },
  { value: "CONFIRMED", label: "稼働確定", color: "bg-blue-100 text-blue-700" },
  { value: "PLANNED", label: "稼働予定", color: "bg-sky-100 text-sky-700" },
  { value: "STOPPING", label: "停止予定", color: "bg-amber-100 text-amber-700" },
  { value: "INACTIVE", label: "停止中", color: "bg-slate-100 text-slate-700" },
] as const;

type Deal = {
  id: string;
  companyCode: string;
  createdBy: string;
  customerId: string;
  title: string;
  genre?: string;
  description?: string;
  status: DealStatus;
  assigneeUids?: string[] | null; // 担当者（複数）
  leaderUid?: string | null; // 旧: 互換用
  subLeaderUid?: string | null; // 旧: 互換用
  revenue?: number | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function formatYen(n?: number | null) {
  if (n === null || n === undefined) return "-";
  if (Number.isNaN(n)) return "-";
  try {
    return new Intl.NumberFormat("ja-JP").format(n);
  } catch {
    return String(n);
  }
}

function formatDateTime(ts?: Timestamp) {
  if (!ts) return "--";
  const date = ts.toDate();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${m}/${d} ${hh}:${mm}`;
}

function DealsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [visibleUids, setVisibleUids] = useState<Set<string>>(new Set());

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const [qText, setQText] = useState("");
  const [tab, setTab] = useState<"ALL" | "MINE">("ALL"); // MINE = 自分の顧客（担当）
  const [statusFilter, setStatusFilter] = useState<DealStatus | "ALL">("ACTIVE"); // デフォルト: 停止は非表示
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [leaderFilter, setLeaderFilter] = useState("ALL");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // 並び替え
  type SortColumn = "title" | "customer" | "genre" | "assignee" | "revenue" | "status" | "updatedAt" | null;
  type SortDirection = "asc" | "desc";
  const [sortColumn, setSortColumn] = useState<SortColumn>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // 担当者別ショートカット
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  // フィルタ状態の永続化
  type DealFilterState = {
    qText: string;
    tab: "ALL" | "MINE";
    statusFilter: DealStatus | "ALL";
    customerFilter: string;
    leaderFilter: string;
    selectedAssignees: string[];
    isFilterExpanded: boolean;
    sortColumn: SortColumn;
    sortDirection: SortDirection;
  };
  const filterStorage = useLocalStorageState<DealFilterState>("dealFilters:v1", {
    qText: "",
    tab: "ALL",
    statusFilter: "ACTIVE",
    customerFilter: "ALL",
    leaderFilter: "ALL",
    selectedAssignees: [],
    isFilterExpanded: false,
    sortColumn: "updatedAt",
    sortDirection: "desc",
  });
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<DealStatus>("ACTIVE");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [editAssigneeUids, setEditAssigneeUids] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async (u: User, prof: MemberProfile) => {
    // customers
    const mergedCust: Customer[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      mergedCust.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    } else {
      const snapByCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
      mergedCust.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const custMap = new Map<string, Customer>();
    for (const c of mergedCust) custMap.set(c.id, c);
    const custItems = Array.from(custMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(custItems);

    // employees
    if (prof.companyCode) {
      const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
      setEmployees(empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    } else {
      setEmployees([]);
    }

    // deals
    const mergedDeals: Deal[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
      mergedDeals.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Deal)));
    } else {
      const snapByCreator2 = await getDocs(query(collection(db, "deals"), where("createdBy", "==", u.uid)));
      mergedDeals.push(...snapByCreator2.docs.map((d) => ({ id: d.id, ...d.data() } as Deal)));
    }
    const dealMap = new Map<string, Deal>();
    for (const d of mergedDeals) dealMap.set(d.id, d);
    const dealItems = Array.from(dealMap.values()).sort((a, b) => {
      const am = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
      const bm = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
      return bm - am;
    });
    setDeals(dealItems);
  };

  // localStorage から復元（searchParams がある場合はそちらを優先）
  useEffect(() => {
    if (!filterStorage.loaded) return;
    const hasSearchParams = searchParams.get("status") || searchParams.get("customerId") || searchParams.get("q");

    if (hasSearchParams) {
      // URL パラメータ優先
      const initialStatus = (searchParams.get("status") || "").toUpperCase();
      const validStatuses = DEAL_STATUS_OPTIONS.map(o => o.value);
      if (validStatuses.includes(initialStatus as DealStatus)) {
        setStatusFilter(initialStatus as DealStatus);
      }
      const initialCustomerId = searchParams.get("customerId") || "";
      if (initialCustomerId) setCustomerFilter(initialCustomerId);
      const initialQ = searchParams.get("q") || "";
      if (initialQ) {
        setQText(initialQ);
        setIsFilterExpanded(true);
      }
    } else {
      // localStorage から復元
      const s = filterStorage.state;
      setQText(s.qText ?? "");
      setTab(s.tab ?? "ALL");
      setStatusFilter(s.statusFilter ?? "ACTIVE");
      setCustomerFilter(s.customerFilter ?? "ALL");
      setLeaderFilter(s.leaderFilter ?? "ALL");
      setSelectedAssignees(s.selectedAssignees ?? []);
      setIsFilterExpanded(s.isFilterExpanded ?? false);
      setSortColumn(s.sortColumn ?? "updatedAt");
      setSortDirection(s.sortDirection ?? "desc");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStorage.loaded]);

  // フィルタ変更時に localStorage へ保存
  useEffect(() => {
    if (!filterStorage.loaded) return;
    filterStorage.setState({
      qText,
      tab,
      statusFilter,
      customerFilter,
      leaderFilter,
      selectedAssignees,
      isFilterExpanded,
      sortColumn,
      sortDirection,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qText, tab, statusFilter, customerFilter, leaderFilter, selectedAssignees, isFilterExpanded, sortColumn, sortDirection]);

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
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);

        // オーナー判定 & 権限取得
        if (prof.companyCode) {
          try {
            const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
            if (compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid) {
              setIsOwner(true);
              setVisibleUids(new Set()); // オーナーはフィルタなし
            } else {
              const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
              const perms = msSnap.exists()
                ? parseDataVisibility(msSnap.data(), "projectPermissions")
                : DEFAULT_DATA_VISIBILITY;
              const uids = await resolveVisibleUids(u.uid, prof.companyCode, perms);
              setVisibleUids(uids);
            }
          } catch {
            // エラー時は自分のみ表示
            setVisibleUids(new Set([u.uid]));
          }
        }

        await loadAll(u, prof);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customersById = useMemo(() => {
    const m: Record<string, Customer> = {};
    for (const c of customers) m[c.id] = c;
    return m;
  }, [customers]);

  const employeesByUid = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) if (e.authUid) m[e.authUid] = e;
    return m;
  }, [employees]);

  /** 担当者UIDから表示名を取得（自分＝プロフィール名、社員＝employees、それ以外＝不明） */
  const assigneeDisplayName = (uid: string): string => {
    if (uid === user?.uid) return profile?.displayName?.trim() || user?.displayName?.trim() || user?.email?.split("@")[0] || "ユーザー";
    return employeesByUid[uid]?.name || "不明";
  };

  const activeLeaderUids = useMemo(() => {
    const set = new Set<string>();
    if (user) set.add(user.uid);
    for (const e of employees) {
      if (e.isActive !== false && e.authUid) set.add(e.authUid);
    }
    return set;
  }, [user, employees]);

  // 案件の担当者リストを取得（新旧フィールド互換）
  const getDealAssignees = (d: Deal): string[] => {
    if (Array.isArray(d.assigneeUids) && d.assigneeUids.length > 0) {
      return d.assigneeUids.filter(Boolean) as string[];
    }
    // 旧フィールドから復元
    const legacy: string[] = [];
    if (d.leaderUid) legacy.push(d.leaderUid);
    if (d.subLeaderUid && d.subLeaderUid !== d.leaderUid) legacy.push(d.subLeaderUid);
    return legacy;
  };

  // 権限によるフィルタ済みリスト（一般ユーザーは担当者に自分が含まれる案件のみ表示）
  const visibleDeals = useMemo(() => {
    if (isOwner) return deals;
    return filterByVisibleUids(deals, (d) => getDealAssignees(d), visibleUids);
  }, [deals, visibleUids, isOwner]);

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    const filteredList = visibleDeals.filter((d) => {
      const cust = customersById[d.customerId];
      const assignees = getDealAssignees(d);
      // 担当者が全員非稼働の場合は非表示
      if (assignees.length > 0 && !assignees.some((uid) => activeLeaderUids.has(uid))) return false;
      if (tab === "MINE" && user) {
        if (!cust || (cust.assigneeUid || "") !== user.uid) return false;
      }
      if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
      if (customerFilter !== "ALL" && d.customerId !== customerFilter) return false;
      if (leaderFilter !== "ALL") {
        if (leaderFilter === "__unassigned__") {
          if (assignees.length > 0) return false;
        } else if (!assignees.includes(leaderFilter)) {
          return false;
        }
      }
      if (selectedAssignees.length > 0) {
        const hasUnassignedFilter = selectedAssignees.includes("__unassigned__");
        const otherFilters = selectedAssignees.filter((a) => a !== "__unassigned__");
        const matchesUnassigned = hasUnassignedFilter && assignees.length === 0;
        const matchesOther = otherFilters.length > 0 && assignees.some((uid) => otherFilters.includes(uid));
        if (!matchesUnassigned && !matchesOther) return false;
      }
      if (!q) return true;
      const custName = cust?.name || "";
      const hay = `${d.title || ""} ${d.genre || ""} ${d.description || ""} ${custName}`.toLowerCase();
      return hay.includes(q);
    });

    // 並び替え
    const sorted = [...filteredList].sort((a, b) => {
      if (!sortColumn) return 0;
      
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case "title":
          aVal = (a.title || "").toLowerCase();
          bVal = (b.title || "").toLowerCase();
          break;
        case "customer":
          aVal = (customersById[a.customerId]?.name || "").toLowerCase();
          bVal = (customersById[b.customerId]?.name || "").toLowerCase();
          break;
        case "genre":
          aVal = (a.genre || "").toLowerCase();
          bVal = (b.genre || "").toLowerCase();
          break;
        case "assignee":
          const aAssignees = getDealAssignees(a);
          const bAssignees = getDealAssignees(b);
          if (aAssignees.length === 0 && bAssignees.length === 0) {
            aVal = "";
            bVal = "";
          } else if (aAssignees.length === 0) {
            aVal = "zzz"; // 未設定を最後に
            bVal = assigneeDisplayName(bAssignees[0]).toLowerCase();
          } else if (bAssignees.length === 0) {
            aVal = assigneeDisplayName(aAssignees[0]).toLowerCase();
            bVal = "zzz";
          } else {
            aVal = assigneeDisplayName(aAssignees[0]).toLowerCase();
            bVal = assigneeDisplayName(bAssignees[0]).toLowerCase();
          }
          break;
        case "revenue":
          aVal = a.revenue ?? 0;
          bVal = b.revenue ?? 0;
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "updatedAt":
          aVal = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
          bVal = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [visibleDeals, qText, tab, statusFilter, customerFilter, leaderFilter, selectedAssignees, customersById, employeesByUid, user, activeLeaderUids, sortColumn, sortDirection]);

  const totalRevenue = useMemo(() => {
    let sum = 0;
    for (const d of filtered) {
      if (typeof d.revenue === "number" && !Number.isNaN(d.revenue)) {
        sum += d.revenue;
      }
    }
    return sum;
  }, [filtered]);

  // 並び替えハンドラー
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // 担当者選択の切り替え
  const toggleAssignee = (uid: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(uid) ? prev.filter((a) => a !== uid) : [...prev, uid]
    );
  };

  // 担当者リスト（担当者未設定 + 自分 + 稼働中社員）を取得
  const assigneeList = useMemo(() => {
    const list: { uid: string; name: string; color?: string }[] = [];
    list.push({ uid: "__unassigned__", name: "担当者未設定", color: "#94A3B8" });
    if (user) {
      const myName = profile?.displayName || user.email?.split("@")[0] || "ユーザー";
      list.push({ uid: user.uid, name: myName, color: "#F97316" });
    }
    const activeEmps = employees.filter((e) => e.isActive !== false);
    for (const emp of activeEmps) {
      if (emp.authUid && emp.authUid !== user?.uid) {
        // 権限でフィルタ（visibleUids が空 = 全員表示、非空 = 含まれるもののみ）
        if (!isOwner && visibleUids.size > 0 && !visibleUids.has(emp.authUid)) continue;
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color });
      }
    }
    return list;
  }, [user, employees, profile?.displayName, isOwner, visibleUids]);

  const openEdit = (deal: Deal) => {
    setEditing(deal);
    setEditTitle(deal.title || "");
    setEditGenre(deal.genre || "");
    setEditDescription(deal.description || "");
    setEditStatus(deal.status);
    setEditCustomerId(deal.customerId || "");
    setEditAssigneeUids(getDealAssignees(deal));
    setError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!user || !profile || !editing) return;
    const t = editTitle.trim();
    if (!t) {
      setError("案件名を入力してください");
      return;
    }
    if (!editCustomerId) {
      setError("顧客を選択してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "deals", editing.id), {
        title: t,
        genre: editGenre.trim() || "",
        description: editDescription.trim() || "",
        status: editStatus,
        customerId: editCustomerId,
        assigneeUids: editAssigneeUids.length > 0 ? editAssigneeUids : null,
        leaderUid: null,
        subLeaderUid: null,
        updatedAt: Timestamp.now(),
      });
      const cust = customersById[editCustomerId];
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "DEAL_UPDATED",
        message: `案件を更新しました: ${t}（顧客: ${cust?.name || "未設定"}）`,
        link: "/projects",
      });
      await loadAll(user, profile);
      setModalOpen(false);
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="案件一覧" subtitle="Deals">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="案件一覧"
      subtitle="Deals"
    >
      <div className="px-0 py-1">
        {/* 検索条件（/issue と同じ雛形） */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold text-slate-900">検索条件</div>
              <button
                onClick={() => setIsFilterExpanded((v) => !v)}
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
                            key={a.uid || "__unassigned__"}
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
                              {a.uid === "__unassigned__" ? "—" : a.name.charAt(0).toUpperCase()}
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
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-slate-700">全 {filtered.length} 件</span>
              <span className="text-xs font-bold text-slate-500">売上合計: ¥{formatYen(totalRevenue)}</span>
              <Link href="/customers" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                ← 顧客一覧
              </Link>
              <Link href="/projects/new" className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-orange-600 shadow-sm transition">
                案件を追加
              </Link>
            </div>
          </div>

          {isFilterExpanded && (
            <div className="mt-4 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold text-slate-700">
                <button
                  onClick={() => setTab("ALL")}
                  className={clsx("rounded-full px-3 py-1.5", tab === "ALL" ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  すべて
                </button>
                <button
                  onClick={() => setTab("MINE")}
                  className={clsx("rounded-full px-3 py-1.5", tab === "MINE" ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  自分の顧客
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="案件名 / 顧客名で検索"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-extrabold text-slate-500">ステータス</div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="ALL">すべて</option>
                    {DEAL_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <div className="text-xs font-extrabold text-slate-500">顧客</div>
                  <select
                    value={customerFilter}
                    onChange={(e) => setCustomerFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="ALL">すべて</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-500">担当者</div>
                  <select
                    value={leaderFilter}
                    onChange={(e) => setLeaderFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="ALL">すべて</option>
                    <option value="__unassigned__">担当者未設定</option>
                    <option value={user.uid}>{profile?.displayName || user.email?.split("@")[0] || "ユーザー"}</option>
                    {employees
                      .filter((e) => e.isActive !== false && !!e.authUid && e.authUid !== user.uid
                        && (isOwner || visibleUids.size === 0 || visibleUids.has(e.authUid!)))
                      .map((e) => (
                        <option key={e.id} value={e.authUid}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-xs">
              <thead className="bg-slate-50 text-[11px] font-extrabold text-slate-600">
                <tr>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("title")}
                  >
                    <div className="flex items-center gap-1">
                      案件名
                      {sortColumn === "title" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("customer")}
                  >
                    <div className="flex items-center gap-1">
                      顧客
                      {sortColumn === "customer" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("genre")}
                  >
                    <div className="flex items-center gap-1">
                      カテゴリ
                      {sortColumn === "genre" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("assignee")}
                  >
                    <div className="flex items-center gap-1">
                      担当者
                      {sortColumn === "assignee" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("revenue")}
                  >
                    <div className="flex items-center gap-1">
                      売上
                      {sortColumn === "revenue" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center gap-1">
                      状態
                      {sortColumn === "status" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort("updatedAt")}
                  >
                    <div className="flex items-center gap-1">
                      更新
                      {sortColumn === "updatedAt" && (
                        <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-xs font-bold text-slate-500">
                      該当する案件がありません
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const cust = customersById[d.customerId];
                    const assignees = getDealAssignees(d);
                    const updated = (d.updatedAt as any) || d.createdAt;
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                          <Link href={`/projects/${d.id}/detail`} className="hover:underline">
                            {d.title || "無題"}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-800 font-bold whitespace-nowrap">
                          {cust ? (
                            <Link href={`/customers/${cust.id}`} className="hover:underline">
                              {cust.name}
                            </Link>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {d.genre ? (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                              {d.genre}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {assignees.length > 0 ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {assignees.slice(0, 3).map((uid) => {
                                const name = assigneeDisplayName(uid);
                                const emp = employeesByUid[uid];
                                const color = uid === user?.uid ? "#F97316" : (emp?.color || "#CBD5E1");
                                return (
                                  <div key={uid} className="flex items-center gap-1.5">
                                    <div
                                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                                      style={{ backgroundColor: color }}
                                      title={name}
                                    >
                                      {name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-xs font-bold text-slate-700">{name}</span>
                                  </div>
                                );
                              })}
                              {assignees.length > 3 && (
                                <span className="text-[10px] text-slate-500">+{assignees.length - 3}</span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-500">
                              未設定
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700 font-bold whitespace-nowrap">
                          {d.revenue === null || d.revenue === undefined ? (
                            <span className="text-slate-400">-</span>
                          ) : (
                            <span>¥{formatYen(d.revenue)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {(() => {
                            const statusOpt = DEAL_STATUS_OPTIONS.find(o => o.value === d.status);
                            return (
                              <span
                                className={clsx(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                                  statusOpt?.color || "bg-slate-100 text-slate-700",
                                )}
                              >
                                {statusOpt?.label || d.status}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatDateTime(updated)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <Link
                            href={`/projects/${d.id}/edit`}
                            className="inline-block rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700 hover:bg-orange-100"
                          >
                            編集
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-500">編集</div>
                <div className="text-2xl font-extrabold text-slate-900">案件</div>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                閉じる
              </button>
            </div>

            {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

            <div className="mt-5 grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">顧客 *</div>
                <select
                  value={editCustomerId}
                  onChange={(e) => setEditCustomerId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">案件名 *</div>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：〇〇システム開発"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">カテゴリ</div>
                <input
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：開発 / 広告 / 相談 / 運用"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">ステータス</div>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as DealStatus)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  {DEAL_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">担当者（複数選択可）</div>
                <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3 min-h-[48px]">
                  {editAssigneeUids.length === 0 && (
                    <span className="text-sm text-slate-400">未設定</span>
                  )}
                  {editAssigneeUids.map((uid) => {
                    const name = assigneeDisplayName(uid);
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => setEditAssigneeUids((prev) => prev.filter((u) => u !== uid))}
                          className="ml-1 text-orange-500 hover:text-orange-700"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const v = (e.target.value || "").trim();
                    if (!v) return;
                    setEditAssigneeUids((prev) => (prev.includes(v) ? prev : [...prev, v]));
                    e.target.value = "";
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  <option value="">＋ 担当者を追加...</option>
                  {user && !editAssigneeUids.includes(user.uid) && (
                    <option value={user.uid}>{assigneeDisplayName(user.uid)}</option>
                  )}
                  {employees
                    .filter((e) => !!e.authUid && e.authUid !== user?.uid && !editAssigneeUids.includes(e.authUid!))
                    .map((e) => (
                      <option key={e.id} value={e.authUid!}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">概要</div>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="案件の背景・範囲・注意点など"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
              >
                {saving ? "更新中..." : "更新"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function DealsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
        </div>
      }
    >
      <DealsInner />
    </Suspense>
  );
}
