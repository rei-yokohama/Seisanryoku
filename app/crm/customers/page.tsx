"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, Timestamp, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import { useLocalStorageState } from "../../../lib/useLocalStorageState";
import { AppShell } from "../../AppShell";
import {
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

type EmploymentType = "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託";

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
  isActive?: boolean | null;
  employmentType?: EmploymentType;
};

type Customer = {
  id: string;
  companyCode: string;
  createdBy: string;
  name: string;
  isActive?: boolean | null;
  assigneeUid?: string | null;
  assigneeUids?: string[] | null;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  industry?: string;
  contractAmount?: number | null;
  assigneeSales?: Record<string, number> | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type Deal = {
  id: string;
  customerId: string;
  title: string;
  status?: string;
};

function isCustomerActive(c: Customer) {
  // 過去データ互換: フィールドが無い場合は稼働中扱い
  return c.isActive !== false;
}

function formatDate(ts?: Timestamp) {
  if (!ts) return "-";
  const date = ts.toDate();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}/${m}/${d}`;
}

function getCustomerAssignees(c: Customer): string[] {
  if (Array.isArray(c.assigneeUids) && c.assigneeUids.length > 0) return c.assigneeUids.filter(Boolean) as string[];
  return c.assigneeUid ? [c.assigneeUid] : [];
}

function formatYen(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return `¥${n.toLocaleString("ja-JP")}`;
}

export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [isOwner, setIsOwner] = useState(false);
  const [visibleUids, setVisibleUids] = useState<Set<string>>(new Set());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  type SortColumn = "name" | "assignee" | "status" | "deals" | "revenue" | "createdAt" | "updatedAt" | null;
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // フィルタ状態の永続化
  type CustomerFilterState = {
    qText: string;
    statusFilter: "ACTIVE" | "INACTIVE" | "ALL";
    assigneeFilter: string;
    selectedAssignees: string[];
    isFilterExpanded: boolean;
    sortColumn: SortColumn;
    sortDirection: "asc" | "desc";
  };
  const filterStorage = useLocalStorageState<CustomerFilterState>("customerFilters:v1", {
    qText: "",
    statusFilter: "ACTIVE",
    assigneeFilter: "ALL",
    selectedAssignees: [],
    isFilterExpanded: false,
    sortColumn: null,
    sortDirection: "desc",
  });

  // localStorage から復元
  useEffect(() => {
    if (!filterStorage.loaded) return;
    const s = filterStorage.state;
    setQText(s.qText ?? "");
    setStatusFilter(s.statusFilter ?? "ACTIVE");
    setAssigneeFilter(s.assigneeFilter ?? "ALL");
    setSelectedAssignees(s.selectedAssignees ?? []);
    setIsFilterExpanded(s.isFilterExpanded ?? false);
    setSortColumn(s.sortColumn ?? null);
    setSortDirection(s.sortDirection ?? "desc");
  }, [filterStorage.loaded]);

  // フィルタ変更時に localStorage へ保存
  useEffect(() => {
    if (!filterStorage.loaded) return;
    filterStorage.setState({
      qText,
      statusFilter,
      assigneeFilter,
      selectedAssignees,
      isFilterExpanded,
      sortColumn,
      sortDirection,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qText, statusFilter, assigneeFilter, selectedAssignees, isFilterExpanded, sortColumn, sortDirection]);

  const loadAll = async (u: User, prof: MemberProfile) => {
    setError("");
    // customers
    const merged: Customer[] = [];
    if (prof.companyCode) {
      try {
        const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
        merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      } catch (e: any) {
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        setCustomers([]);
        setError(code && msg ? `${code}: ${msg}` : msg || "顧客一覧の読み込みに失敗しました");
        return;
      }
    } else {
      // companyCode が未設定の過去データ救済（ワークスペース分離のため通常は使わない）
      try {
        const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
        merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      } catch (e: any) {
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        setCustomers([]);
        setError(code && msg ? `${code}: ${msg}` : msg || "顧客一覧の読み込みに失敗しました");
        return;
      }
    }

    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => {
      const am = (a.createdAt as any)?.toMillis?.() || 0;
      const bm = (b.createdAt as any)?.toMillis?.() || 0;
      return bm - am;
    });
    setCustomers(items);

    // 社員を取得
    if (prof.companyCode) {
      try {
        const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
        setEmployees(empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
      } catch { setEmployees([]); }
    }

    // 案件を取得
    if (prof.companyCode) {
      try {
        const dealSnap = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
        const dealItems = dealSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal));
        setDeals(dealItems);
      } catch (e) {
        console.warn("deals load failed:", e);
        setDeals([]);
      }
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
        const prof = await ensureProfile(u);
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
              setVisibleUids(new Set());
            } else {
              const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
              const perms = msSnap.exists()
                ? parseDataVisibility(msSnap.data(), "customerPermissions")
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

  const employeesByUid = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) if (e.authUid) m[e.authUid] = e;
    return m;
  }, [employees]);

  const assigneeDisplayName = (uid?: string | null): string => {
    if (!uid) return "";
    if (uid === user?.uid) return profile?.displayName?.trim() || user?.displayName?.trim() || user?.email?.split("@")[0] || "ユーザー";
    return employeesByUid[uid]?.name || "不明";
  };

  const toggleAssignee = (uid: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(uid) ? prev.filter((a) => a !== uid) : [...prev, uid]
    );
  };

  const [assigneeSearch, setAssigneeSearch] = useState("");

  const assigneeList = useMemo(() => {
    const list: { uid: string; name: string; color?: string; employmentType?: string }[] = [];
    list.push({ uid: "__unassigned__", name: "担当者未設定", color: "#94A3B8" });
    if (user) {
      const myName = profile?.displayName || user.email?.split("@")[0] || "ユーザー";
      const myEmp = employees.find(e => e.authUid === user.uid);
      list.push({ uid: user.uid, name: myName, color: "#F97316", employmentType: myEmp?.employmentType });
    }
    const activeEmps = employees.filter((e) => e.isActive !== false);
    for (const emp of activeEmps) {
      if (emp.authUid && emp.authUid !== user?.uid) {
        // 権限でフィルタ（visibleUids が空 = 全員表示、非空 = 含まれるもののみ）
        if (!isOwner && visibleUids.size > 0 && !visibleUids.has(emp.authUid)) continue;
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color, employmentType: emp.employmentType });
      }
    }
    return list;
  }, [user, employees, profile?.displayName, isOwner, visibleUids]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // 顧客ごとの案件数を計算
  const dealCountByCustomer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const deal of deals) {
      if (deal.customerId) {
        counts[deal.customerId] = (counts[deal.customerId] || 0) + 1;
      }
    }
    return counts;
  }, [deals]);

  // 権限によるフィルタ済みリスト
  const visibleCustomers = useMemo(() => {
    if (isOwner) return customers;
    return filterByVisibleUids(customers, (c) => getCustomerAssignees(c), visibleUids);
  }, [customers, visibleUids, isOwner]);

  const filtered = useMemo(() => {
    let list = visibleCustomers;
    if (statusFilter === "ACTIVE") list = list.filter((c) => isCustomerActive(c));
    if (statusFilter === "INACTIVE") list = list.filter((c) => !isCustomerActive(c));
    if (assigneeFilter !== "ALL") {
      if (assigneeFilter === "__unassigned__") {
        list = list.filter((c) => getCustomerAssignees(c).length === 0);
      } else {
        list = list.filter((c) => getCustomerAssignees(c).includes(assigneeFilter));
      }
    }
    if (selectedAssignees.length > 0) {
      const hasUnassigned = selectedAssignees.includes("__unassigned__");
      const others = selectedAssignees.filter((a) => a !== "__unassigned__");
      list = list.filter((c) => {
        const assignees = getCustomerAssignees(c);
        const matchesUnassigned = hasUnassigned && assignees.length === 0;
        const matchesOther = others.length > 0 && assignees.some((uid) => others.includes(uid));
        return matchesUnassigned || matchesOther;
      });
    }
    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const hay = `${c.name || ""} ${c.contactName || ""} ${c.contactEmail || ""} ${c.notes || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (sortColumn) {
      list = [...list].sort((a, b) => {
        let aVal: any;
        let bVal: any;
        switch (sortColumn) {
          case "name":
            aVal = (a.name || "").toLowerCase();
            bVal = (b.name || "").toLowerCase();
            break;
          case "assignee": {
            const aAssignees = getCustomerAssignees(a);
            const bAssignees = getCustomerAssignees(b);
            aVal = aAssignees.length > 0 ? assigneeDisplayName(aAssignees[0]).toLowerCase() : "zzz";
            bVal = bAssignees.length > 0 ? assigneeDisplayName(bAssignees[0]).toLowerCase() : "zzz";
            break;
          }
          case "status":
            aVal = isCustomerActive(a) ? 0 : 1;
            bVal = isCustomerActive(b) ? 0 : 1;
            break;
          case "deals":
            aVal = dealCountByCustomer[a.id] || 0;
            bVal = dealCountByCustomer[b.id] || 0;
            break;
          case "revenue":
            aVal = typeof a.contractAmount === "number" ? a.contractAmount : 0;
            bVal = typeof b.contractAmount === "number" ? b.contractAmount : 0;
            break;
          case "createdAt":
            aVal = (a.createdAt as any)?.toMillis?.() || 0;
            bVal = (b.createdAt as any)?.toMillis?.() || 0;
            break;
          case "updatedAt":
            aVal = (a.updatedAt as any)?.toMillis?.() || 0;
            bVal = (b.updatedAt as any)?.toMillis?.() || 0;
            break;
          default:
            return 0;
        }
        if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [visibleCustomers, qText, statusFilter, assigneeFilter, selectedAssignees, sortColumn, sortDirection, dealCountByCustomer]);

  // フィルタ中の担当者UID一覧（担当者別フィルタが有効な場合）
  const activeAssigneeUids = useMemo(() => {
    const uids: string[] = [];
    if (assigneeFilter !== "ALL" && assigneeFilter !== "__unassigned__") {
      uids.push(assigneeFilter);
    }
    for (const a of selectedAssignees) {
      if (a !== "__unassigned__" && !uids.includes(a)) uids.push(a);
    }
    return uids;
  }, [assigneeFilter, selectedAssignees]);

  const totalRevenue = useMemo(() => {
    let sum = 0;
    for (const c of filtered) {
      // 担当者フィルタが有効 & assigneeSales がある場合、対象担当者分だけ加算
      if (activeAssigneeUids.length > 0 && c.assigneeSales && Object.keys(c.assigneeSales).length > 0) {
        for (const uid of activeAssigneeUids) {
          const v = c.assigneeSales[uid];
          if (typeof v === "number" && !Number.isNaN(v)) sum += v;
        }
      } else {
        const v = c.contractAmount;
        if (typeof v === "number" && !Number.isNaN(v)) sum += v;
      }
    }
    return sum;
  }, [filtered, activeAssigneeUids]);

  if (loading) {
    return (
      <AppShell title="顧客一覧" subtitle="Customers">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="顧客一覧"
      subtitle="Customers"
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      ) : null}
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
              <div className="relative" ref={assigneeDropdownRef}>
                <button
                  onClick={() => { setAssigneeDropdownOpen((v) => !v); setAssigneeSearch(""); }}
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
                  <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
                    <div className="p-2 border-b border-slate-100">
                      <input
                        type="text"
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        placeholder="担当者を検索..."
                        autoFocus
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-orange-300"
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1">
                      {(() => {
                        const q = assigneeSearch.toLowerCase();
                        const filteredList = assigneeList.filter(a =>
                          !q || a.name.toLowerCase().includes(q) || (a.employmentType || "").toLowerCase().includes(q)
                        );
                        // グループ化: 未設定 → 雇用形態別
                        const unassigned = filteredList.filter(a => a.uid === "__unassigned__");
                        const rest = filteredList.filter(a => a.uid !== "__unassigned__");
                        const groups: Record<string, typeof rest> = {};
                        for (const a of rest) {
                          const key = a.employmentType || "その他";
                          if (!groups[key]) groups[key] = [];
                          groups[key].push(a);
                        }
                        const empTypeOrder = ["正社員", "契約社員", "パート", "アルバイト", "業務委託", "その他"];
                        const sortedKeys = Object.keys(groups).sort((a, b) => empTypeOrder.indexOf(a) - empTypeOrder.indexOf(b));

                        const renderItem = (a: typeof assigneeList[0]) => (
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
                              {a.uid === "__unassigned__" ? "—" : a.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-bold text-slate-700 truncate">{a.name}</span>
                          </label>
                        );

                        if (filteredList.length === 0) {
                          return <div className="px-3 py-2 text-xs text-slate-500">該当なし</div>;
                        }

                        return (
                          <>
                            {unassigned.map(renderItem)}
                            {sortedKeys.map(key => (
                              <div key={key}>
                                <div className="px-2 pt-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{key}</div>
                                {groups[key].map(renderItem)}
                              </div>
                            ))}
                          </>
                        );
                      })()}
                    </div>
                    {selectedAssignees.length > 0 && (
                      <div className="p-2 border-t border-slate-100">
                        <button
                          type="button"
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
              <span className="text-xs font-bold text-slate-500">売上合計: {formatYen(totalRevenue)}</span>
              <Link href="/customers/new" className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-orange-600 shadow-sm transition">
                顧客を追加
              </Link>
            </div>
          </div>

          {isFilterExpanded && (
            <div className="mt-4 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold text-slate-700">
                <button
                  onClick={() => setStatusFilter("ACTIVE")}
                  className={clsx(
                    "rounded-full px-3 py-1.5",
                    statusFilter === "ACTIVE" ? "bg-emerald-600 text-white" : "bg-slate-100",
                  )}
                >
                  稼働中
                </button>
                <button
                  onClick={() => setStatusFilter("INACTIVE")}
                  className={clsx(
                    "rounded-full px-3 py-1.5",
                    statusFilter === "INACTIVE" ? "bg-slate-700 text-white" : "bg-slate-100",
                  )}
                >
                  停止中
                </button>
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className={clsx(
                    "rounded-full px-3 py-1.5",
                    statusFilter === "ALL" ? "bg-orange-600 text-white" : "bg-slate-100",
                  )}
                >
                  すべて
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="顧客名 / メモ / 連絡先など"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-500">担当者</div>
                  <select
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="ALL">すべて</option>
                    <option value="__unassigned__">担当者未設定</option>
                    {user && <option value={user.uid}>{assigneeDisplayName(user.uid)}</option>}
                    {employees
                      .filter((e) => e.isActive !== false && !!e.authUid && e.authUid !== user?.uid
                        && (isOwner || visibleUids.size === 0 || visibleUids.has(e.authUid!)))
                      .map((e) => (
                        <option key={e.id} value={e.authUid!}>{e.name}</option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("name")}>
                    <div className="flex items-center gap-1">顧客{sortColumn === "name" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("assignee")}>
                    <div className="flex items-center gap-1">担当者{sortColumn === "assignee" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("status")}>
                    <div className="flex items-center gap-1">稼働{sortColumn === "status" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("deals")}>
                    <div className="flex items-center justify-center gap-1">案件数{sortColumn === "deals" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("revenue")}>
                    <div className="flex items-center justify-end gap-1">売上{sortColumn === "revenue" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("createdAt")}>
                    <div className="flex items-center gap-1">追加日{sortColumn === "createdAt" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort("updatedAt")}>
                    <div className="flex items-center gap-1">更新日{sortColumn === "updatedAt" && <span className="text-slate-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                  </th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      該当する顧客がありません
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const active = isCustomerActive(c);
                    const dealCount = dealCountByCustomer[c.id] || 0;
                    const assignees = getCustomerAssignees(c);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <Link href={`/customers/${c.id}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {assignees.length > 0 ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(activeAssigneeUids.length > 0
                                ? assignees.filter((uid) => activeAssigneeUids.includes(uid))
                                : assignees.slice(0, 3)
                              ).map((uid) => {
                                const aName = assigneeDisplayName(uid);
                                const aEmp = employeesByUid[uid];
                                const aColor = uid === user?.uid ? "#F97316" : (aEmp?.color || "#CBD5E1");
                                return (
                                  <div key={uid} className="flex items-center gap-1.5">
                                    <div
                                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                                      style={{ backgroundColor: aColor }}
                                      title={aName}
                                    >
                                      {aName.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-xs font-bold text-slate-700">{aName}</span>
                                  </div>
                                );
                              })}
                              {activeAssigneeUids.length === 0 && assignees.length > 3 && (
                                <span className="text-[10px] text-slate-500">+{assignees.length - 3}</span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-500">
                              未設定
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-extrabold",
                              active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700",
                            )}
                          >
                            {active ? "稼働中" : "停止中"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {dealCount > 0 ? (
                            <Link
                              href={`/projects?customerId=${encodeURIComponent(c.id)}`}
                              className="inline-flex items-center justify-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-extrabold text-sky-700 hover:bg-sky-200"
                            >
                              {dealCount}件
                            </Link>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-bold text-slate-700 whitespace-nowrap">
                          {activeAssigneeUids.length > 0 && c.assigneeSales && Object.keys(c.assigneeSales).length > 0 ? (
                            <>
                              {activeAssigneeUids.map((uid) => {
                                const amount = c.assigneeSales![uid];
                                return amount ? (
                                  <div key={uid} className="flex items-center justify-end gap-1.5">
                                    {activeAssigneeUids.length > 1 && (
                                      <span className="text-[10px] text-slate-500">{assigneeDisplayName(uid)}</span>
                                    )}
                                    <span>{formatYen(amount)}</span>
                                  </div>
                                ) : null;
                              })}
                            </>
                          ) : (
                            <>
                              <div>{formatYen(c.contractAmount)}</div>
                              {c.assigneeSales && Object.keys(c.assigneeSales).length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {Object.entries(c.assigneeSales).map(([uid, amount]) => (
                                    <div key={uid} className="flex items-center justify-end gap-1.5">
                                      <span className="text-[10px] text-slate-500">{assigneeDisplayName(uid)}</span>
                                      <span className="text-[10px] font-extrabold text-orange-600">{formatYen(amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                          {formatDate(c.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                          {formatDate(c.updatedAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/customers/${encodeURIComponent(c.id)}/edit`}
                            className="inline-flex rounded-md bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100"
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
    </AppShell>
  );
}
