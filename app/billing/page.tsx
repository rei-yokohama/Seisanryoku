"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

type BillingStatus = "none" | "done" | "no_invoice";
type BillingCell = { create: BillingStatus; confirm: BillingStatus; send: BillingStatus };
type BillingRow = { id: string; companyName: string; ownerName?: string; months: Record<string, BillingCell> };
type BillingState = { viewMode?: "YEAR" | "RANGE"; startMonth: string; monthsToShow: number; rows: BillingRow[] };

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

export default function BillingPage() {
  const initial = useMemo(() => defaultState(), []);
  const { state, setState, loaded } = useLocalStorageState<BillingState>("billing:v1", initial);

  // 旧state互換（viewModeが無い場合は年表示に寄せる）
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

  return (
    <AppShell
      title="請求管理"
      subtitle="請求作成・確認・送付の月次ステータス"
      headerRight={
        <Link
          href="/billing/edit"
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
              <div className="text-sm font-extrabold text-slate-900">{viewMode === "YEAR" ? "年次ステータス" : "月次ステータス"}</div>
              <div className="text-xs font-bold text-slate-600">
                {viewMode === "YEAR" ? (
                  <>
                    対象年: <span className="text-slate-900">{year}年</span>
                  </>
                ) : (
                  <>
                    開始月: <span className="text-slate-900">{labelMonth(state.startMonth)}</span>
                  </>
                )}
              </div>
              {viewMode !== "YEAR" ? (
                <div className="text-xs font-bold text-slate-600">
                  表示月数: <span className="text-slate-900">{state.monthsToShow}ヶ月</span>
                </div>
              ) : null}
              {!loaded ? <div className="text-xs font-bold text-slate-400">保存データ読込中...</div> : null}
            </div>
            {viewMode === "YEAR" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setState((p) => ({ ...p, viewMode: "YEAR", startMonth: `${year - 1}-01`, monthsToShow: 12 }))}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                  type="button"
                >
                  ← {year - 1}年
                </button>
                <button
                  onClick={() => setState((p) => ({ ...p, viewMode: "YEAR", startMonth: `${year + 1}-01`, monthsToShow: 12 }))}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                  type="button"
                >
                  {year + 1}年 →
                </button>
              </div>
            ) : null}
          </div>
          <div className="mt-3 text-[11px] font-bold text-slate-500">
            ○ = 完了、「請求なし」= 請求対象外
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
                  <td colSpan={1 + months.length * 3} className="px-4 py-10 text-center text-slate-400 bg-white italic font-medium">
                    データがありません。編集ボタンから登録してください。
                  </td>
                </tr>
              ) : (
                state.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#fcfdfc]">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3 font-bold text-slate-800">
                      <div className="min-w-0">
                        <div className="truncate">{r.companyName}</div>
                        {r.ownerName ? <div className="mt-1 text-[10px] font-extrabold text-slate-500">担当: {r.ownerName}</div> : null}
                      </div>
                    </td>
                    {months.flatMap((m) => {
                      const cell = r.months[m] ?? defaultCell();
                      const badges = [statusBadge(cell.create), statusBadge(cell.confirm), statusBadge(cell.send)];
                      return badges.map((badge, idx) => (
                        <td
                          key={`${m}-${idx}`}
                          className={classNames(
                            "h-10 px-2 py-2 text-center border-r border-slate-200",
                            // 月の3列目の後は少し強めの区切り
                            idx === 2 ? "border-r-2 border-slate-200" : "",
                          )}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span className={classNames("inline-flex items-center justify-center rounded px-2 py-1", badge.cls)}>
                              {badge.text || "—"}
                            </span>
                            {badge.text && r.ownerName ? (
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-extrabold text-slate-700"
                                title={`担当: ${r.ownerName}`}
                              >
                                {r.ownerName.trim().charAt(0)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      ));
                    })}
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
