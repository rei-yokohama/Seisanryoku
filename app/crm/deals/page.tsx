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
  const [tab, setTab] = useState<"ALL" | "MINE">("ALL");
  const [statusFilter, setStatusFilter] = useState<DealStatus | "ALL">("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  
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
      if (tab === "MINE" && user && d.createdBy !== user.uid) return false;
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
      <div className="mx-auto w-full max-w-[1600px] px-4">
        {/* HubSpot-style Tab Bar */}
        <div className="mb-4 flex items-center border-b border-slate-200">
          <button
            onClick={() => setTab("ALL")}
            className={clsx(
              "px-4 py-2 text-sm font-bold transition-all border-b-2",
              tab === "ALL" ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            全ての案件 <span className="ml-1 text-[10px] opacity-60 bg-slate-100 px-1.5 py-0.5 rounded-full">{deals.length}</span>
          </button>
          <button
            onClick={() => setTab("MINE")}
            className={clsx(
              "px-4 py-2 text-sm font-bold transition-all border-b-2",
              tab === "MINE" ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            自分の案件
          </button>
          <div className="ml-auto flex items-center gap-2 pb-2">
             <div className="relative">
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="案件名 / 顧客名で検索..."
                  className="w-64 rounded-md border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 transition"
                />
                <svg className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
             </div>
          </div>
        </div>

        {/* HubSpot-style Filter Bar */}
        <div className="mb-2 flex items-center gap-3 py-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 outline-none hover:bg-slate-50 cursor-pointer transition"
          >
            <option value="ALL">全てのステータス</option>
            <option value="ACTIVE">稼働中</option>
            <option value="INACTIVE">停止</option>
          </select>

          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 outline-none hover:bg-slate-50 cursor-pointer transition max-w-[200px]"
          >
            <option value="ALL">全ての顧客</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          
          <div className="h-4 w-[1px] bg-slate-200 mx-1" />
          <button className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline">
            詳細フィルター
          </button>
        </div>

        {/* Table Area */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[400px]">
          <table className="w-full table-fixed divide-y divide-slate-100">
            <thead className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="w-1/3 px-4 py-3 text-left">案件名</th>
                <th className="w-1/4 px-4 py-3 text-left">顧客</th>
                <th className="w-1/4 px-4 py-3 text-left">案件の担当者</th>
                <th className="w-48 px-4 py-3 text-left">作成日 (GMT+9)</th>
                <th className="w-24 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center">
                      <div className="h-12 w-12 rounded-full bg-slate-50 flex items-center justify-center mb-3 text-slate-300">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <p className="text-sm font-bold text-slate-400 italic">該当する案件が見つかりませんでした</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const cust = customersById[d.customerId];
                  const creator = employeesByUid[d.createdBy];
                  return (
                    <tr key={d.id} className="group hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/projects/${d.id}/detail`} className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center text-slate-400 group-hover:scale-110 transition-transform">
                             <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-extrabold text-blue-600 truncate group-hover:underline">
                              {d.title}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                               <span className={clsx(
                                 "inline-flex rounded-full px-2 py-0.5 text-[9px] font-extrabold border",
                                 d.status === "ACTIVE" ? "bg-orange-50 text-orange-700 border-orange-100" : "bg-slate-50 text-slate-600 border-slate-200"
                               )}>
                                 {d.status === "ACTIVE" ? "稼働中" : "停止"}
                               </span>
                               {d.genre && (
                                 <span className="text-[10px] font-bold text-slate-400">#{d.genre}</span>
                               )}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {cust ? (
                          <Link href={`/customers/${cust.id}`} className="text-[12px] font-bold text-slate-700 hover:text-blue-600 hover:underline transition truncate block">
                            {cust.name}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {creator ? (
                          <div className="flex items-center gap-2">
                             <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: creator.color || "#CBD5E1" }}>
                                {creator.name.charAt(0)}
                             </div>
                             <div className="min-w-0">
                               <div className="text-[11px] font-bold text-slate-700 truncate">{creator.name}</div>
                             </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] font-bold text-slate-600">
                        {formatDateTime(d.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(d)}
                            className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition"
                            title="編集"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="mt-4 flex items-center justify-center gap-4 text-xs font-bold text-slate-500">
           <button className="flex items-center gap-1 hover:text-orange-500 transition disabled:opacity-30" disabled>
             <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 19l-7-7 7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
             前へ
           </button>
           <div className="flex items-center gap-1">
             <span className="px-2 py-1 rounded bg-orange-100 text-orange-700 border border-orange-200">1</span>
           </div>
           <button className="flex items-center gap-1 hover:text-orange-500 transition disabled:opacity-30" disabled>
             次へ
             <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 5l7 7-7 7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
           </button>
           <div className="h-4 w-[1px] bg-slate-200 mx-2" />
           <div className="flex items-center gap-2">
             <span>ページあたり</span>
             <select className="bg-transparent outline-none cursor-pointer hover:text-orange-500 transition">
               <option>25件</option>
               <option>50件</option>
               <option>100件</option>
             </select>
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
