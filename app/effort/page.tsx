"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";

type MemberProfile = { uid: string; companyCode: string; displayName?: string | null };
type Employee = { id: string; name: string; authUid?: string; color?: string; isActive?: boolean | null };
type Deal = { id: string; title: string; customerId?: string | null; companyCode?: string };

type RepeatRule = {
  freq: "WEEKLY";
  interval: number;
  byWeekday: number[];
  end?: { type: "NONE" } | { type: "UNTIL"; until: string } | { type: "COUNT"; count: number };
  exdates?: string[];
};

type TimeEntry = {
  id: string;
  uid: string;
  companyCode: string;
  customerId?: string | null;
  dealId?: string | null;
  project: string;
  summary: string;
  start: string;
  end: string;
  repeat?: RepeatRule | null;
  baseId?: string;
  isOccurrence?: boolean;
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

function hoursLabel(hours: number) {
  const n = Number.isFinite(hours) ? hours : 0;
  return `${n.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
}

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function endOfDayMs(dateKey: string) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function combineDateAndTime(dateKey: string, base: Date) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setHours(base.getHours(), base.getMinutes(), 0, 0);
  return d;
}

function lastOccurrenceDateKeyForCount(baseStart: Date, rule: RepeatRule) {
  const by = (rule.byWeekday?.length ? [...rule.byWeekday] : [baseStart.getDay()]).sort((a, b) => a - b);
  const interval = Math.max(1, rule.interval || 1);
  const count = rule.end && rule.end.type === "COUNT" ? Math.max(1, Math.floor(rule.end.count)) : 1;

  let seen = 0;
  let weekStart = startOfWeek(baseStart);
  const baseMs = baseStart.getTime();
  while (seen < count) {
    for (const wd of by) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + wd);
      const occ = combineDateAndTime(toDateKey(date), baseStart);
      if (occ.getTime() < baseMs) continue;
      seen += 1;
      if (seen >= count) return toDateKey(date);
    }
    weekStart = new Date(weekStart.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
  }
  return toDateKey(baseStart);
}

function expandRecurringEntries(entries: TimeEntry[], rangeStart: Date, rangeEnd: Date) {
  const out: TimeEntry[] = [];
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();

  for (const e of entries) {
    const baseStart = new Date(e.start);
    const baseEnd = new Date(e.end);
    const durMs = Math.max(1, baseEnd.getTime() - baseStart.getTime());

    const rule = e.repeat || null;
    if (!rule) {
      // 工数は「月に跨る」可能性があるので overlap で判定する（startだけでは判定しない）
      const s = baseStart.getTime();
      const ed = baseEnd.getTime();
      if (!Number.isNaN(s) && !Number.isNaN(ed) && ed > rangeStartMs && s < rangeEndMs) out.push(e);
      continue;
    }

    if (rule.freq !== "WEEKLY") continue;

    const by = (rule.byWeekday?.length ? [...rule.byWeekday] : [baseStart.getDay()]).sort((a, b) => a - b);
    const interval = Math.max(1, rule.interval || 1);
    const exdates = new Set((rule.exdates || []).filter(Boolean));

    let seriesEndMs = Number.POSITIVE_INFINITY;
    if (rule.end?.type === "UNTIL") seriesEndMs = endOfDayMs(rule.end.until);
    if (rule.end?.type === "COUNT") seriesEndMs = endOfDayMs(lastOccurrenceDateKeyForCount(baseStart, rule));

    const effectiveStartMs = Math.max(rangeStartMs, baseStart.getTime());
    const effectiveStart = new Date(effectiveStartMs);

    const baseWeek = startOfWeek(baseStart).getTime();
    let week = startOfWeek(effectiveStart).getTime();
    if (week < baseWeek) week = baseWeek;

    const diffWeeks = Math.floor((week - baseWeek) / (7 * 24 * 60 * 60 * 1000));
    const rem = ((diffWeeks % interval) + interval) % interval;
    week = week - rem * 7 * 24 * 60 * 60 * 1000;
    if (week < baseWeek) week = baseWeek;

    for (; week <= rangeEndMs && week <= seriesEndMs; week += interval * 7 * 24 * 60 * 60 * 1000) {
      for (const wd of by) {
        const d = new Date(week);
        d.setDate(d.getDate() + wd);
        const occKey = toDateKey(d);
        if (exdates.has(occKey)) continue;
        const occStart = combineDateAndTime(occKey, baseStart);
        const occStartMs = occStart.getTime();
        if (occStartMs < baseStart.getTime()) continue;
        if (occStartMs < effectiveStartMs) continue;
        if (occStartMs > rangeEndMs) continue;
        if (occStartMs > seriesEndMs) continue;

        const occEnd = new Date(occStartMs + durMs);
        out.push({
          ...e,
          id: `${e.id}__${occStart.toISOString()}`,
          baseId: e.id,
          isOccurrence: true,
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
        });
      }
    }
  }

  return out;
}

function overlapHours(startIso: string, endIso: string, rangeStart: Date, rangeEnd: Date) {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const a = Math.max(s, rangeStart.getTime());
  const b = Math.min(e, rangeEnd.getTime());
  const ms = Math.max(0, b - a);
  return ms / (60 * 60 * 1000);
}

export default function EffortPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => ymKey(new Date()));

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  // 担当者別ショートカット
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);
  
  const [dealId, setDealId] = useState<string>("ALL");

  const range = useMemo(() => {
    const { y, m } = parseYM(month);
    const start = new Date(y, m - 1, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(y, m, 1);
    end.setHours(0, 0, 0, 0);
    return { start, end };
  }, [month]);

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        setError("");
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) {
          setProfile(null);
          setEmployees([]);
          setDeals([]);
          setEntries([]);
          setError("会社コードが未設定です（設定 > 会社 で設定してください）");
          return;
        }
        setProfile(prof);

        // 権限チェック
        try {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          const isOwner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
          if (!isOwner) {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            if (msSnap.exists()) {
              const perms = (msSnap.data() as any).permissions || {};
              if (perms.effort === false) {
                window.location.href = "/";
                return;
              }
            }
          }
        } catch (e) {
          console.warn("permission check failed:", e);
        }

        const [empSnap, dealSnap, entrySnap] = await Promise.all([
          getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode))),
          getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode))),
          getDocs(query(collection(db, "timeEntries"), where("companyCode", "==", prof.companyCode))),
        ]);

        const empItems = empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
        empItems.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        // 自分が employees に居ない救済（カレンダーと同じ挙動）
        if (!empItems.some((e) => e.authUid === u.uid)) {
          empItems.push({ id: "__me__", name: (prof.displayName as string) || "私", authUid: u.uid });
        }
        setEmployees(empItems);

        const dealItems = dealSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal));
        dealItems.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        setDeals(dealItems);

        const rawEntries = entrySnap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeEntry));
        // 月の範囲で繰り返し展開し、月内に入る分だけ集計
        const expanded = expandRecurringEntries(rawEntries, range.start, new Date(range.end.getTime() - 1));
        setEntries(expanded);
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, range.start, range.end]);

  const employeesByUid = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) {
      if (e.authUid) m[e.authUid] = e;
    }
    return m;
  }, [employees]);

  const activeUids = useMemo(() => {
    const set = new Set<string>();
    if (user) set.add(user.uid);
    for (const e of employees) {
      if (e.isActive !== false && e.authUid) set.add(e.authUid);
    }
    return set;
  }, [user, employees]);

  const dealsById = useMemo(() => {
    const m: Record<string, Deal> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

  const rows = useMemo(() => {
    // uid -> dealId -> hours
    const agg: Record<string, Record<string, number>> = {};
    for (const e of entries) {
      if (!e.uid) continue;
      if (!e.dealId) continue; // 工数は案件必須（UI側で必須化済み）
      if (selectedUids.length > 0 && !selectedUids.includes(e.uid)) continue;
      if (dealId !== "ALL" && e.dealId !== dealId) continue;

      const h = overlapHours(e.start, e.end, range.start, range.end);
      if (h <= 0) continue;
      (agg[e.uid] ||= {});
      agg[e.uid][e.dealId] = (agg[e.uid][e.dealId] || 0) + h;
    }

    const items: Array<{
      uid: string;
      name: string;
      dealId: string;
      dealTitle: string;
      hours: number;
      rowSpan: number;
      totalHours: number;
    }> = [];

    const uids = Object.keys(agg)
      .filter((uid) => activeUids.has(uid))
      .sort((a, b) => {
        const an = (employeesByUid[a]?.name || a).toLowerCase();
        const bn = (employeesByUid[b]?.name || b).toLowerCase();
        return an.localeCompare(bn);
      });

    for (const uid of uids) {
      const perDeal = agg[uid] || {};
      const dealIds = Object.keys(perDeal).sort((a, b) => (perDeal[b] || 0) - (perDeal[a] || 0));
      const total = dealIds.reduce((s, id) => s + (perDeal[id] || 0), 0);
      if (dealIds.length === 0) continue;
      dealIds.forEach((did, idx) => {
        items.push({
          uid,
          name: employeesByUid[uid]?.name || "(不明)",
          dealId: did,
          dealTitle: dealsById[did]?.title || "（案件不明）",
          hours: perDeal[did] || 0,
          rowSpan: idx === 0 ? dealIds.length : 0,
          totalHours: total,
        });
      });
    }

    return items;
  }, [selectedUids, dealId, dealsById, employeesByUid, activeUids, entries, range.end, range.start]);

  const grandTotal = useMemo(() => rows.reduce((s, r) => s + (r.hours || 0), 0), [rows]);

  const toggleUid = (uid: string) => {
    setSelectedUids(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  // 担当者リスト（自分 + 稼働中社員）を取得
  const assigneeList = useMemo(() => {
    const list: { uid: string; name: string; color?: string }[] = [];
    if (user) {
      list.push({ uid: user.uid, name: "私", color: "#F97316" });
    }
    const activeEmps = employees.filter((e) => e.isActive !== false);
    for (const emp of activeEmps) {
      if (emp.authUid && emp.authUid !== user?.uid) {
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color });
      }
    }
    return list;
  }, [user, employees]);

  if (loading) {
    return (
      <AppShell title="工数">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="工数集計"
      subtitle={<div className="text-xs text-slate-500 font-medium">カレンダーの入力データに基づき、月次の工数を自動集計します</div>}
      headerRight={
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 border-r border-slate-200 pr-4 mr-2">
            <div className="text-right">
              <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none mb-1">合計工数</div>
              <div className="text-lg font-black text-slate-900 tabular-nums leading-none">
                {hoursLabel(grandTotal)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none mb-1">対象人数</div>
              <div className="text-lg font-black text-slate-900 tabular-nums leading-none">
                {new Set(rows.map(r => r.uid)).size}<span className="text-xs font-bold text-slate-400 ml-0.5">名</span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            印刷
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-4">
        {/* フィルター・サマリーカード */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-slate-100 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, -1))}
                  className="rounded-lg p-2 text-slate-600 hover:bg-white hover:text-orange-600 hover:shadow-sm transition-all"
                  title="前月"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="px-4 py-1 text-base font-extrabold text-slate-900 min-w-[100px] text-center">
                  {labelYM(month)}
                </div>
                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, +1))}
                  className="rounded-lg p-2 text-slate-600 hover:bg-white hover:text-orange-600 hover:shadow-sm transition-all"
                  title="次月"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              
              <button
                onClick={() => setMonth(ymKey(new Date()))}
                className="text-xs font-bold text-orange-600 hover:underline px-2"
              >
                今月
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* 担当者別ショートカット */}
              <div className="relative" ref={assigneeDropdownRef}>
                <button
                  onClick={() => setAssigneeDropdownOpen((v) => !v)}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-xs font-extrabold transition flex items-center gap-1.5",
                    selectedUids.length > 0
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  担当者別
                  {selectedUids.length > 0 && (
                    <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{selectedUids.length}</span>
                  )}
                </button>
                
                {assigneeDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="p-2 border-b border-slate-100">
                      <div className="text-[10px] font-bold text-slate-500">担当者を選択</div>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {assigneeList.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">社員データを読み込み中...</div>
                      ) : (
                        assigneeList.map((a) => (
                          <label
                            key={a.uid}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedUids.includes(a.uid)}
                              onChange={() => toggleUid(a.uid)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                            />
                            <div
                              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white flex-shrink-0"
                              style={{ backgroundColor: a.color || "#CBD5E1" }}
                            >
                              {a.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-bold text-slate-700 truncate">{a.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {selectedUids.length > 0 && (
                      <div className="p-2 border-t border-slate-100">
                        <button
                          onClick={() => {
                            setSelectedUids([]);
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

              <div className="min-w-[180px]">
                <select
                  value={dealId}
                  onChange={(e) => setDealId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                >
                  <option value="ALL">すべての案件</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                        {d.title || "（無題）"}
                      </option>
                    ))}
                  </select>
                </div>
            </div>
          </div>
        </div>

        {/* 集計テーブル */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-50/50 text-[11px] font-black uppercase tracking-widest text-slate-500">
                  <th className="border-b border-slate-200 px-6 py-4 text-center">担当者</th>
                  <th className="border-b border-slate-200 px-6 py-4">案件</th>
                  <th className="border-b border-slate-200 px-6 py-4 text-right">工数</th>
                  <th className="border-b border-slate-200 px-6 py-4 text-center">個人合計</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-12 w-12 rounded-full bg-slate-50 flex items-center justify-center text-2xl">Empty</div>
                        <div className="text-sm font-bold text-slate-400">対象期間の工数データが見つかりません</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr key={`${r.uid}_${r.dealId}_${idx}`} className="group hover:bg-slate-50/50 transition-colors">
                      {r.rowSpan > 0 ? (
                        <td 
                          className={clsx(
                            "px-6 py-5 align-middle border-r border-slate-50",
                            idx !== 0 && "border-t border-slate-100"
                          )} 
                          rowSpan={r.rowSpan}
                        >
                          <div className="flex flex-col items-center justify-center gap-2 text-center">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-sm font-black text-orange-600 shadow-inner">
                              {r.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-black text-slate-900 leading-tight">{r.name}</div>
                              <div className="text-[9px] font-bold text-slate-400 tabular-nums mt-0.5">ID: {r.uid.slice(0, 8)}</div>
                            </div>
                          </div>
                        </td>
                      ) : null}
                      <td className="px-6 py-5">
                        <div className="text-sm font-bold text-slate-800 group-hover:text-orange-600 transition-colors">
                          {r.dealTitle}
                        </div>
                        <div className="mt-0.5 text-[10px] font-bold text-slate-400 tabular-nums">ID: {r.dealId.slice(0, 8)}...</div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-black text-slate-700 tabular-nums">
                          {hoursLabel(r.hours)}
                        </span>
                      </td>
                      {r.rowSpan > 0 ? (
                        <td 
                          className={clsx(
                            "px-6 py-5 text-center align-middle border-l border-slate-50",
                            idx !== 0 && "border-t border-slate-100"
                          )} 
                          rowSpan={r.rowSpan}
                        >
                          <div className="inline-block">
                            <div className="text-lg font-black text-slate-900 tabular-nums leading-none">
                              {hoursLabel(r.totalHours)}
                            </div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-1 border-t border-slate-100 pt-1">Monthly Total</div>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 補足情報 */}
        <div className="flex items-center justify-center gap-2 py-4 text-slate-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[11px] font-bold">このデータはカレンダーの予定から自動計算されています。実績の修正はカレンダーから行ってください。</span>
        </div>
      </div>
    </AppShell>
  );
}

