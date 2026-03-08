"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import {
  DEFAULT_DATA_VISIBILITY,
  parseDataVisibility,
  resolveVisibleUids,
} from "../../lib/visibilityPermissions";

type MemberProfile = { uid: string; companyCode: string; displayName?: string | null };
type Employee = { id: string; name: string; authUid?: string; color?: string; isActive?: boolean | null };
type Deal = { id: string; title: string; customerId?: string | null; companyCode?: string };
type Customer = { id: string; name: string; companyCode?: string };

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
  mtgConfirmed?: boolean;
  mtgCandidate?: boolean;
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

  const [isOwner, setIsOwner] = useState(false);
  const [visibleUids, setVisibleUids] = useState<Set<string>>(new Set());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  // 担当者別ショートカット
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);
  
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [dealDropdownOpen, setDealDropdownOpen] = useState(false);
  const [dealSearch, setDealSearch] = useState("");
  const dealDropdownRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"person" | "customer" | "chart">("person");

  const range = useMemo(() => {
    const { y, m } = parseYM(month);
    const start = new Date(y, m - 1, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(y, m, 1);
    end.setHours(0, 0, 0, 0);
    return { start, end };
  }, [month]);

  // ドロップダウンの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setAssigneeDropdownOpen(false);
      }
      if (dealDropdownRef.current && !dealDropdownRef.current.contains(e.target as Node)) {
        setDealDropdownOpen(false);
      }
    };
    if (assigneeDropdownOpen || dealDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [assigneeDropdownOpen, dealDropdownOpen]);

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

        // オーナー判定 & 権限取得
        try {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          if (compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid) {
            setIsOwner(true);
            setVisibleUids(new Set());
          } else {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            const perms = msSnap.exists()
              ? parseDataVisibility(msSnap.data(), "effortPermissions")
              : DEFAULT_DATA_VISIBILITY;
            const uids = await resolveVisibleUids(u.uid, prof.companyCode, perms);
            setVisibleUids(uids);
          }
        } catch {
          // エラー時は自分のみ表示
          setVisibleUids(new Set([u.uid]));
        }

        const [empSnap, dealSnap, custSnap, entrySnap] = await Promise.all([
          getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode))),
          getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode))),
          getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode))),
          getDocs(query(collection(db, "timeEntries"), where("companyCode", "==", prof.companyCode))),
        ]);

        const empItems = empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
        empItems.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        // 自分が employees に居ない救済（カレンダーと同じ挙動）
        if (!empItems.some((e) => e.authUid === u.uid)) {
          empItems.push({ id: "__me__", name: (prof.displayName as string) || u.email?.split("@")[0] || "ユーザー", authUid: u.uid });
        }
        setEmployees(empItems);

        const dealItems = dealSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal));
        dealItems.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        setDeals(dealItems);

        const custItems = custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer));
        setCustomers(custItems);

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

  const customersById = useMemo(() => {
    const m: Record<string, Customer> = {};
    for (const c of customers) m[c.id] = c;
    return m;
  }, [customers]);

  const rows = useMemo(() => {
    // uid -> dealId -> hours
    const agg: Record<string, Record<string, number>> = {};
    for (const e of entries) {
      if (!e.uid) continue;
      // 休憩・MTG確定はdealIdなしでも集計する
      const isBreak = !e.dealId && !e.mtgConfirmed && !e.customerId;
      const isMtg = !!e.mtgConfirmed;
      const key = e.dealId || (isMtg ? "__mtg__" : isBreak ? "__break__" : null);
      if (!key) continue;
      // 権限によるフィルタ（オーナーでない場合、visibleUids が空でなければフィルタ適用）
      if (!isOwner && visibleUids.size > 0 && !visibleUids.has(e.uid)) continue;
      if (selectedUids.length > 0 && !selectedUids.includes(e.uid)) continue;
      if (selectedDealIds.length > 0 && e.dealId && !selectedDealIds.includes(e.dealId)) continue;

      const h = overlapHours(e.start, e.end, range.start, range.end);
      if (h <= 0) continue;
      (agg[e.uid] ||= {});
      agg[e.uid][key] = (agg[e.uid][key] || 0) + h;
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
        const dealTitle = did === "__break__" ? "休憩" : did === "__mtg__" ? "MTG実施" : (dealsById[did]?.title || "（案件不明）");
        items.push({
          uid,
          name: employeesByUid[uid]?.name || "(不明)",
          dealId: did,
          dealTitle,
          hours: perDeal[did] || 0,
          rowSpan: idx === 0 ? dealIds.length : 0,
          totalHours: total,
        });
      });
    }

    return items;
  }, [selectedUids, selectedDealIds, dealsById, employeesByUid, activeUids, entries, range.end, range.start, isOwner, visibleUids]);

  // 顧客別集計行
  const customerRows = useMemo(() => {
    const agg: Record<string, Record<string, number>> = {};
    for (const e of entries) {
      if (!e.uid) continue;
      const isBreak = !e.dealId && !e.mtgConfirmed && !e.customerId;
      const isMtg = !!e.mtgConfirmed;
      const key = e.dealId || (isMtg ? "__mtg__" : isBreak ? "__break__" : null);
      if (!key) continue;
      if (!isOwner && visibleUids.size > 0 && !visibleUids.has(e.uid)) continue;
      if (selectedUids.length > 0 && !selectedUids.includes(e.uid)) continue;
      if (selectedDealIds.length > 0 && e.dealId && !selectedDealIds.includes(e.dealId)) continue;

      const deal = e.dealId ? dealsById[e.dealId] : null;
      const custId = deal?.customerId || e.customerId || "__none__";
      const h = overlapHours(e.start, e.end, range.start, range.end);
      if (h <= 0) continue;
      (agg[custId] ||= {});
      agg[custId][key] = (agg[custId][key] || 0) + h;
    }

    const items: Array<{
      customerId: string;
      customerName: string;
      dealId: string;
      dealTitle: string;
      hours: number;
      rowSpan: number;
      totalHours: number;
    }> = [];

    const custIds = Object.keys(agg).sort((a, b) => {
      const an = a === "__none__" ? "zzz" : (customersById[a]?.name || "zzz").toLowerCase();
      const bn = b === "__none__" ? "zzz" : (customersById[b]?.name || "zzz").toLowerCase();
      return an.localeCompare(bn);
    });

    for (const custId of custIds) {
      const perDeal = agg[custId] || {};
      const dealIds = Object.keys(perDeal).sort((a, b) => (perDeal[b] || 0) - (perDeal[a] || 0));
      const total = dealIds.reduce((s, id) => s + (perDeal[id] || 0), 0);
      if (dealIds.length === 0) continue;
      dealIds.forEach((did, idx) => {
        const dealTitle = did === "__break__" ? "休憩" : did === "__mtg__" ? "MTG実施" : (dealsById[did]?.title || "（案件不明）");
        items.push({
          customerId: custId,
          customerName: custId === "__none__" ? "（顧客未設定）" : (customersById[custId]?.name || "（不明）"),
          dealId: did,
          dealTitle,
          hours: perDeal[did] || 0,
          rowSpan: idx === 0 ? dealIds.length : 0,
          totalHours: total,
        });
      });
    }

    return items;
  }, [selectedUids, selectedDealIds, dealsById, customersById, entries, range.end, range.start, isOwner, visibleUids]);

  const grandTotal = useMemo(() => rows.reduce((s, r) => s + (r.hours || 0), 0), [rows]);
  const customerGrandTotal = useMemo(() => customerRows.reduce((s, r) => s + (r.hours || 0), 0), [customerRows]);

  // 円グラフ用データ: 担当者別の工数集計
  const chartData = useMemo(() => {
    const byPerson: Record<string, { name: string; hours: number; color: string }> = {};
    for (const r of rows) {
      if (!byPerson[r.uid]) {
        const emp = employeesByUid[r.uid];
        const color = emp?.color || (r.uid === user?.uid ? "#F97316" : "#94A3B8");
        byPerson[r.uid] = { name: r.name, hours: 0, color };
      }
      byPerson[r.uid].hours += r.hours;
    }
    return Object.values(byPerson).sort((a, b) => b.hours - a.hours);
  }, [rows, employeesByUid, user?.uid]);

  // 円グラフ用データ: 顧客別の工数集計
  const CUST_COLORS = ["#F97316", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#06B6D4", "#F59E0B", "#EC4899", "#14B8A6", "#6366F1"];
  const customerChartData = useMemo(() => {
    const byCust: Record<string, { name: string; hours: number; color: string }> = {};
    let ci = 0;
    for (const r of customerRows) {
      if (!byCust[r.customerId]) {
        byCust[r.customerId] = { name: r.customerName, hours: 0, color: CUST_COLORS[ci % CUST_COLORS.length] };
        ci++;
      }
      byCust[r.customerId].hours += r.hours;
    }
    return Object.values(byCust).sort((a, b) => b.hours - a.hours);
  }, [customerRows]);

  const toggleUid = (uid: string) => {
    setSelectedUids(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const toggleDeal = (id: string) => {
    setSelectedDealIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const filteredDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter(d => (d.title || "").toLowerCase().includes(q));
  }, [deals, dealSearch]);

  // 担当者リスト（自分 + 稼働中社員）を取得 — 権限でフィルタ
  const assigneeList = useMemo(() => {
    const list: { uid: string; name: string; color?: string }[] = [];
    if (user) {
      const myName = profile?.displayName || user.email?.split("@")[0] || "ユーザー";
      list.push({ uid: user.uid, name: myName, color: "#F97316" });
    }
    const activeEmps = employees.filter((e) => e.isActive !== false);
    for (const emp of activeEmps) {
      if (emp.authUid && emp.authUid !== user?.uid) {
        // 権限によるフィルタ
        if (!isOwner && visibleUids.size > 0 && !visibleUids.has(emp.authUid)) continue;
        list.push({ uid: emp.authUid, name: emp.name, color: emp.color });
      }
    }
    return list;
  }, [user, employees, profile?.displayName, isOwner, visibleUids]);

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

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 border-r border-slate-200 pr-4">
                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none mb-0.5">合計工数</div>
                  <div className="text-sm font-black text-slate-900 tabular-nums leading-none">
                    {hoursLabel(viewMode === "customer" ? customerGrandTotal : grandTotal)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none mb-0.5">
                    {viewMode === "customer" ? "対象顧客" : "対象人数"}
                  </div>
                  <div className="text-sm font-black text-slate-900 tabular-nums leading-none">
                    {viewMode === "customer"
                      ? new Set(customerRows.map(r => r.customerId)).size
                      : new Set(rows.map(r => r.uid)).size}
                    <span className="text-[10px] font-bold text-slate-400 ml-0.5">
                      {viewMode === "customer" ? "社" : "名"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
                {([
                  { key: "person" as const, label: "担当者別" },
                  { key: "customer" as const, label: "顧客別" },
                  { key: "chart" as const, label: "グラフ" },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setViewMode(tab.key)}
                    className={clsx(
                      "px-3 py-1.5 text-xs font-extrabold rounded-md transition-all",
                      viewMode === tab.key
                        ? "bg-orange-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-white hover:shadow-sm",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                印刷
              </button>
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

              <div className="relative" ref={dealDropdownRef}>
                <button
                  onClick={() => { setDealDropdownOpen((v) => !v); setDealSearch(""); }}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-xs font-extrabold transition flex items-center gap-1.5",
                    selectedDealIds.length > 0
                      ? "bg-orange-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  案件別
                  {selectedDealIds.length > 0 && (
                    <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{selectedDealIds.length}</span>
                  )}
                </button>

                {dealDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="p-2 border-b border-slate-100">
                      <input
                        type="text"
                        value={dealSearch}
                        onChange={(e) => setDealSearch(e.target.value)}
                        placeholder="案件を検索..."
                        autoFocus
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto p-1">
                      {filteredDeals.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">該当なし</div>
                      ) : (
                        filteredDeals.map((d) => (
                          <label
                            key={d.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedDealIds.includes(d.id)}
                              onChange={() => toggleDeal(d.id)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                            />
                            <span className="text-xs font-bold text-slate-700 truncate">{d.title || "（無題）"}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {selectedDealIds.length > 0 && (
                      <div className="p-2 border-t border-slate-100">
                        <button
                          onClick={() => {
                            setSelectedDealIds([]);
                            setDealDropdownOpen(false);
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
        </div>

        {/* 担当者別テーブル */}
        {viewMode === "person" && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50/50 text-[11px] font-black uppercase tracking-widest text-slate-500">
                    <th className="border-b border-slate-200 px-1 py-2.5 text-center w-10">担当者</th>
                    <th className="border-b border-slate-200 px-4 py-2.5">案件</th>
                    <th className="border-b border-slate-200 px-4 py-2.5 text-right">工数</th>
                    <th className="border-b border-slate-200 px-1 py-2.5 text-center w-14">合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center">
                        <div className="text-sm font-bold text-slate-400">対象期間の工数データが見つかりません</div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, idx) => (
                      <tr key={`${r.uid}_${r.dealId}_${idx}`} className="group hover:bg-slate-50/50 transition-colors">
                        {r.rowSpan > 0 ? (
                          <td
                            className={clsx(
                              "px-1 py-2 align-middle border-r border-slate-100 w-10",
                              idx !== 0 && "border-t border-slate-200"
                            )}
                            rowSpan={r.rowSpan}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-[10px] font-black text-orange-600 flex-shrink-0">
                                {r.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="text-[10px] font-black text-slate-900 leading-none" style={{ writingMode: "vertical-rl" }}>
                                {r.name}
                              </div>
                            </div>
                          </td>
                        ) : null}
                        <td className="px-4 py-2">
                          <div className="text-xs font-bold text-slate-800 group-hover:text-orange-600 transition-colors truncate max-w-[260px]">
                            {r.dealTitle}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-700 tabular-nums">
                            {hoursLabel(r.hours)}
                          </span>
                        </td>
                        {r.rowSpan > 0 ? (
                          <td
                            className={clsx(
                              "px-1 py-2 text-center align-middle border-l border-slate-100 w-14",
                              idx !== 0 && "border-t border-slate-200"
                            )}
                            rowSpan={r.rowSpan}
                          >
                            <div className="text-xs font-black text-slate-900 tabular-nums">
                              {hoursLabel(r.totalHours)}
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
        )}

        {/* 顧客別テーブル */}
        {viewMode === "customer" && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50/50 text-[11px] font-black uppercase tracking-widest text-slate-500">
                    <th className="border-b border-slate-200 px-4 py-2.5">顧客</th>
                    <th className="border-b border-slate-200 px-4 py-2.5">案件</th>
                    <th className="border-b border-slate-200 px-4 py-2.5 text-right">工数</th>
                    <th className="border-b border-slate-200 px-4 py-2.5 text-center w-20">顧客合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customerRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center">
                        <div className="text-sm font-bold text-slate-400">対象期間の工数データが見つかりません</div>
                      </td>
                    </tr>
                  ) : (
                    customerRows.map((r, idx) => (
                      <tr key={`${r.customerId}_${r.dealId}_${idx}`} className="group hover:bg-slate-50/50 transition-colors">
                        {r.rowSpan > 0 ? (
                          <td
                            className={clsx(
                              "px-4 py-2 align-middle border-r border-slate-100",
                              idx !== 0 && "border-t border-slate-200"
                            )}
                            rowSpan={r.rowSpan}
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-[10px] font-black text-blue-600 flex-shrink-0">
                                {r.customerName.charAt(0)}
                              </div>
                              <div className="text-xs font-black text-slate-900 leading-tight truncate max-w-[180px]">{r.customerName}</div>
                            </div>
                          </td>
                        ) : null}
                        <td className="px-4 py-2">
                          <div className="text-xs font-bold text-slate-800 group-hover:text-orange-600 transition-colors truncate max-w-[260px]">
                            {r.dealTitle}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-700 tabular-nums">
                            {hoursLabel(r.hours)}
                          </span>
                        </td>
                        {r.rowSpan > 0 ? (
                          <td
                            className={clsx(
                              "px-2 py-2 text-center align-middle border-l border-slate-100",
                              idx !== 0 && "border-t border-slate-200"
                            )}
                            rowSpan={r.rowSpan}
                          >
                            <div className="text-sm font-black text-slate-900 tabular-nums">
                              {hoursLabel(r.totalHours)}
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
        )}

        {/* 円グラフ: 担当者別 + 顧客別 */}
        {viewMode === "chart" && (
          <div className="space-y-6">
            {/* 担当者別グラフ */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
              <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">担当者別</div>
              {chartData.length === 0 ? (
                <div className="text-sm font-bold text-slate-400 text-center py-10">対象期間の工数データが見つかりません</div>
              ) : (
                <div className="flex flex-col lg:flex-row items-center justify-center gap-8">
                  <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-56 h-56 lg:w-72 lg:h-72">
                    {(() => {
                      const total = chartData.reduce((s, d) => s + d.hours, 0);
                      if (total <= 0) return null;
                      let cumAngle = -Math.PI / 2;
                      return chartData.map((d, i) => {
                        const angle = (d.hours / total) * 2 * Math.PI;
                        const startAngle = cumAngle;
                        cumAngle += angle;
                        const endAngle = cumAngle;
                        const x1 = Math.cos(startAngle);
                        const y1 = Math.sin(startAngle);
                        const x2 = Math.cos(endAngle);
                        const y2 = Math.sin(endAngle);
                        const large = angle > Math.PI ? 1 : 0;
                        if (chartData.length === 1) {
                          return <circle key={i} cx={0} cy={0} r={1} fill={d.color} />;
                        }
                        const path = `M 0 0 L ${x1} ${y1} A 1 1 0 ${large} 1 ${x2} ${y2} Z`;
                        return <path key={i} d={path} fill={d.color} stroke="white" strokeWidth={0.02} />;
                      });
                    })()}
                    <circle cx={0} cy={0} r={0.5} fill="white" />
                    <text x={0} y={-0.05} textAnchor="middle" className="text-[0.12px] font-black fill-slate-900">{hoursLabel(grandTotal)}</text>
                    <text x={0} y={0.12} textAnchor="middle" className="text-[0.08px] font-bold fill-slate-400">合計</text>
                  </svg>
                  <div className="space-y-2 min-w-[200px]">
                    {chartData.map((d, i) => {
                      const pct = grandTotal > 0 ? ((d.hours / grandTotal) * 100).toFixed(1) : "0.0";
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-black text-slate-900 truncate">{d.name}</div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-black text-slate-900 tabular-nums">{hoursLabel(d.hours)}</div>
                            <div className="text-[10px] font-bold text-slate-400 tabular-nums">{pct}%</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 顧客別グラフ */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
              <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">顧客別</div>
              {customerChartData.length === 0 ? (
                <div className="text-sm font-bold text-slate-400 text-center py-10">対象期間の工数データが見つかりません</div>
              ) : (
                <div className="flex flex-col lg:flex-row items-center justify-center gap-8">
                  <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-56 h-56 lg:w-72 lg:h-72">
                    {(() => {
                      const total = customerChartData.reduce((s, d) => s + d.hours, 0);
                      if (total <= 0) return null;
                      let cumAngle = -Math.PI / 2;
                      return customerChartData.map((d, i) => {
                        const angle = (d.hours / total) * 2 * Math.PI;
                        const startAngle = cumAngle;
                        cumAngle += angle;
                        const endAngle = cumAngle;
                        const x1 = Math.cos(startAngle);
                        const y1 = Math.sin(startAngle);
                        const x2 = Math.cos(endAngle);
                        const y2 = Math.sin(endAngle);
                        const large = angle > Math.PI ? 1 : 0;
                        if (customerChartData.length === 1) {
                          return <circle key={i} cx={0} cy={0} r={1} fill={d.color} />;
                        }
                        const path = `M 0 0 L ${x1} ${y1} A 1 1 0 ${large} 1 ${x2} ${y2} Z`;
                        return <path key={i} d={path} fill={d.color} stroke="white" strokeWidth={0.02} />;
                      });
                    })()}
                    <circle cx={0} cy={0} r={0.5} fill="white" />
                    <text x={0} y={-0.05} textAnchor="middle" className="text-[0.12px] font-black fill-slate-900">{hoursLabel(customerGrandTotal)}</text>
                    <text x={0} y={0.12} textAnchor="middle" className="text-[0.08px] font-bold fill-slate-400">合計</text>
                  </svg>
                  <div className="space-y-2 min-w-[200px]">
                    {customerChartData.map((d, i) => {
                      const pct = customerGrandTotal > 0 ? ((d.hours / customerGrandTotal) * 100).toFixed(1) : "0.0";
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-black text-slate-900 truncate">{d.name}</div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-black text-slate-900 tabular-nums">{hoursLabel(d.hours)}</div>
                            <div className="text-[10px] font-bold text-slate-400 tabular-nums">{pct}%</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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

