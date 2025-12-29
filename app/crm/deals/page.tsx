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

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
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
  description?: string;
  status: DealStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function DealsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState<DealStatus | "ALL">("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");

  const loadAll = async (u: User, prof: MemberProfile) => {
    // customers
    const mergedCust: Customer[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      mergedCust.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const snapByCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
    mergedCust.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    const custMap = new Map<string, Customer>();
    for (const c of mergedCust) custMap.set(c.id, c);
    const custItems = Array.from(custMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(custItems);

    // deals
    const mergedDeals: Deal[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
      mergedDeals.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Deal)));
    }
    const snapByCreator2 = await getDocs(query(collection(db, "deals"), where("createdBy", "==", u.uid)));
    mergedDeals.push(...snapByCreator2.docs.map((d) => ({ id: d.id, ...d.data() } as Deal)));
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

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return deals.filter((d) => {
      if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
      if (customerFilter !== "ALL" && d.customerId !== customerFilter) return false;
      if (!q) return true;
      const cust = customersById[d.customerId]?.name || "";
      const hay = `${d.title || ""} ${d.description || ""} ${cust}`.toLowerCase();
      return hay.includes(q);
    });
  }, [deals, qText, statusFilter, customerFilter, customersById]);

  const toggleStatus = async (deal: Deal) => {
    if (!user || !profile) return;
    const next: DealStatus = deal.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await updateDoc(doc(db, "deals", deal.id), {
      status: next,
      updatedAt: Timestamp.now(),
    });
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "DEAL_UPDATED",
      message: `案件ステータスを更新しました: ${deal.title}（${next === "ACTIVE" ? "稼働中" : "停止"}）`,
      link: "/deals",
    });
    await loadAll(user, profile);
  };

  if (loading) {
    return (
      <AppShell title="案件一覧" subtitle="Deals">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
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
        <>
          <Link href="/customers" className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50">
            ← 顧客一覧
          </Link>
          <Link href="/deals/new" className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-extrabold text-emerald-950 hover:bg-emerald-600">
            ＋ 案件追加
          </Link>
        </>
      }
    >
      <div className="mx-auto w-full max-w-6xl">
          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-12">
            <input
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="案件名 / 顧客名で検索"
              className="lg:col-span-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="lg:col-span-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none"
            >
              <option value="ALL">すべて</option>
              <option value="ACTIVE">稼働中</option>
              <option value="INACTIVE">停止</option>
            </select>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="lg:col-span-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none"
            >
              <option value="ALL">顧客：すべて</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-extrabold text-slate-600">
              <div className="col-span-4">案件</div>
              <div className="col-span-4">顧客</div>
              <div className="col-span-2">ステータス</div>
              <div className="col-span-2 text-right">操作</div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">案件がまだありません。右上から追加してください。</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map((d) => {
                  const cust = customersById[d.customerId];
                  return (
                    <div key={d.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                      <div className="col-span-4 min-w-0">
                        <div className="truncate font-extrabold text-slate-900">{d.title}</div>
                        {d.description ? <div className="truncate text-xs text-slate-500">{d.description}</div> : null}
                      </div>
                      <div className="col-span-4 truncate text-slate-700">{cust?.name || "-"}</div>
                      <div className="col-span-2">
                        <span
                          className={
                            "inline-flex rounded-full px-3 py-1 text-xs font-extrabold " +
                            (d.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")
                          }
                        >
                          {d.status === "ACTIVE" ? "稼働中" : "停止"}
                        </span>
                      </div>
                      <div className="col-span-2 text-right">
                        <button
                          onClick={() => toggleStatus(d)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          切替
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>
    </AppShell>
  );
}

export default function DealsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-emerald-800">読み込み中...</div>
        </div>
      }
    >
      <DealsInner />
    </Suspense>
  );
}


