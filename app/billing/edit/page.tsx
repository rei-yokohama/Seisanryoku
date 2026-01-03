"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "../../AppShell";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

type BillingStatus = "none" | "done" | "no_invoice";
type BillingCell = { create: BillingStatus; confirm: BillingStatus; send: BillingStatus };
type BillingRow = { id: string; companyName: string; ownerName?: string; months: Record<string, BillingCell> };
type BillingState = { viewMode?: "YEAR" | "RANGE"; startMonth: string; monthsToShow: number; rows: BillingRow[] };

const STATUS_ORDER: BillingStatus[] = ["none", "done", "no_invoice"];

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
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

function nextStatus(cur: BillingStatus): BillingStatus {
  const idx = STATUS_ORDER.indexOf(cur);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length] ?? "none";
}

function statusBadge(status: BillingStatus) {
  if (status === "done") return { text: "○", cls: "bg-orange-500 text-white" };
  if (status === "no_invoice") return { text: "請求なし", cls: "bg-slate-200 text-slate-700" };
  return { text: "", cls: "bg-white text-slate-400" };
}

function defaultCell(): BillingCell {
  return { create: "none", confirm: "none", send: "none" };
}

function defaultState(): BillingState {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return {
    startMonth: ymKey(start),
    monthsToShow: 12,
    viewMode: "YEAR",
    rows: [
      { id: "r1", companyName: "株式会社カラック（60日）", ownerName: "担当A", months: {} },
      { id: "r2", companyName: "インセクト・コミュニケーションズ株式会社", ownerName: "担当B", months: {} },
      { id: "r3", companyName: "TRUESTATE株式会社", ownerName: "担当C", months: {} },
    ],
  };
}

