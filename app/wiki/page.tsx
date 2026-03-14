"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { AppShell } from "../AppShell";
import { ensureProfile } from "../../lib/ensureProfile";

type MemberProfile = {
  uid: string;
  companyCode: string;
  companyName?: string | null;
  displayName?: string | null;
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  isActive?: boolean | null;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function WikiHomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [wikiCounts, setWikiCounts] = useState<Record<string, number>>({});
  const [qText, setQText] = useState("");
  const [error, setError] = useState("");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

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

        if (prof.companyCode) {
          const [custSnap, wikiSnap] = await Promise.all([
            getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode))),
            getDocs(query(collection(db, "wikiDocs"), where("companyCode", "==", prof.companyCode))),
          ]);
          setCustomers(
            custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer))
          );
          // wiki数を顧客別に集計
          const counts: Record<string, number> = {};
          for (const d of wikiSnap.docs) {
            const cid = (d.data() as any).customerId;
            if (cid) counts[cid] = (counts[cid] || 0) + 1;
          }
          setWikiCounts(counts);
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCustomers = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return customers
      .filter((c) => c.isActive !== false)
      .filter((c) => !q || (c.name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [customers, qText]);

  return (
    <AppShell title="Wiki" subtitle="顧客別ドキュメント">
      <div className="px-0 py-1">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>
        ) : null}

        {/* 検索条件 */}
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-700">全 {activeCustomers.length} 件</span>
            </div>
          </div>

          {isFilterExpanded && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="顧客名で検索"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[600px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">顧客名</th>
                  <th className="px-4 py-3 text-right">Wiki数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      読み込み中...
                    </td>
                  </tr>
                ) : activeCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      稼働中の顧客がありません。顧客を追加すると自動で表示されます。
                    </td>
                  </tr>
                ) : (
                  activeCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-900">
                        <Link href={`/wiki/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-600">
                        {wikiCounts[c.id] || 0}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
