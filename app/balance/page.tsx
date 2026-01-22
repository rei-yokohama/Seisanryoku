"use client";

import { useMemo, useState } from "react";
import { AppShell } from "../AppShell";

type BalanceDeal = { dealName: string; sales: number };
type BalancePerson = { assigneeName: string; cost: number; deals: BalanceDeal[] };

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

function sampleData(): BalancePerson[] {
  return [
    {
      assigneeName: "Aさん",
      cost: 300_000,
      deals: [
        { dealName: "案件A", sales: 120_000 },
        { dealName: "案件B", sales: 120_000 },
        { dealName: "案件C", sales: 120_000 },
      ],
    },
    {
      assigneeName: "Bさん",
      cost: 350_000,
      deals: [
        { dealName: "案件D", sales: 200_000 },
        { dealName: "案件E", sales: 350_000 },
        { dealName: "案件F", sales: 120_000 },
      ],
    },
  ];
}

export default function BalancePage() {
  const [month, setMonth] = useState(() => ymKey(new Date()));
  const people = useMemo(() => sampleData(), []);

  const rows = useMemo(() => {
    return people.flatMap((p) => {
      const totalSales = p.deals.reduce((s, d) => s + (Number(d.sales) || 0), 0);
      const cost = Number(p.cost) || 0;
      const profit = totalSales - cost;
      return p.deals.map((d, idx) => ({
        assigneeName: p.assigneeName,
        dealName: d.dealName,
        sales: Number(d.sales) || 0,
        cost,
        profit,
        rowSpan: idx === 0 ? p.deals.length : 0,
      }));
    });
  }, [people]);

  return (
    <AppShell title="収支" subtitle="担当者ごとの月次 収支">
      <div className="space-y-3">
        {/* Month header (image-like) */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between bg-emerald-50 px-4 py-2">
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-50"
              aria-label="前月"
            >
              ←
            </button>
            <div className="text-lg font-extrabold text-slate-900">{labelYM(month)}</div>
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-50"
              aria-label="翌月"
            >
              →
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-amber-50 text-sm font-extrabold text-slate-900">
              <tr className="border-b border-slate-200">
                <th className="w-[180px] px-4 py-3 text-left whitespace-nowrap">担当者名</th>
                <th className="w-[240px] px-4 py-3 text-left whitespace-nowrap">案件名</th>
                <th className="w-[180px] px-4 py-3 text-center whitespace-nowrap">コスト</th>
                <th className="w-[180px] px-4 py-3 text-center whitespace-nowrap">売上</th>
                <th className="w-[180px] px-4 py-3 text-center whitespace-nowrap">収支</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r, idx) => (
                <tr key={`${r.assigneeName}-${r.dealName}-${idx}`} className="bg-white">
                  {r.rowSpan ? (
                    <td rowSpan={r.rowSpan} className="px-4 py-6 text-center font-extrabold text-slate-900 whitespace-nowrap">
                      {r.assigneeName}
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-center font-bold text-slate-900 whitespace-nowrap">{r.dealName}</td>
                  {r.rowSpan ? (
                    <td rowSpan={r.rowSpan} className="px-4 py-6 text-center font-extrabold text-slate-900 whitespace-nowrap">
                      -{yen(r.cost)}
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-center font-extrabold text-slate-900 whitespace-nowrap">{yen(r.sales)}</td>
                  {r.rowSpan ? (
                    <td rowSpan={r.rowSpan} className="px-4 py-6 text-center font-extrabold text-slate-900 whitespace-nowrap">
                      {yen(r.profit)}
                    </td>
                  ) : null}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    データがありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="text-xs font-bold text-slate-500">
          ※ いまは画面のたたき台（ダミーデータ）です。次に、案件/工数/売上の実データを紐づけて月次で集計します。
        </div>
      </div>
    </AppShell>
  );
}