export default function BillingEditPage() {
  const initial = useMemo(() => defaultState(), []);
  const { state, setState, loaded, clear } = useLocalStorageState<BillingState>("billing:v1", initial);

  const viewMode = state.viewMode || "YEAR";
  const year = useMemo(() => Number(state.startMonth.split("-")[0]) || new Date().getFullYear(), [state.startMonth]);

  useEffect(() => {
    if (!loaded) return;
    if (!state.viewMode) {
      setState((p) => ({ ...p, viewMode: "YEAR", startMonth: `${year}-01`, monthsToShow: 12 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const months = useMemo(() => {
    const [y, m] = (viewMode === "YEAR" ? `${year}-01` : state.startMonth).split("-").map(Number);
    const start = new Date(y, (m || 1) - 1, 1);
    const count = viewMode === "YEAR" ? 12 : Math.max(1, state.monthsToShow);
    return Array.from({ length: count }, (_, i) => ymKey(addMonths(start, i)));
  }, [state.startMonth, state.monthsToShow, viewMode, year]);

  const updateCell = (rowId: string, monthKey: string, field: keyof BillingCell) => {
    setState((prev) => {
      const rows = prev.rows.map((r) => {
        if (r.id !== rowId) return r;
        const cur = r.months[monthKey] ?? defaultCell();
        const next: BillingCell = { ...cur, [field]: nextStatus(cur[field]) };
        return { ...r, months: { ...r.months, [monthKey]: next } };
      });
      return { ...prev, rows };
    });
  };

  const updateCompanyName = (rowId: string, nextName: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.id === rowId ? { ...r, companyName: nextName } : r)) }));
  };

  const updateOwnerName = (rowId: string, nextName: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.id === rowId ? { ...r, ownerName: nextName } : r)) }));
  };

  const addRow = () => {
    setState((prev) => ({
      ...prev,
      rows: [{ id: `r_${Date.now()}`, companyName: "（新規）", months: {} }, ...prev.rows],
    }));
  };

  const deleteRow = (rowId: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== rowId) }));
  };

  return (
    <AppShell
      title="請求管理編集"
      subtitle="請求作成・確認・送付の月次ステータス編集"
      headerRight={
        <Link
          href="/billing"
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
              <div className="text-sm font-extrabold text-slate-900">{viewMode === "YEAR" ? "年次ステータス" : "月次ステータス"}</div>

              <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <span>表示</span>
                <select
                  value={viewMode}
                  onChange={(e) => {
                    const v = e.target.value as "YEAR" | "RANGE";
                    setState((p) => ({
                      ...p,
                      viewMode: v,
                      startMonth: v === "YEAR" ? `${year}-01` : p.startMonth,
                      monthsToShow: v === "YEAR" ? 12 : p.monthsToShow,
                    }));
                  }}
                  className="rounded border border-slate-300 bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-orange-500"
                >
                  <option value="YEAR">年</option>
                  <option value="RANGE">期間</option>
                </select>
              </div>

              {viewMode === "YEAR" ? (
                <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <span>対象年</span>
                  <select
                    value={year}
                    onChange={(e) => setState((p) => ({ ...p, viewMode: "YEAR", startMonth: `${Number(e.target.value)}-01`, monthsToShow: 12 }))}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-orange-500"
                  >
                    {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
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
                </>
              )}
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
          <div className="mt-3 text-[11px] font-bold text-slate-500">
            セルをクリックすると「未設定 → ○ → 請求なし」と切り替わります。
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-separate border-spacing-0 text-left text-[11px] font-bold">
            <thead className="bg-[#f8f9f8] text-slate-500">
              <tr className="border-b border-slate-200">
                <th rowSpan={2} className="sticky left-0 z-10 w-[320px] border-r border-slate-200 bg-[#f8f9f8] px-4 py-2">
                  会社名
                </th>
                {months.map((m) => (
                  <th key={m} colSpan={3} className="border-r border-slate-200 px-4 py-2 text-center">
                    {labelMonth(m)}
                  </th>
                ))}
                <th rowSpan={2} className="w-[84px] px-4 py-2 text-center">
                  操作
                </th>
              </tr>
              <tr className="border-b border-slate-200">
                {months.flatMap((m) => [
                  <th key={`${m}-c`} className="border-r border-slate-200 px-3 py-2 text-center">
                    請求作成
                  </th>,
                  <th key={`${m}-k`} className="border-r border-slate-200 px-3 py-2 text-center">
                    請求確認
                  </th>,
                  <th key={`${m}-s`} className="border-r border-slate-200 px-3 py-2 text-center">
                    請求送付
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {state.rows.length === 0 ? (
                <tr>
                  <td colSpan={1 + months.length * 3 + 1} className="px-4 py-10 text-center text-slate-400 bg-white italic font-medium">
                    行がありません。「行追加」から登録できます。
                  </td>
                </tr>
              ) : (
                state.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#fcfdfc]">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2">
                      <div className="space-y-2">
                        <input
                          value={r.companyName}
                          onChange={(e) => updateCompanyName(r.id, e.target.value)}
                          className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
                        />
                        <input
                          value={r.ownerName || ""}
                          onChange={(e) => updateOwnerName(r.id, e.target.value)}
                          className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 outline-none focus:ring-1 focus:ring-orange-500"
                          placeholder="担当（例：山田）"
                        />
                      </div>
                    </td>
                    {months.flatMap((m) => {
                      const cell = r.months[m] ?? defaultCell();
                      const defs = [
                        { field: "create" as const, badge: statusBadge(cell.create) },
                        { field: "confirm" as const, badge: statusBadge(cell.confirm) },
                        { field: "send" as const, badge: statusBadge(cell.send) },
                      ] as const;
                      return defs.map(({ field, badge }, idx) => (
                        <td
                          key={`${m}-${field}`}
                          className={classNames("p-0 border-r border-slate-200", idx === 2 ? "border-r-2 border-slate-200" : "")}
                        >
                          <button
                            onClick={() => updateCell(r.id, m, field)}
                            className="h-10 w-full text-center text-[11px] font-extrabold hover:bg-slate-50"
                            title="クリックで切り替え"
                            type="button"
                          >
                            <span className={classNames("inline-flex items-center justify-center rounded px-2 py-1", badge.cls)}>
                              {badge.text || "—"}
                            </span>
                          </button>
                        </td>
                      ));
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

