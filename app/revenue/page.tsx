"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

type RevenueMonth = { sales: number; profit: number };
type RevenueRow = { id: string; agencyName: string; dealName: string; months: Record<string, RevenueMonth> };
type RevenueState = { startMonth: string; monthsToShow: number; rows: RevenueRow[] };

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

export default function RevenuePage() {
  const initial = useMemo(() => defaultState(), []);
  const { state, loaded } = useLocalStorageState<RevenueState>("revenue:v1", initial);

  const months = useMemo(() => {
    const [y, m] = state.startMonth.split("-").map(Number);
    const start = new Date(y, (m || 1) - 1, 1);
    return Array.from({ length: Math.max(1, state.monthsToShow) }, (_, i) => ymKey(addMonths(start, i)));
  }, [state.startMonth, state.monthsToShow]);

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
      title="売上・利益"
      subtitle="案件別の月次 売上/利益 管理"
      headerRight={
        <Link
          href="/revenue/edit"
          className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
        >
          編集
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm font-extrabold text-slate-900">案件別推移</div>
              <div className="text-xs font-bold text-slate-600">
                表示月数: <span className="text-slate-900">{state.monthsToShow}ヶ月</span>
              </div>
              {!loaded ? <div className="text-xs font-bold text-slate-400">保存データ読込中...</div> : null}
            </div>
          </div>
          <div className="mt-3 text-[11px] font-bold text-slate-500">月次合計は表の最下部に表示されます。</div>
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
              {state.rows.length === 0 ? (
                <tr>
                  <td colSpan={2 + months.length * 2} className="px-4 py-10 text-center text-slate-400 bg-white italic font-medium">
                    データがありません。編集ボタンから登録してください。
                  </td>
                </tr>
              ) : (
                state.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#fcfdfc]">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3 font-bold text-slate-800">
                      {r.agencyName}
                    </td>
                    <td className="sticky left-[260px] z-10 border-r border-slate-200 bg-white px-4 py-3 font-bold text-slate-800">
                      {r.dealName}
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
                            ).map(({ value }, idx) => (
                              <div
                                key={idx}
                                className={`border-r border-slate-200 px-3 py-3 text-right ${idx === 1 ? "border-r-0" : ""}`}
                              >
                                <div className="text-[12px] font-extrabold text-slate-800">{yen(Number(value) || 0)}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
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
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
