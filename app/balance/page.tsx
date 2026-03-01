"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { useLocalStorageState } from "../../lib/useLocalStorageState";

type MemberProfile = { uid: string; companyCode: string; displayName?: string };

type Employee = { id: string; name: string; authUid?: string; color?: string; isActive?: boolean | null };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
type Deal = {
  id: string;
  title: string;
  status?: string;
  assigneeUids?: string[] | null; // 担当者（複数）
  leaderUid?: string | null; // 旧: 互換用
  createdBy?: string | null;
  revenue?: number | null;
};

type BalanceState = {
  costs: Record<string, number>; // 担当者uid -> cost
  sales: Record<string, number>; // dealId -> sales
  confirmed?: boolean;
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
  const router = useRouter();
  const [month, setMonth] = useState(() => ymKey(new Date()));
  const [editMode, setEditMode] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  // 担当者別ショートカット
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  const storageKey = useMemo(() => {
    const code = profile?.companyCode || "no-company";
    return `balance:v1:${code}:${month}`;
  }, [profile?.companyCode, month]);
  const { state, setState, loaded: storageLoaded } = useLocalStorageState<BalanceState>(storageKey, { costs: {}, sales: {} });

  // 案件の担当者リストを取得（新旧フィールド互換）
  const getDealAssignees = (d: Deal): string[] => {
    if (Array.isArray(d.assigneeUids) && d.assigneeUids.length > 0) {
      return d.assigneeUids.filter(Boolean) as string[];
    }
    // 旧フィールドから復元
    if (d.leaderUid) return [d.leaderUid];
    return [];
  };

  const rows = useMemo(() => {
    const activeDeals = deals.filter((d) => (d.status || "ACTIVE") === "ACTIVE");
    const dealsByAssignee: Record<string, Deal[]> = {};
    const unassigned: Deal[] = [];
    for (const d of activeDeals) {
      const assignees = getDealAssignees(d);
      // 担当者がいない場合は未アサイン
      if (assignees.length === 0) {
        unassigned.push(d);
        continue;
      }
      // 先頭の担当者でグルーピング（複数担当の場合は先頭の人の下に表示）
      const primaryAssignee = assignees[0];
      (dealsByAssignee[primaryAssignee] ||= []).push(d);
    }
    for (const k of Object.keys(dealsByAssignee)) {
      dealsByAssignee[k].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }

    const activeEmployees = employees.filter((e) => e.isActive !== false);
    const employeeItems = [...activeEmployees].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const out: Array<{
      assigneeUid: string;
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
      const assigneeUid = String(emp.authUid || "");
      const list = assigneeUid ? (dealsByAssignee[assigneeUid] || []) : [];
      const cost = Number(state.costs[assigneeUid] || 0);
      const totalSales = list.reduce((s, d) => {
        const base = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? 0 : Number(override) || 0;
        return s + sales;
      }, 0);
      const profit = totalSales - cost;

      if (list.length === 0) {
        out.push({
          assigneeUid,
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
        const sales = override === undefined ? 0 : Number(override) || 0;
        out.push({
          assigneeUid,
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

    // 担当者未設定の稼働中案件があれば末尾に表示
    if (unassigned.length > 0) {
      const cost = Number(state.costs["__unassigned__"] || 0);
      const totalSales = unassigned.reduce((s, d) => {
        const base = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? 0 : Number(override) || 0;
        return s + sales;
      }, 0);
      const profit = totalSales - cost;
      unassigned.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      unassigned.forEach((d, idx) => {
        const baseSales = Number((d as any).revenue) || 0;
        const override = (state.sales as any)[d.id];
        const sales = override === undefined ? 0 : Number(override) || 0;
        out.push({
          assigneeUid: "__unassigned__",
          assigneeName: "（担当者未設定）",
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

  // 担当者でフィルタした表示用rows
  const filteredRows = useMemo(() => {
    if (selectedAssignees.length === 0) return rows;
    return rows.filter((r) => selectedAssignees.includes(r.assigneeUid));
  }, [rows, selectedAssignees]);

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
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color });
      }
    }
    return list;
  }, [user, employees, profile?.displayName]);

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

  const setCost = (assigneeUid: string, raw: string) => {
    const n = raw.trim() === "" ? 0 : Number(raw);
    setState((prev) => ({
      ...prev,
      costs: { ...prev.costs, [assigneeUid]: Number.isFinite(n) ? Math.max(0, n) : prev.costs[assigneeUid] || 0 },
    }));
  };

  const setSale = (dealId: string, raw: string) => {
    setState((prev) => ({
      ...prev,
      sales: (() => {
        const next = { ...prev.sales };
        const t = raw.trim();
        if (!t) {
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

  const isConfirmed = !!state.confirmed;

  const toggleConfirm = () => {
    setState((prev) => ({ ...prev, confirmed: !prev.confirmed }));
    setEditMode(false);
  };

  const autoInsert = () => {
    const activeDeals = deals.filter((d) => (d.status || "ACTIVE") === "ACTIVE");
    setState((prev) => {
      const newSales = { ...prev.sales };
      for (const d of activeDeals) {
        const rev = Number((d as any).revenue) || 0;
        if (rev > 0) newSales[d.id] = rev;
      }
      return { ...prev, sales: newSales };
    });
  };

  return (
    <AppShell
      title="収支"
      subtitle="担当者ごとの月次 収支"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div />
          <div className="flex items-center gap-2">
            {editMode && !isConfirmed && (
              <button
                type="button"
                onClick={autoInsert}
                className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-sky-600 shadow-sm transition"
              >
                自動挿入
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              disabled={loading || !storageLoaded || isConfirmed}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {editMode ? "完了" : "編集"}
            </button>
            {isConfirmed ? (
              <button
                type="button"
                onClick={toggleConfirm}
                className="rounded-md bg-slate-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-600 shadow-sm transition"
              >
                確定解除
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleConfirm}
                disabled={loading || !storageLoaded}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
              >
                確定
              </button>
            )}
          </div>
        </div>
        {/* Month header (image-like) */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-visible">
          <div className="flex items-center justify-between bg-emerald-50 px-3 py-2 rounded-t-lg">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 hover:bg-emerald-50"
                aria-label="前月"
              >
                ←
              </button>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-slate-900 tracking-tight">{labelYM(month)}</span>
                {isConfirmed && (
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white">確定済</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 hover:bg-emerald-50"
                aria-label="翌月"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setMonth(ymKey(new Date()))}
                className={clsx(
                  "rounded-md px-2.5 py-1 text-[11px] font-extrabold transition",
                  month === ymKey(new Date())
                    ? "bg-emerald-600 text-white"
                    : "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
                )}
              >
                今月
              </button>
            </div>
            
            {/* 担当者別ショートカット */}
            <div className="relative" ref={assigneeDropdownRef}>
              <button
                onClick={() => setAssigneeDropdownOpen((v) => !v)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-extrabold transition flex items-center gap-1.5",
                  selectedAssignees.length > 0
                    ? "bg-sky-600 text-white"
                    : "bg-white border border-emerald-200 text-slate-700 hover:bg-emerald-50",
                )}
              >
                担当者別
                {selectedAssignees.length > 0 && (
                  <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{selectedAssignees.length}</span>
                )}
              </button>
              
              {assigneeDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-[100] w-48 rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
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
                filteredRows.map((r, idx) => (
                  <tr
                    key={`${r.assigneeUid}-${r.dealId || "none"}-${idx}`}
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
                            value={String(Number(state.costs[r.assigneeUid] || 0))}
                            onChange={(e) => setCost(r.assigneeUid, e.target.value)}
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
                        r.profit < 0 ? "text-rose-700" : r.profit > 0 ? "text-emerald-600" : "text-slate-900",
                      ].join(" ")}
                    >
                      {yen(r.profit)}
                    </td>
                  ) : null}
                </tr>
                ))
              )}
              {!loading && filteredRows.length === 0 ? (
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

