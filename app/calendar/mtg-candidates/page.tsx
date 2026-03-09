"use client";

import { useState, useEffect, useMemo } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { useRouter } from "next/navigation";
import { AppShell } from "../../AppShell";

/* ── 型定義 ── */

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  companyCode: string;
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
  color?: string | null;
  repeat?: RepeatRule | null;
  guestUids?: string[];
  baseId?: string;
  isOccurrence?: boolean;
  mtgConfirmed?: boolean;
  mtgCandidate?: boolean;
  shift?: boolean;
};

type RepeatRule = {
  freq: "WEEKLY";
  interval: number;
  byWeekday: number[];
  end?: { type: "NONE" } | { type: "UNTIL"; until: string } | { type: "COUNT"; count: number };
  exdates?: string[];
};

type Employee = {
  id: string;
  name: string;
  uid?: string;
  authUid?: string;
  color?: string;
  companyCode?: string;
};

/* ── ユーティリティ ── */

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
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
  let weekStartDate = startOfWeek(baseStart);
  const baseMs = baseStart.getTime();
  while (seen < count) {
    for (const wd of by) {
      const date = new Date(weekStartDate);
      date.setDate(weekStartDate.getDate() + wd);
      const occ = combineDateAndTime(toDateKey(date), baseStart);
      if (occ.getTime() < baseMs) continue;
      seen += 1;
      if (seen >= count) return toDateKey(date);
    }
    weekStartDate = new Date(weekStartDate.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
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
      const t = baseStart.getTime();
      if (!Number.isNaN(t) && t >= rangeStartMs && t <= rangeEndMs) out.push(e);
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
    const baseWeek = startOfWeek(baseStart).getTime();
    let week = startOfWeek(new Date(effectiveStartMs)).getTime();
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

// 日本の祝日判定
function getJapaneseHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const add = (m: number, d: number, name: string) => {
    holidays.set(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, name);
  };
  const vernalEquinox = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumnalEquinox = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const nthMonday = (m: number, n: number) => {
    const first = new Date(year, m - 1, 1).getDay();
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  };
  add(1, 1, "元日"); add(1, nthMonday(1, 2), "成人の日"); add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日"); add(3, vernalEquinox, "春分の日"); add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日"); add(5, 4, "みどりの日"); add(5, 5, "こどもの日");
  add(7, nthMonday(7, 3), "海の日"); add(8, 11, "山の日"); add(9, nthMonday(9, 3), "敬老の日");
  add(9, autumnalEquinox, "秋分の日"); add(10, nthMonday(10, 2), "スポーツの日");
  add(11, 3, "文化の日"); add(11, 23, "勤労感謝の日");
  for (const [key, name] of [...holidays]) {
    const d = new Date(key + "T00:00:00");
    if (d.getDay() === 0) {
      let next = new Date(d);
      next.setDate(next.getDate() + 1);
      let nextKey = next.toISOString().slice(0, 10);
      while (holidays.has(nextKey)) { next.setDate(next.getDate() + 1); nextKey = next.toISOString().slice(0, 10); }
      holidays.set(nextKey, name + "（振替休日）");
    }
  }
  const sorted = [...holidays.keys()].sort();
  for (let i = 0; i < sorted.length - 1; i++) {
    const d1 = new Date(sorted[i] + "T00:00:00");
    const d2 = new Date(sorted[i + 1] + "T00:00:00");
    if ((d2.getTime() - d1.getTime()) / 86400000 === 2) {
      const mid = new Date(d1); mid.setDate(mid.getDate() + 1);
      const midKey = mid.toISOString().slice(0, 10);
      if (!holidays.has(midKey) && mid.getDay() !== 0) holidays.set(midKey, "国民の休日");
    }
  }
  return holidays;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatSlot(slot: Date, durationMinutes: number) {
  const end = new Date(slot.getTime() + durationMinutes * 60 * 1000);
  const m = slot.getMonth() + 1;
  const d = slot.getDate();
  const wd = WEEKDAYS[slot.getDay()];
  const sh = String(slot.getHours()).padStart(2, "0");
  const sm = String(slot.getMinutes()).padStart(2, "0");
  const eh = String(end.getHours()).padStart(2, "0");
  const em = String(end.getMinutes()).padStart(2, "0");
  return `${m}月${d}日(${wd}) ${sh}:${sm}～${eh}:${em}`;
}

/* ── タブ定義 ── */
type Tab = "register" | "delete" | "confirm";

/* ── コンポーネント ── */

export default function MtgCandidatesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("register");

  // ── 登録 ──
  const [regStartDate, setRegStartDate] = useState(() => toDateKey(getTomorrow()));
  const [regEndDate, setRegEndDate] = useState(() => {
    const now = new Date();
    return toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  });
  const [regIncludeWeekends, setRegIncludeWeekends] = useState(false);
  const [regExcludedDates, setRegExcludedDates] = useState("");
  const [regDuration, setRegDuration] = useState(30);
  const [regTitle, setRegTitle] = useState("");
  const [regStartHour, setRegStartHour] = useState(10);
  const [regEndHour, setRegEndHour] = useState(17);
  const [regProcessing, setRegProcessing] = useState(false);
  const [regResult, setRegResult] = useState<string[] | null>(null);
  const [regSelectedUids, setRegSelectedUids] = useState<Set<string>>(new Set());

  // ── 削除 ──
  const [delStartDate, setDelStartDate] = useState(() => toDateKey(getTomorrow()));
  const [delEndDate, setDelEndDate] = useState(() => {
    const now = new Date();
    return toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  });
  const [delKeyword, setDelKeyword] = useState("");
  const [delProcessing, setDelProcessing] = useState(false);
  const [delResult, setDelResult] = useState<{ count: number; titles: string[] } | null>(null);
  const [delPreview, setDelPreview] = useState<TimeEntry[] | null>(null);

  // ── 確定 ──
  const [confStartDate, setConfStartDate] = useState(() => toDateKey(getTomorrow()));
  const [confEndDate, setConfEndDate] = useState(() => {
    const now = new Date();
    return toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  });
  const [confDate, setConfDate] = useState("");
  const [confCompanyName, setConfCompanyName] = useState("");
  const [confProcessing, setConfProcessing] = useState(false);
  const [confResult, setConfResult] = useState<string | null>(null);
  const [confPreview, setConfPreview] = useState<TimeEntry[] | null>(null);
  const [confSelectedId, setConfSelectedId] = useState("");

  /* ── Auth & データ読み込み ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/login"); return; }
      setUser(u);

      const profileSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profileSnap.exists()) { router.push("/login"); return; }
      const p = profileSnap.data() as MemberProfile;
      setProfile(p);

      const code = (p.companyCode || "").trim();
      if (!code) { setLoading(false); return; }

      // 社員一覧
      const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", code)));
      const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
      if (!emps.some((e) => e.authUid === u.uid)) {
        emps.push({ id: "__me__", name: p.displayName || u.email?.split("@")[0] || "ユーザー", authUid: u.uid });
      }
      setEmployees(emps);
      setRegSelectedUids(new Set([u.uid]));

      // 全timeEntries読み込み（会社全体）
      const snap = await getDocs(query(collection(db, "timeEntries"), where("companyCode", "==", code)));
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeEntry));
      setAllEntries(entries);

      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const reloadEntries = async () => {
    if (!profile?.companyCode) return;
    const snap = await getDocs(query(collection(db, "timeEntries"), where("companyCode", "==", profile.companyCode)));
    setAllEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeEntry)));
  };

  /* ── 候補登録ロジック ── */
  const handleRegister = async () => {
    if (!user || !profile) return;
    if (!regTitle.trim()) { alert("予約タイトルを入力してください"); return; }
    setRegProcessing(true);
    setRegResult(null);

    try {
      const startDate = new Date(`${regStartDate}T00:00:00`);
      const endDate = new Date(`${regEndDate}T23:59:59`);
      const durationMs = regDuration * 60 * 1000;
      const companyCode = (profile.companyCode || "").trim();

      // 除外日リスト
      const excludedDates = new Set(
        regExcludedDates.split(",").map((s) => s.trim()).filter(Boolean)
      );

      // 選択されたユーザー全員の予定を展開
      const targetUids = regSelectedUids.size > 0 ? regSelectedUids : new Set([user.uid]);
      const expanded = expandRecurringEntries(
        allEntries.filter((e) => {
          if (targetUids.has(e.uid)) return true;
          if (e.guestUids?.some((g) => targetUids.has(g))) return true;
          return false;
        }),
        startDate,
        endDate,
      );

      // 祝日
      const years = new Set<number>();
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) years.add(d.getFullYear());
      const allHolidays = new Map<string, string>();
      for (const y of years) {
        for (const [k, v] of getJapaneseHolidays(y)) allHolidays.set(k, v);
      }

      // 空きスロット検索
      const availableSlots: Date[] = [];
      const current = new Date(startDate);
      current.setHours(0, 0, 0, 0);

      while (current <= endDate) {
        const dayOfWeek = current.getDay();
        const dateKey = toDateKey(current);

        if (!regIncludeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
          current.setDate(current.getDate() + 1);
          continue;
        }
        if (!regIncludeWeekends && allHolidays.has(dateKey)) {
          current.setDate(current.getDate() + 1);
          continue;
        }
        if (excludedDates.has(dateKey)) {
          current.setDate(current.getDate() + 1);
          continue;
        }

        const dayStart = new Date(current);
        dayStart.setHours(regStartHour, 0, 0, 0);
        const dayEnd = new Date(current);
        dayEnd.setHours(regEndHour, 0, 0, 0);

        let slotStart = new Date(dayStart);
        while (slotStart.getTime() + durationMs <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + durationMs);
          const hasConflict = expanded.some((e) => {
            const eStart = new Date(e.start).getTime();
            const eEnd = new Date(e.end).getTime();
            return slotStart.getTime() < eEnd && slotEnd.getTime() > eStart;
          });
          if (!hasConflict) {
            availableSlots.push(new Date(slotStart));
          }
          slotStart = new Date(slotStart.getTime() + durationMs);
        }
        current.setDate(current.getDate() + 1);
      }

      // 異なる日で3候補選択
      const selectedSlots: Date[] = [];
      const usedDates = new Set<string>();
      for (const slot of availableSlots) {
        const dateStr = toDateKey(slot);
        if (!usedDates.has(dateStr)) {
          selectedSlots.push(slot);
          usedDates.add(dateStr);
        }
        if (selectedSlots.length >= 3) break;
      }

      if (selectedSlots.length === 0) {
        alert("空きスロットが見つかりませんでした。期間を広げるか条件を変更してください。");
        setRegProcessing(false);
        return;
      }
      if (selectedSlots.length < 3) {
        const proceed = confirm(`異なる日で3つの候補が見つかりませんでした（${selectedSlots.length}つ見つかりました）。\nこのまま登録しますか？`);
        if (!proceed) { setRegProcessing(false); return; }
      }

      // Firestoreに仮予約を作成
      const bookedTimes: string[] = [];
      for (const slot of selectedSlots) {
        const slotEnd = new Date(slot.getTime() + durationMs);
        await addDoc(collection(db, "timeEntries"), {
          uid: user.uid,
          companyCode,
          customerId: null,
          dealId: null,
          project: regTitle.trim(),
          summary: regTitle.trim(),
          color: "#6366f1",
          start: slot.toISOString(),
          end: slotEnd.toISOString(),
          repeat: null,
          guestUids: [],
          mtgCandidate: true,
        });
        bookedTimes.push(formatSlot(slot, regDuration));
      }

      setRegResult(bookedTimes);
      await reloadEntries();
    } catch (err) {
      console.error("MTG候補登録エラー:", err);
      alert("MTG候補の登録中にエラーが発生しました。");
    } finally {
      setRegProcessing(false);
    }
  };

  /* ── 候補削除ロジック ── */
  const handleDeletePreview = () => {
    if (!delKeyword.trim()) { alert("削除キーワードを入力してください"); return; }

    const startDate = new Date(`${delStartDate}T00:00:00`);
    const endDate = new Date(`${delEndDate}T23:59:59`);
    const keyword = delKeyword.trim();

    const matched = allEntries.filter((e) => {
      if (e.mtgConfirmed) return false; // MTG確定済みは削除対象外
      const eStart = new Date(e.start);
      if (eStart < startDate || eStart > endDate) return false;
      const title = (e.project || "") + " " + (e.summary || "");
      return title.includes(keyword);
    });

    matched.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    setDelPreview(matched);
    setDelResult(null);
  };

  const handleDeleteExecute = async () => {
    if (!delPreview || delPreview.length === 0) return;
    if (!confirm(`${delPreview.length}件の予定を削除します。よろしいですか？`)) return;

    setDelProcessing(true);
    setDelResult(null);

    try {
      const titles: string[] = [];
      for (const entry of delPreview) {
        await deleteDoc(doc(db, "timeEntries", entry.id));
        const s = new Date(entry.start);
        titles.push(`${formatSlot(s, Math.round((new Date(entry.end).getTime() - s.getTime()) / 60000))} ${entry.project}`);
      }
      setDelResult({ count: delPreview.length, titles });
      setDelPreview(null);
      await reloadEntries();
    } catch (err) {
      console.error("削除エラー:", err);
      alert("削除中にエラーが発生しました。");
    } finally {
      setDelProcessing(false);
    }
  };

  /* ── 候補確定ロジック ── */
  const handleConfirmPreview = () => {
    if (!confCompanyName.trim()) {
      alert("商談社名を入力してから検索してください");
      return;
    }
    const startDate = new Date(`${confStartDate}T00:00:00`);
    const endDate = new Date(`${confEndDate}T23:59:59`);
    const keyword = confCompanyName.trim().toLowerCase();

    const matched = allEntries.filter((e) => {
      if (!e.mtgCandidate) return false;
      if (e.mtgConfirmed) return false;
      const title = (e.project || e.summary || "").toLowerCase();
      if (!title.includes(keyword)) return false;
      const eStart = new Date(e.start);
      return eStart >= startDate && eStart <= endDate;
    });

    matched.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    setConfPreview(matched);
    setConfResult(null);
    setConfSelectedId("");
  };

  const handleConfirmExecute = async () => {
    if (!confSelectedId || !confCompanyName.trim()) {
      alert("確定する予定を選択し、商談社名を入力してください");
      return;
    }

    setConfProcessing(true);
    setConfResult(null);

    try {
      const entry = allEntries.find((e) => e.id === confSelectedId);
      if (!entry) { alert("選択された予定が見つかりません"); setConfProcessing(false); return; }

      // 選択された予定のタイトルを「確定」に更新
      const confirmedTitle = `${confCompanyName.trim()} 商談確定`;
      await updateDoc(doc(db, "timeEntries", confSelectedId), {
        project: confirmedTitle,
        summary: confirmedTitle,
        color: "#10b981",
        mtgConfirmed: true,
        mtgCandidate: false,
      });

      // 同じproject(タイトル)の他のMTG候補を削除
      const originalTitle = entry.project || entry.summary;
      const othersToDelete = allEntries.filter((e) =>
        e.id !== confSelectedId &&
        e.mtgCandidate &&
        !e.mtgConfirmed &&
        (e.project === originalTitle || e.summary === originalTitle)
      );

      for (const other of othersToDelete) {
        await deleteDoc(doc(db, "timeEntries", other.id));
      }

      const s = new Date(entry.start);
      const dur = Math.round((new Date(entry.end).getTime() - s.getTime()) / 60000);
      setConfResult(
        `${formatSlot(s, dur)} を「${confirmedTitle}」として確定しました。` +
        (othersToDelete.length > 0 ? `\n他${othersToDelete.length}件の候補を削除しました。` : "")
      );
      setConfPreview(null);
      await reloadEntries();
    } catch (err) {
      console.error("確定エラー:", err);
      alert("確定処理中にエラーが発生しました。");
    } finally {
      setConfProcessing(false);
    }
  };

  /* ── 描画 ── */

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "register", label: "候補の登録", icon: "+" },
    { key: "delete", label: "候補の削除", icon: "×" },
    { key: "confirm", label: "候補の確定", icon: "✓" },
  ];

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all";
  const labelClass = "text-xs font-extrabold text-slate-500";

  return (
    <AppShell>
      <div className="flex h-full flex-col bg-slate-50">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h1 className="text-base font-extrabold text-slate-900">MTG候補日管理</h1>
            <p className="mt-0.5 text-[11px] font-bold text-slate-400">
              カレンダーの空き時間から候補日を自動登録・管理
            </p>
          </div>
          <button
            onClick={() => router.push("/calendar")}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
          >
            カレンダーに戻る
          </button>
        </div>

        {/* タブ */}
        <div className="flex border-b border-slate-200 bg-white px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                "flex items-center gap-1.5 border-b-2 px-5 py-3 text-sm font-extrabold transition-all",
                activeTab === tab.key
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              <span className="text-base">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-2xl">

            {/* ── 候補の登録 ── */}
            {activeTab === "register" && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-extrabold text-slate-800">日程候補の登録</h2>
                <p className="mt-1 text-[11px] font-bold text-slate-400">
                  指定期間の空き時間から異なる日で3つの候補を自動で選び、カレンダーに仮予約します。
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4">
                  {/* 対象メンバー選択 */}
                  <div>
                    <label className={labelClass}>対象メンバー（全員の空き時間を考慮）</label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {employees.filter((emp) => emp.authUid).map((emp) => {
                        const uid = emp.authUid!;
                        const checked = regSelectedUids.has(uid);
                        return (
                          <label
                            key={emp.id}
                            className={clsx(
                              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-extrabold cursor-pointer transition-all",
                              checked
                                ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setRegSelectedUids((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(uid)) next.delete(uid);
                                  else next.add(uid);
                                  return next;
                                });
                              }}
                              className="h-3 w-3 rounded border-slate-300 text-indigo-600"
                            />
                            {emp.name}{uid === user?.uid ? "（自分）" : ""}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        const tomorrow = getTomorrow();
                        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                        setRegStartDate(toDateKey(tomorrow));
                        setRegEndDate(toDateKey(end));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      今月
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        const tomorrow = getTomorrow();
                        const monthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                        const start = tomorrow > monthStart ? tomorrow : monthStart;
                        const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                        setRegStartDate(toDateKey(start));
                        setRegEndDate(toDateKey(end));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      来月
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <label className={labelClass}>開始日</label>
                        <button
                          type="button"
                          onClick={() => {
                            const d = new Date();
                            d.setDate(d.getDate() + 2);
                            setRegStartDate(toDateKey(d));
                          }}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all"
                        >
                          明後日
                        </button>
                      </div>
                      <input type="date" value={regStartDate} onChange={(e) => setRegStartDate(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>終了日</label>
                      <input type="date" value={regEndDate} onChange={(e) => setRegEndDate(e.target.value)} className={inputClass} />
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regIncludeWeekends}
                      onChange={(e) => setRegIncludeWeekends(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span className="text-xs font-extrabold text-slate-600">土日祝を含める</span>
                  </label>

                  <div>
                    <label className={labelClass}>除外日（カンマ区切り、例: 2026-03-15,2026-03-20）</label>
                    <input
                      type="text"
                      value={regExcludedDates}
                      onChange={(e) => setRegExcludedDates(e.target.value)}
                      placeholder="2026-03-15,2026-03-20"
                      className={inputClass}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass}>予約時間（分）</label>
                      <select value={regDuration} onChange={(e) => setRegDuration(Number(e.target.value))} className={inputClass}>
                        <option value={15}>15分</option>
                        <option value={30}>30分</option>
                        <option value={45}>45分</option>
                        <option value={60}>60分</option>
                        <option value={90}>90分</option>
                        <option value={120}>120分</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>何時から</label>
                      <select value={regStartHour} onChange={(e) => setRegStartHour(Number(e.target.value))} className={inputClass}>
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i}時</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>何時まで</label>
                      <select value={regEndHour} onChange={(e) => setRegEndHour(Number(e.target.value))} className={inputClass}>
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i}時</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>予約タイトル</label>
                    <input
                      type="text"
                      value={regTitle}
                      onChange={(e) => setRegTitle(e.target.value)}
                      placeholder="候補　CW　【継続案件】SEOディレクター募集！"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleRegister}
                      disabled={regProcessing || !regStartDate || !regEndDate || !regTitle.trim()}
                      className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-extrabold text-white hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-md"
                    >
                      {regProcessing && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                      候補を登録
                    </button>
                  </div>
                  {(regProcessing || !regStartDate || !regEndDate || !regTitle.trim()) && !regProcessing && (
                    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] font-bold text-amber-700 w-fit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {!regTitle.trim() ? "タイトルを入力してください" : !regStartDate ? "開始日を設定してください" : "終了日を設定してください"}
                    </div>
                  )}
                  {regProcessing && (
                    <div className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-bold text-blue-700 w-fit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      処理中です…
                    </div>
                  )}
                </div>

                {regResult && (
                  <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs font-extrabold text-emerald-800">仮予約が完了しました</div>
                    <ul className="mt-2 space-y-1">
                      {regResult.map((t, i) => (
                        <li key={i} className="text-sm font-bold text-emerald-700">{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── 候補の削除 ── */}
            {activeTab === "delete" && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-extrabold text-slate-800">候補の削除</h2>
                <p className="mt-1 text-[11px] font-bold text-slate-400">
                  指定期間内のキーワードに一致する予定を一括削除します。
                </p>
                <div className="mt-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700">
                  ※ カレンダーで「MTG確定」として登録された予定は削除対象から除外されます。
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        setDelStartDate(toDateKey(getTomorrow()));
                        setDelEndDate(toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      今月
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        const tomorrow = getTomorrow();
                        const monthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                        const start = tomorrow > monthStart ? tomorrow : monthStart;
                        setDelStartDate(toDateKey(start));
                        setDelEndDate(toDateKey(new Date(now.getFullYear(), now.getMonth() + 2, 0)));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      来月
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <label className={labelClass}>開始日</label>
                        <button
                          type="button"
                          onClick={() => {
                            const d = new Date();
                            d.setDate(d.getDate() + 2);
                            setDelStartDate(toDateKey(d));
                          }}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all"
                        >
                          明後日
                        </button>
                      </div>
                      <input type="date" value={delStartDate} onChange={(e) => setDelStartDate(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>終了日</label>
                      <input type="date" value={delEndDate} onChange={(e) => setDelEndDate(e.target.value)} className={inputClass} />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>削除キーワード</label>
                    <input
                      type="text"
                      value={delKeyword}
                      onChange={(e) => setDelKeyword(e.target.value)}
                      placeholder="SYNS"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDeletePreview}
                      disabled={!delKeyword.trim()}
                      className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-all"
                    >
                      検索
                    </button>
                    {delPreview && delPreview.length > 0 && (
                      <button
                        onClick={handleDeleteExecute}
                        disabled={delProcessing}
                        className="flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-rose-700 disabled:opacity-50 transition-all shadow-md"
                      >
                        {delProcessing && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                        {delPreview.length}件を削除
                      </button>
                    )}
                  </div>
                  {!delKeyword.trim() && (
                    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] font-bold text-amber-700 w-fit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      削除キーワードを入力してください
                    </div>
                  )}
                  {delProcessing && (
                    <div className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-bold text-blue-700 w-fit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      削除処理中です…
                    </div>
                  )}
                </div>

                {delPreview !== null && (
                  <div className="mt-5">
                    {delPreview.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                        該当する予定が見つかりませんでした。
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-extrabold text-slate-500">
                            <tr>
                              <th className="px-4 py-2">日時</th>
                              <th className="px-4 py-2">タイトル</th>
                            </tr>
                          </thead>
                          <tbody>
                            {delPreview.map((e) => {
                              const s = new Date(e.start);
                              const dur = Math.round((new Date(e.end).getTime() - s.getTime()) / 60000);
                              return (
                                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                                  <td className="px-4 py-2 text-xs font-bold text-slate-600 whitespace-nowrap">
                                    {formatSlot(s, dur)}
                                  </td>
                                  <td className="px-4 py-2 text-xs font-bold text-slate-800">
                                    {e.project || e.summary}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {delResult && (
                  <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs font-extrabold text-emerald-800">{delResult.count}件を削除しました</div>
                    <ul className="mt-2 space-y-0.5">
                      {delResult.titles.map((t, i) => (
                        <li key={i} className="text-[11px] font-bold text-emerald-700">{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── 候補の確定 ── */}
            {activeTab === "confirm" && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-extrabold text-slate-800">候補の確定</h2>
                <p className="mt-1 text-[11px] font-bold text-slate-400">
                  検索範囲から候補を選び、商談として確定します。同タイトルの他の候補は自動的に削除されます。
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        setConfStartDate(toDateKey(getTomorrow()));
                        setConfEndDate(toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      今月
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        const tomorrow = getTomorrow();
                        const monthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                        const start = tomorrow > monthStart ? tomorrow : monthStart;
                        setConfStartDate(toDateKey(start));
                        setConfEndDate(toDateKey(new Date(now.getFullYear(), now.getMonth() + 2, 0)));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      来月
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <label className={labelClass}>検索範囲 開始日</label>
                        <button
                          type="button"
                          onClick={() => {
                            const d = new Date();
                            d.setDate(d.getDate() + 2);
                            setConfStartDate(toDateKey(d));
                          }}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all"
                        >
                          明後日
                        </button>
                      </div>
                      <input type="date" value={confStartDate} onChange={(e) => setConfStartDate(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>検索範囲 終了日</label>
                      <input type="date" value={confEndDate} onChange={(e) => setConfEndDate(e.target.value)} className={inputClass} />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>商談社名（検索キーワード）</label>
                    <input
                      type="text"
                      value={confCompanyName}
                      onChange={(e) => setConfCompanyName(e.target.value)}
                      placeholder="検索する社名やキーワード"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleConfirmPreview}
                      className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-700 hover:bg-slate-50 transition-all"
                    >
                      候補を検索
                    </button>
                    {confSelectedId && (
                      <button
                        onClick={handleConfirmExecute}
                        disabled={confProcessing || !confCompanyName.trim()}
                        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-md"
                      >
                        {confProcessing && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                        確定する
                      </button>
                    )}
                  </div>
                  {confSelectedId && !confCompanyName.trim() && !confProcessing && (
                    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] font-bold text-amber-700 w-fit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      商談社名を入力してください
                    </div>
                  )}
                  {confProcessing && (
                    <div className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-bold text-blue-700 w-fit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      処理中です…
                    </div>
                  )}
                </div>

                {confPreview !== null && (
                  <div className="mt-5">
                    {confPreview.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                        該当する予定が見つかりませんでした。
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-extrabold text-slate-500">
                            <tr>
                              <th className="px-4 py-2 w-10"></th>
                              <th className="px-4 py-2">日時</th>
                              <th className="px-4 py-2">タイトル</th>
                            </tr>
                          </thead>
                          <tbody>
                            {confPreview.map((e) => {
                              const s = new Date(e.start);
                              const dur = Math.round((new Date(e.end).getTime() - s.getTime()) / 60000);
                              return (
                                <tr
                                  key={e.id}
                                  onClick={() => setConfSelectedId(e.id)}
                                  className={clsx(
                                    "border-t border-slate-100 cursor-pointer transition-all",
                                    confSelectedId === e.id
                                      ? "bg-indigo-50"
                                      : "hover:bg-slate-50"
                                  )}
                                >
                                  <td className="px-4 py-2 text-center">
                                    <input
                                      type="radio"
                                      checked={confSelectedId === e.id}
                                      onChange={() => setConfSelectedId(e.id)}
                                      className="h-4 w-4 text-indigo-600"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-xs font-bold text-slate-600 whitespace-nowrap">
                                    {formatSlot(s, dur)}
                                  </td>
                                  <td className="px-4 py-2 text-xs font-bold text-slate-800">
                                    {e.project || e.summary}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {confResult && (
                  <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-sm font-bold text-emerald-800 whitespace-pre-line">{confResult}</div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </AppShell>
  );
}
