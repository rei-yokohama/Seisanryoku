"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { Suspense } from "react";
import { AppShell } from "../../AppShell";
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
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
  assigneeUid?: string | null;
};

type DealStatus = "ACTIVE" | "INACTIVE";

type Deal = {
  id: string;
  companyCode: string;
  createdBy: string;
  customerId: string;
  title: string;
  genre?: string;
  description?: string;
  status: DealStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function formatDateTime(ts?: Timestamp) {
  if (!ts) return "--";
  const date = ts.toDate();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}年${m}月${d}日 ${hh}:${mm} GMT+9`;
}

function DealsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const [qText, setQText] = useState("");
  const [tab, setTab] = useState<"ALL" | "MINE">("ALL"); // MINE = 自分の顧客（担当）
  const [statusFilter, setStatusFilter] = useState<DealStatus | "ALL">("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<DealStatus>("ACTIVE");
  const [editCustomerId, setEditCustomerId] = useState("");
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
    const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
    setEmployees(empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));

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

  useEffect(() => {
    const initialStatus = (searchParams.get("status") || "").toUpperCase();
    if (initialStatus === "ACTIVE" || initialStatus === "INACTIVE") {
      setStatusFilter(initialStatus as DealStatus);
    }
    const initialCustomerId = searchParams.get("customerId") || "";
    if (initialCustomerId) setCustomerFilter(initialCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "profiles", u.uid));
        if (!snap.exists()) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const prof = snap.data() as MemberProfile;
        setProfile(prof);
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

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return deals.filter((d) => {
      if (tab === "MINE" && user) {
        const cust = customersById[d.customerId];
        if (!cust || (cust.assigneeUid || "") !== user.uid) return false;
      }
      if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
      if (customerFilter !== "ALL" && d.customerId !== customerFilter) return false;
      if (!q) return true;
      const cust = customersById[d.customerId]?.name || "";
      const hay = `${d.title || ""} ${d.genre || ""} ${d.description || ""} ${cust}`.toLowerCase();
      return hay.includes(q);
    });
  }, [deals, qText, tab, statusFilter, customerFilter, customersById, user]);

  const openEdit = (deal: Deal) => {
    setEditing(deal);
    setEditTitle(deal.title);
    setEditGenre(deal.genre || "");
    setEditDescription(deal.description || "");
    setEditStatus(deal.status);
    setEditCustomerId(deal.customerId);
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
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/customers" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            ← 顧客一覧
          </Link>
          <Link href="/projects/new" className="rounded-md bg-orange-500 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-orange-600 shadow-sm transition">
            案件を追加
          </Link>
        </div>
      }
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
            </div>
            <div className="text-sm font-bold text-slate-700">全 {filtered.length} 件</div>
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
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="案件名 / 顧客名で検索"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs font-extrabold text-slate-500">ステータス</div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="ALL">すべて</option>
                    <option value="ACTIVE">稼働中</option>
                    <option value="INACTIVE">停止</option>
                  </select>
                </div>
                <div className="md:col-span-4">
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
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">案件</th>
                  <th className="px-4 py-3 text-left">顧客</th>
                  <th className="px-4 py-3 text-left">担当者</th>
                  <th className="px-4 py-3 text-left">状態</th>
                  <th className="px-4 py-3 text-left">更新</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      該当する案件がありません
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const cust = customersById[d.customerId];
                    const assigneeUid = cust?.assigneeUid || "";
                    const assignee = (assigneeUid && employeesByUid[assigneeUid]) || employeesByUid[d.createdBy];
                    const updated = (d.updatedAt as any) || d.createdAt;
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <Link href={`/projects/${d.id}/detail`} className="hover:underline">
                            {d.title || "無題"}
                          </Link>
                          {d.genre ? <div className="mt-1 text-xs font-bold text-slate-500">#{d.genre}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-800 font-bold">
                          {cust ? (
                            <Link href={`/customers/${cust.id}`} className="hover:underline">
                              {cust.name}
                            </Link>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {assignee?.name ? (
                            <div className="flex items-center gap-2">
                              <div
                                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-white"
                                style={{ backgroundColor: assignee.color || "#CBD5E1" }}
                              >
                                {assignee.name.charAt(0).toUpperCase()}
                              </div>
                              <span>{assignee.name}</span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                              d.status === "ACTIVE" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-700",
                            )}
                          >
                            {d.status === "ACTIVE" ? "稼働中" : "停止"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(updated)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEdit(d)}
                            className="rounded-md bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100"
                          >
                            編集
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
                <div className="mb-1 text-sm font-bold text-slate-700">案件ジャンル</div>
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
                  <option value="ACTIVE">稼働中</option>
                  <option value="INACTIVE">停止</option>
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
