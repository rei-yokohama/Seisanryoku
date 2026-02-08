"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, Timestamp, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import { AppShell } from "../../AppShell";
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Customer = {
  id: string;
  companyCode: string;
  createdBy: string;
  name: string;
  isActive?: boolean | null; // 稼働中/停止中
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  industry?: string;
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

export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE"); // デフォルト: 稼働中のみ
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

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

        // 権限チェック
        if (prof.companyCode) {
          try {
            const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
            const isOwner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
            if (!isOwner) {
              const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
              if (msSnap.exists()) {
                const perms = (msSnap.data() as any).permissions || {};
                if (perms.customers === false) {
                  window.location.href = "/";
                  return;
                }
              }
            }
          } catch (e) {
            console.warn("permission check failed:", e);
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

  const filtered = useMemo(() => {
    let list = customers;
    if (statusFilter === "ACTIVE") list = list.filter((c) => isCustomerActive(c));
    if (statusFilter === "INACTIVE") list = list.filter((c) => !isCustomerActive(c));
    const q = qText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const hay = `${c.name || ""} ${c.contactName || ""} ${c.contactEmail || ""} ${c.notes || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [customers, qText, statusFilter]);

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
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/customers/new" className="rounded-md bg-orange-500 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-orange-600 shadow-sm transition">
            顧客を追加
          </Link>
        </div>
      }
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
            </div>
            <div className="text-sm font-bold text-slate-700">全 {filtered.length} 件</div>
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
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">顧客</th>
                  <th className="px-4 py-3 text-left">稼働</th>
                  <th className="px-4 py-3 text-center">案件数</th>
                  <th className="px-4 py-3 text-left">追加日</th>
                  <th className="px-4 py-3 text-left">更新日</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      該当する顧客がありません
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const active = isCustomerActive(c);
                    const dealCount = dealCountByCustomer[c.id] || 0;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <Link href={`/customers/${c.id}`} className="hover:underline">
                            {c.name}
                          </Link>
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
