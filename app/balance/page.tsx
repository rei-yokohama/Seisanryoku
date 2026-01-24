"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { AppShell } from "../AppShell";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { useLocalStorageState } from "../../lib/useLocalStorageState";

type MemberProfile = { uid: string; companyCode: string };

type Employee = { id: string; name: string; authUid?: string };
type Deal = { id: string; title: string; status?: string; leaderUid?: string | null; createdBy?: string | null; revenue?: number | null };

type BalanceState = {
  costs: Record<string, number>; // leaderUid -> cost
  sales: Record<string, number>; // dealId -> sales
};

function ymKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseYM(key: string) {
  const [y, m] = key.split("-").map((v) => Number(v));
  return { y: y || new Date().getFullYear(), m: m || new Date().getMonth() + 1 };
}

function addMonths(key: string, delta: number) {
  const { y, m } = parseYM(key);
  const d = new Date(y, (m - 1) + delta, 1);
  return ymKey(d);
}

function labelYM(key: string) {
  const { y, m } = parseYM(key);
  return `${y}/${m}`;
}

function yen(n: number) {
  const nf = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
  return nf.format(isFinite(n) ? n : 0);
}

export default function BalancePage() {
  const [month, setMonth] = useState(() => ymKey(new Date()));
  const [editMode, setEditMode] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const storageKey = useMemo(() => {
    const code = profile?.companyCode || "no-company";
    return `balance:v1:${code}:${month}`;
  }, [profile?.companyCode, month]);
  const { state, setState, loaded: storageLoaded } = useLocalStorageState<BalanceState>(storageKey, { costs: {}, sales: {} });

  const rows = useMemo(() => {
    const activeDeals = deals.filter((d) => (d.status || "ACTIVE") === "ACTIVE");
    const dealsByLeader: Record<string, Deal[]> = {};
    const unassigned: Deal[] = [];
    for (const d of activeDeals) {
      const leader = String(d.leaderUid || d.createdBy || "");
      if (!leader) {
        unassigned.push(d);
        continue;
      }
      (dealsByLeader[leader] ||= []).push(d);
    }
    for (const k of Object.keys(dealsByLeader)) {
      dealsByLeader[k].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }

    const employeeItems = [...employees].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const out: Array<{
      leaderUid: string;
      assigneeName: string;
      dealId: string | null;
      dealName: string;
      sales: number;
      baseSales: number;
      cost: number;
      profit: number;
      rowSpan: number;
    }> = [];

    for (const emp of employeeItems) {
      const leaderUid = String(emp.authUid || "");
      const list = leaderUid ? (dealsByLeader[leaderUid] || []) : [];
      const cost = Number(state.costs[leaderUid] || 0);
      const totalSales = list.reduce((s, d) => {
        const base = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? base : Number(override) || 0;
        return s + sales;
      }, 0);
      const profit = totalSales - cost;

      if (list.length === 0) {
        out.push({
          leaderUid,
          assigneeName: emp.name || "(無名)",
          dealId: null,
          dealName: "-",
          sales: 0,
          baseSales: 0,
          cost,
          profit,
          rowSpan: 1,
        });
        continue;
      }

      list.forEach((d, idx) => {
        const baseSales = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? baseSales : Number(override) || 0;
        out.push({
          leaderUid,
          assigneeName: emp.name || "(無名)",
          dealId: d.id,
          dealName: d.title || "（無題）",
          sales,
          baseSales,
          cost,
          profit,
          rowSpan: idx === 0 ? list.length : 0,
        });
      });
    }

    // leader未設定の稼働中案件があれば末尾に表示
    if (unassigned.length > 0) {
      const cost = Number(state.costs["__unassigned__"] || 0);
      const totalSales = unassigned.reduce((s, d) => {
        const base = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? base : Number(override) || 0;
        return s + sales;
      }, 0);
      const profit = totalSales - cost;
      unassigned.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      unassigned.forEach((d, idx) => {
        const baseSales = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? baseSales : Number(override) || 0;
        out.push({
          leaderUid: "__unassigned__",
          assigneeName: "（リーダー未設定）",
          dealId: d.id,
          dealName: d.title || "（無題）",
          sales,
          baseSales,
          cost,
          profit,
          rowSpan: idx === 0 ? unassigned.length : 0,
        });
      });
    }

    return out;
  }, [deals, employees, state.costs, state.sales]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        setError("");
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) {
          setProfile(null);
          setEmployees([]);
          setDeals([]);
          setError("会社コードが未設定です（設定 > 会社 で設定してください）");
          return;
        }
        setProfile(prof);

        // members/employees
        const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
        const empItems = empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
        empItems.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setEmployees(empItems);

        // deals: index回避のため companyCode だけで取得し、statusはクライアントでフィルタ
        const dealSnap = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
        const dealItems = dealSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal));
        setDeals(dealItems);
      } catch (e: any) {
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        setError(code && msg ? `${code}: ${msg}` : msg || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const setCost = (leaderUid: string, raw: string) => {
    const n = raw.trim() === "" ? 0 : Number(raw);
    setState((prev) => ({
      ...prev,
      costs: { ...prev.costs, [leaderUid]: Number.isFinite(n) ? Math.max(0, n) : prev.costs[leaderUid] || 0 },
    }));
  };

  const setSale = (dealId: string, raw: string) => {
    setState((prev) => ({
      ...prev,
      sales: (() => {
        const next = { ...prev.sales };
        const t = raw.trim();
        if (!t) {
          // 空欄に戻したら「手入力上書き」を解除して案件の固定売上(revenue)に戻す
          delete (next as any)[dealId];
          return next;
        }
        const n = Number(t);
        if (!Number.isFinite(n)) return next;
        (next as any)[dealId] = Math.max(0, n);
        return next;
      })(),
    }));
  };

  return (
    <AppShell
      title="収支"
      subtitle="担当者ごとの月次 収支"
      headerRight={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            disabled={loading || !storageLoaded}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {editMode ? "完了" : "編集"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Month header (image-like) */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between bg-emerald-50 px-3 py-2">
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 hover:bg-emerald-50"
              aria-label="前月"
            >
              ←
            </button>
            <div className="text-base font-extrabold text-slate-900 tracking-tight">{labelYM(month)}</div>
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 hover:bg-emerald-50"
              aria-label="翌月"
            >
              →
            </button>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-[980px] w-full text-[12px] font-bold border-separate border-spacing-0">
            <thead className="bg-amber-50 text-[11px] font-extrabold text-slate-900 sticky top-0 z-10">
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 z-20 w-[170px] px-3 py-2 text-center whitespace-nowrap border-b border-r border-slate-200 bg-amber-50">担当者名</th>
                <th className="sticky left-[170px] z-20 w-[260px] px-3 py-2 text-center whitespace-nowrap border-b border-r border-slate-200 bg-amber-50">案件名</th>
                <th className="w-[180px] px-3 py-2 text-center whitespace-nowrap border-b border-r border-slate-200 bg-amber-50">コスト</th>
                <th className="w-[180px] px-3 py-2 text-center whitespace-nowrap border-b border-r border-slate-200 bg-amber-50">売上</th>
                <th className="w-[180px] px-3 py-2 text-center whitespace-nowrap border-b border-slate-200 bg-amber-50">収支</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    読み込み中...
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={`${r.leaderUid}-${r.dealId || "none"}-${idx}`}
                    className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                  >
                  {r.rowSpan ? (
                    <td
                      rowSpan={r.rowSpan}
                      className="sticky left-0 z-10 px-3 py-3 text-center font-extrabold text-slate-900 whitespace-nowrap border-b border-r border-slate-200 bg-inherit"
                    >
                      <div className="truncate max-w-[150px] mx-auto" title={r.assigneeName}>{r.assigneeName}</div>
                    </td>
                  ) : null}
                  <td className="sticky left-[170px] z-10 px-3 py-2 text-left font-bold text-slate-900 whitespace-nowrap border-b border-r border-slate-200 bg-inherit">
                    <div className="truncate max-w-[240px]" title={r.dealName}>{r.dealName}</div>
                  </td>
                  {r.rowSpan ? (
                    <td rowSpan={r.rowSpan} className="px-3 py-3 text-center font-extrabold text-slate-900 whitespace-nowrap border-b border-r border-slate-200">
                      {editMode ? (
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-slate-500 text-[11px]">-</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={String(Number(state.costs[r.leaderUid] || 0))}
                            onChange={(e) => setCost(r.leaderUid, e.target.value)}
                            className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-[12px] font-extrabold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                      ) : (
                        <span className="text-slate-700">-{yen(r.cost)}</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-center font-extrabold text-slate-900 whitespace-nowrap border-b border-r border-slate-200">
                    {editMode && r.dealId ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={String(Number(((state.sales as any)[r.dealId] ?? r.baseSales) || 0))}
                        onChange={(e) => setSale(r.dealId!, e.target.value)}
                        className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-[12px] font-extrabold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                      />
                    ) : (
                      <span className="text-slate-900">{yen(r.sales)}</span>
                    )}
                  </td>
                  {r.rowSpan ? (
                    <td
                      rowSpan={r.rowSpan}
                      className={[
                        "px-3 py-3 text-center font-extrabold whitespace-nowrap border-b border-slate-200",
                        r.profit < 0 ? "text-rose-700" : "text-slate-900",
                      ].join(" ")}
                    >
                      {yen(r.profit)}
                    </td>
                  ) : null}
                </tr>
                ))
              )}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    データがありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] font-bold text-slate-500">
          ※ コスト（担当者）と売上（案件）は「編集」で手入力し、このブラウザに保存されます（共有保存が必要なら次にFirestore保存へ拡張します）。
        </div>
      </div>
    </AppShell>
  );
}

