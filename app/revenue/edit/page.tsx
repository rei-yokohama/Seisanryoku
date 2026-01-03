"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AppShell } from "../../AppShell";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

type RevenueMonth = { sales: number; profit: number };
type RevenueRow = { id: string; agencyName: string; dealName: string; months: Record<string, RevenueMonth> };
type RevenueState = { startMonth: string; monthsToShow: number; rows: RevenueRow[] };

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function ymKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function labelMonth(key: string) {
  const m = key.split("-")[1] ?? "1";
  return `${Number(m)}月`;
}

function yen(n: number) {
  const nf = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
  return nf.format(isFinite(n) ? n : 0);
}

function defaultState(): RevenueState {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  return {
    startMonth: ymKey(start),
    monthsToShow: 4,
    rows: [
      { id: "r1", agencyName: "ファインドスター（ワンスター請求）", dealName: "ステイプロウ（パピリオ）", months: {} },
      { id: "r2", agencyName: "インセクト", dealName: "パルシステム", months: {} },
      { id: "r3", agencyName: "株式会社All Ads（旧 株式会社ネットマーケティング）", dealName: "エンリンチ トライアルキット（ファンケル）", months: {} },
    ],
  };
}

export default function RevenueEditPage() {
  const initial = useMemo(() => defaultState(), []);
  const { state, setState, loaded, clear } = useLocalStorageState<RevenueState>("revenue:v1", initial);

  const months = useMemo(() => {
    const [y, m] = state.startMonth.split("-").map(Number);
    const start = new Date(y, (m || 1) - 1, 1);
    return Array.from({ length: Math.max(1, state.monthsToShow) }, (_, i) => ymKey(addMonths(start, i)));
  }, [state.startMonth, state.monthsToShow]);

  const updateText = (rowId: string, field: "agencyName" | "dealName", value: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)) }));
  };

  const updateNumber = (rowId: string, monthKey: string, field: keyof RevenueMonth, value: number) => {
    setState((prev) => {
      const rows = prev.rows.map((r) => {
        if (r.id !== rowId) return r;
        const cur = r.months[monthKey] ?? { sales: 0, profit: 0 };
        const next: RevenueMonth = { ...cur, [field]: value };
        return { ...r, months: { ...r.months, [monthKey]: next } };
      });
      return { ...prev, rows };
    });
  };

  const addRow = () => {
    setState((prev) => ({
      ...prev,
      rows: [{ id: `r_${Date.now()}`, agencyName: "（新規）", dealName: "（案件）", months: {} }, ...prev.rows],
    }));
  };

  const deleteRow = (rowId: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== rowId) }));
  };

  const totals = useMemo(() => {
    const byMonth: Record<string, { sales: number; profit: number }> = {};
    for (const m of months) byMonth[m] = { sales: 0, profit: 0 };
    for (const r of state.rows) {
      for (const m of months) {
        const v = r.months[m];
        if (!v) continue;
        byMonth[m].sales += Number(v.sales) || 0;
        byMonth[m].profit += Number(v.profit) || 0;
      }
    }
    return byMonth;
  }, [months, state.rows]);

  return (
    <AppShell
      title="売上・利益編集"
      subtitle="案件別の月次 売上/利益 管理編集"
      headerRight={
        <Link
          href="/revenue"
          className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
        >
          結果を表示
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm font-extrabold text-slate-900">案件別推移</div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <span>開始月</span>
                <input
                  type="month"
                  value={state.startMonth}
                  onChange={(e) => setState((p) => ({ ...p, startMonth: e.target.value }))}
                  className="rounded border border-slate-300 bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <span>表示月数</span>
                <select
                  value={state.monthsToShow}
                  onChange={(e) => setState((p) => ({ ...p, monthsToShow: Number(e.target.value) }))}
                  className="rounded border border-slate-300 bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-orange-500"
                >
                  {[3, 4, 6, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {!loaded ? <div className="text-xs font-bold text-slate-400">保存データ読込中...</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={addRow}
                className="rounded bg-orange-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-orange-700"
              >
                ＋ 行追加
              </button>
              <button
                onClick={clear}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              >
                デモに戻す
              </button>
            </div>
          </div>
          <div className="mt-3 text-[11px] font-bold text-slate-500">金額は数値入力（円）です。フッターに月次合計を表示します。</div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-[11px] font-bold">
            <thead className="bg-[#f8f9f8] text-slate-500">
              <tr className="border-b border-slate-200">
                <th rowSpan={2} className="sticky left-0 z-10 w-[260px] border-r border-slate-200 bg-[#f8f9f8] px-4 py-2">
                  代理店名
                </th>
                <th rowSpan={2} className="sticky left-[260px] z-10 w-[320px] border-r border-slate-200 bg-[#f8f9f8] px-4 py-2">
                  案件名
                </th>
                {months.map((m) => (
                  <th key={m} colSpan={2} className="border-r border-slate-200 px-4 py-2 text-center">
                    {labelMonth(m)}
                  </th>
                ))}
                <th rowSpan={2} className="w-[84px] px-4 py-2 text-center">
                  操作
                </th>
              </tr>
              <tr className="border-b border-slate-200">
                {months.flatMap((m) => [
                  <th key={`${m}-sales`} className="border-r border-slate-200 px-3 py-2 text-center">
                    売上
                  </th>,
                  <th key={`${m}-profit`} className="border-r border-slate-200 px-3 py-2 text-center">
                    利益
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {state.rows.map((r) => (
                <tr key={r.id} className="hover:bg-[#fcfdfc]">
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2">
                    <input
                      value={r.agencyName}
                      onChange={(e) => updateText(r.id, "agencyName", e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </td>
                  <td className="sticky left-[260px] z-10 border-r border-slate-200 bg-white px-3 py-2">
                    <input
                      value={r.dealName}
                      onChange={(e) => updateText(r.id, "dealName", e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </td>
                  {months.map((m) => {
                    const v = r.months[m] ?? { sales: 0, profit: 0 };
                    return (
                      <td key={m} className="p-0" colSpan={2}>
                        <div className="grid grid-cols-2">
                          {(
                            [
                              { field: "sales" as const, value: v.sales },
                              { field: "profit" as const, value: v.profit },
                            ] as const
                          ).map(({ field, value }, idx) => (
                            <div
                              key={`${m}-${field}`}
                              className={classNames("border-r border-slate-200 px-2 py-2", idx === 1 && "border-r-0")}
                            >
                              <input
                                type="number"
                                inputMode="numeric"
                                value={Number.isFinite(value) ? value : 0}
                                onChange={(e) => updateNumber(r.id, m, field, Number(e.target.value))}
                                className="w-32 rounded border border-slate-200 bg-white px-2 py-1.5 text-right text-[12px] font-extrabold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
                              />
                              <div className="mt-1 text-right text-[10px] font-bold text-slate-400">{yen(Number(value) || 0)}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => deleteRow(r.id)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-extrabold text-slate-600 hover:bg-slate-50"
                      type="button"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#f8f9f8] text-slate-700">
              <tr className="border-t border-slate-200">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-[#f8f9f8] px-4 py-3 text-[12px] font-extrabold" colSpan={2}>
                  月次合計
                </td>
                {months.map((m) => {
                  const t = totals[m] ?? { sales: 0, profit: 0 };
                  const margin = t.sales > 0 ? (t.profit / t.sales) * 100 : 0;
                  return (
                    <td key={m} colSpan={2} className="border-r border-slate-200 px-3 py-3">
                      <div className="flex items-center justify-between text-[11px] font-extrabold">
                        <span className="text-slate-500">売上</span>
                        <span>{yen(t.sales)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] font-extrabold">
                        <span className="text-slate-500">利益</span>
                        <span>{yen(t.profit)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-500">
                        <span>粗利率</span>
                        <span>{margin.toFixed(1)}%</span>
                      </div>
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-center text-[10px] font-bold text-slate-500">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

