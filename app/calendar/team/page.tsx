"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../../AppShell";
import { logActivity } from "../../../lib/activity";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  companyName?: string | null;
  email?: string | null;
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
  repeat?: RepeatRule | null;
  guestUids?: string[];
  // クライアント側で展開した「繰り返しの各回」用
  baseId?: string;
  isOccurrence?: boolean;
};

type Employee = {
  id: string;
  name: string;
  uid?: string;
  authUid?: string;
  color?: string; // カレンダー表示用の色
  companyCode?: string;
  companyName?: string;
};

type ViewMode = "day" | "week" | "month";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type RepeatRule = {
  freq: "WEEKLY";
  interval: number; // 1=毎週, 2=隔週
  byWeekday: number[]; // 0=日 ... 6=土
  end?: { type: "NONE" } | { type: "UNTIL"; until: string } | { type: "COUNT"; count: number };
  // 例外日（この日だけ除外）: YYYY-MM-DD
  exdates?: string[];
};

type Customer = {
  id: string;
  name: string;
  companyCode?: string;
};

type Deal = {
  id: string;
  title: string;
  customerId?: string | null;
  companyCode?: string;
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};

// 色コードから明るい色とボーダー色を生成
const getEmployeeColors = (baseColor: string) => {
  // デフォルトカラー (Orange)
  if (!baseColor) {
    return { base: "#f97316", light: "#ffedd5", border: "#ea580c" };
  }
  
  // 16進数カラーからRGBに変換
  const hex = baseColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // 明るい色（20%の不透明度）
  const light = `rgba(${r}, ${g}, ${b}, 0.2)`;
  
  // ボーダー色（80%の明るさ）
  const border = `rgb(${Math.floor(r * 0.8)}, ${Math.floor(g * 0.8)}, ${Math.floor(b * 0.8)})`;
  
  return { base: baseColor, light, border };
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
// 1時間あたりの縦幅（小さくして 8:00〜19:00 が1画面に収まりやすくする）
const HOUR_PX = 52;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function snapMinutes(mins: number, step = 15) {
  const s = Math.max(1, step);
  return Math.round(mins / s) * s;
}

function timeFromY(y: number) {
  const mins = (y / HOUR_PX) * 60;
  return clamp(snapMinutes(mins, 15), 0, 23 * 60 + 45);
}

function setTimeOnDateKey(dateKey: string, minutes: number) {
  const d = new Date(`${dateKey}T00:00:00`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  d.setHours(h, m, 0, 0);
  return d;
}

function lastOccurrenceDateKeyForCount(baseStart: Date, rule: RepeatRule) {
  const by = (rule.byWeekday?.length ? [...rule.byWeekday] : [baseStart.getDay()]).sort((a, b) => a - b);
  const interval = Math.max(1, rule.interval || 1);
  const count = rule.end && rule.end.type === "COUNT" ? Math.max(1, Math.floor(rule.end.count)) : 1;

  // count が小さい想定なので、baseStart から順に数える（上限: count * interval * 7）
  let seen = 0;
  let weekStart = startOfWeek(baseStart);
  const baseMs = baseStart.getTime();
  while (seen < count) {
    for (const wd of by) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + wd);
      const occ = combineDateAndTime(toDateKey(date), baseStart);
      if (occ.getTime() < baseMs) continue; // 初回より前は除外
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
    const effectiveStart = new Date(effectiveStartMs);

    const baseWeek = startOfWeek(baseStart).getTime();
    let week = startOfWeek(effectiveStart).getTime();
    if (week < baseWeek) week = baseWeek;

    // interval に合わせて week をアライン
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

export default function TeamCalendarPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [companyOwnerUid, setCompanyOwnerUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [miniCalendarDate, setMiniCalendarDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [showSidebar, setShowSidebar] = useState(true);
  const [now, setNow] = useState(new Date());
  const dayScrollRef = useRef<HTMLDivElement | null>(null);
  const weekScrollRef = useRef<HTMLDivElement | null>(null);
  const dayColsRef = useRef<HTMLDivElement | null>(null);
  const weekColsRef = useRef<HTMLDivElement | null>(null);

  const suppressNextClickRef = useRef(false);
  const dragRef = useRef<{
    entry: TimeEntry;
    mode: "day" | "week";
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    durationMins: number;
    offsetMins: number; // 追加: クリックした位置（分）
  } | null>(null);

  const [dragPreview, setDragPreview] = useState<{
    entryId: string;
    start: Date;
    end: Date;
    uid: string;
    color: string; // 追加
    dayIdx?: number; // week用
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [createOpen, setCreateOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [newCustomerId, setNewCustomerId] = useState<string>("");
  const [newDealId, setNewDealId] = useState<string>("");
  const [newProject, setNewProject] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newDate, setNewDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [newStartTime, setNewStartTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("10:00");

  const [newRepeatEnabled, setNewRepeatEnabled] = useState(false);
  const [newRepeatInterval, setNewRepeatInterval] = useState(1);
  const [newRepeatByWeekday, setNewRepeatByWeekday] = useState<number[]>([]);
  const [newRepeatEndType, setNewRepeatEndType] = useState<"NONE" | "UNTIL" | "COUNT">("NONE");
  const [newRepeatUntil, setNewRepeatUntil] = useState("");
  const [newRepeatCount, setNewRepeatCount] = useState(13);
  const [newGuestUids, setNewGuestUids] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEdit, setDetailEdit] = useState(false);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [activeOccurrenceDateKey, setActiveOccurrenceDateKey] = useState<string>("");
  const [recurringDeleteOpen, setRecurringDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editProject, setEditProject] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");

  const [editRepeatEnabled, setEditRepeatEnabled] = useState(false);
  const [editRepeatInterval, setEditRepeatInterval] = useState(1);
  const [editRepeatByWeekday, setEditRepeatByWeekday] = useState<number[]>([]);
  const [editRepeatEndType, setEditRepeatEndType] = useState<"NONE" | "UNTIL" | "COUNT">("NONE");
  const [editRepeatUntil, setEditRepeatUntil] = useState("");
  const [editRepeatCount, setEditRepeatCount] = useState(13);
  const [editGuestUids, setEditGuestUids] = useState<string[]>([]);

  const router = useRouter();

  const customersById = useMemo(() => {
    const m: Record<string, Customer> = {};
    for (const c of customers) m[c.id] = c;
    return m;
  }, [customers]);

  const dealsById = useMemo(() => {
    const m: Record<string, Deal> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

  const entryTitle = useCallback(
    (e: TimeEntry) => {
      const cust = e.customerId ? customersById[e.customerId]?.name || "" : "";
      const deal = e.dealId ? dealsById[e.dealId]?.title || "" : "";
      const parts = [cust, deal, (e.project || "").trim()].filter(Boolean);
      return parts.join(" / ") || "（無題）";
    },
    [customersById, dealsById],
  );

  // 社員一覧を読み込む
  const loadEmployees = useCallback(async (companyCode: string, uid: string) => {
    const merged: Employee[] = [];

    // まず companyCode で検索（通常ルート）
    if (companyCode) {
      console.log("チームカレンダー: companyCodeで社員を検索:", companyCode);
      const snapByCompany = await getDocs(
        query(collection(db, "employees"), where("companyCode", "==", companyCode)),
      );
      merged.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }

    // companyCode がない状態で employees を引くと Firestore ルール上 deny になりやすいので、
    // ここではフォールバック取得は行わない（companyCode は profiles/workspaceMemberships から復元する）

    // id で重複排除
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    const items = Array.from(byId.values());

    // 自分自身が employees に居ない場合でも、登録した工数が見えるようにする
    if (!items.some((e) => e.authUid === uid)) {
      items.push({ id: "__me__", name: profile?.displayName || "私", authUid: uid, color: "#10B981" });
    }

    console.log("チームカレンダー: 読み込んだ社員数:", items.length);
    console.log("チームカレンダー: 社員データ:", items);
    setEmployees(items);

    // デフォルトで全員選択（authUidがあるもののみ）
    const allIds = new Set(items.map(e => e.authUid).filter((id): id is string => !!id));
    console.log("チームカレンダー: authUidがある社員のID:", Array.from(allIds));
    setSelectedEmployeeIds(allIds);
    
    return items;
  }, [profile?.displayName]);

  const loadCustomersDeals = useCallback(async (companyCode: string) => {
    if (!companyCode) {
      setCustomers([]);
      setDeals([]);
      return;
    }
    try {
      const [custSnap, dealSnap] = await Promise.all([
        getDocs(query(collection(db, "customers"), where("companyCode", "==", companyCode))),
        getDocs(query(collection(db, "deals"), where("companyCode", "==", companyCode))),
      ]);
      const custs = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Customer));
      const ds = dealSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Deal));
      custs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      ds.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      setCustomers(custs);
      setDeals(ds);
    } catch (e) {
      console.warn("calendar: load customers/deals failed", e);
      setCustomers([]);
      setDeals([]);
    }
  }, []);

  const loadEntries = useCallback(
    async (code: string, employeeUids: string[] = []) => {
      let start: Date, end: Date;

      if (viewMode === "day") {
        start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
      } else if (viewMode === "week") {
        const day = currentDate.getDay();
        start = new Date(currentDate);
        start.setDate(currentDate.getDate() - day);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
      } else {
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
      }

      try {
        // Firestoreの複合インデックス要求を避けるため、
        // ここでは「companyCode一致」や「uid in」だけで取得し、日付範囲はクライアント側で絞り込みます。
        // （データ量が増えてきたら、Firebase Consoleで複合インデックスを作成してサーバー側絞り込みに戻す）

        const fetched: TimeEntry[] = [];

        if (code) {
          const snap = await getDocs(
            query(collection(db, "timeEntries"), where("companyCode", "==", code)),
          );
          fetched.push(...snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeEntry)));
        } else if (employeeUids.length > 0) {
          // Firestore制限: in は最大10個なので分割
          const chunks: string[][] = [];
          for (let i = 0; i < employeeUids.length; i += 10) chunks.push(employeeUids.slice(i, i + 10));

          for (const chunk of chunks) {
            const snap = await getDocs(
              query(collection(db, "timeEntries"), where("uid", "in", chunk)),
            );
            fetched.push(...snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeEntry)));
          }
        } else {
          setEntries([]);
          return;
        }

        const filtered = expandRecurringEntries(fetched, start, end);

        // 重複排除（複数chunk時）
        const byId = new Map<string, TimeEntry>();
        for (const e of filtered) byId.set(e.id, e);
        const items = Array.from(byId.values());

        console.log("チームカレンダー: 読み込んだ予定数:", items.length);
        setEntries(items);
      } catch (error) {
        console.error("Error loading entries:", error);
        setEntries([]);
      }
    },
    [currentDate, viewMode]
  );

  useEffect(() => {
    console.log("=== チームカレンダー: useEffect開始 ===");
    const unsub = onAuthStateChanged(auth, async (u) => {
      console.log("チームカレンダー: onAuthStateChanged呼び出し, user:", u?.uid);
      setUser(u);
      if (!u) {
        console.log("チームカレンダー: ユーザーがログインしていません");
        router.push("/login");
        return;
      }

      console.log("チームカレンダー: プロフィール取得中...");
      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      console.log("チームカレンダー: プロフィール存在:", profSnap.exists());
      
      if (profSnap.exists()) {
        const data = profSnap.data() as MemberProfile;
        console.log("チームカレンダー: プロフィールデータ:", data);
        console.log("チームカレンダー: companyCode:", data.companyCode);
        setProfile(data);
        
        // 会社情報の確認
        if (data.companyCode) {
          console.log("チームカレンダー: 会社情報取得中...");
          const compSnap = await getDoc(doc(db, "companies", data.companyCode));
          console.log("チームカレンダー: 会社情報存在:", compSnap.exists());
          
          if (compSnap.exists()) {
            const companyData = compSnap.data();
            console.log("チームカレンダー: 会社データ:", companyData);
            console.log("チームカレンダー: ownerUid:", companyData.ownerUid, "現在のuid:", u.uid);
            setCompanyOwnerUid(companyData.ownerUid || null);

            // 個人カレンダーを廃止したため、チームカレンダーは全ユーザーが閲覧できるようにする
            const loadedEmployees = await loadEmployees(data.companyCode, u.uid);
            await loadCustomersDeals(data.companyCode);
            const employeeUids = loadedEmployees.map(e => e.authUid).filter((id): id is string => !!id);
            await loadEntries(data.companyCode, employeeUids);
          } else {
            console.log("チームカレンダー: 会社情報が見つかりません");
          }
        } else {
          console.log("チームカレンダー: companyCodeがありません。createdByで社員を検索します");
          const loadedEmployees = await loadEmployees("", u.uid);
          const employeeUids = loadedEmployees.map(e => e.authUid).filter((id): id is string => !!id);
          await loadEntries("", employeeUids);
        }
      } else {
        // profiles が無い社員ログイン救済：
        // ルール上、profiles が無いと isInMyCompany が成立せず employees/timeEntries を読めないため、
        // まず workspaceMemberships から companyCode を取得し、profiles を自己作成して復旧する。
        console.log("チームカレンダー: プロフィールが見つかりません。workspaceMembershipsから復元します");

        const membershipSnap = await getDocs(query(collection(db, "workspaceMemberships"), where("uid", "==", u.uid)));
        const membership = !membershipSnap.empty ? membershipSnap.docs[0].data() : null;
        const code = (membership?.companyCode || "").trim();

        if (!code) {
          console.warn("チームカレンダー: workspaceMemberships から companyCode を取得できませんでした");
          setEmployees([{ id: "__me__", name: u.email?.split("@")[0] || "私", authUid: u.uid, color: "#10B981" }]);
          setEntries([]);
          setLoading(false);
          return;
        }

        // 会社名は読める場合だけ付与（membership があるので companies read は通る想定）
        let companyName: string | null = null;
        try {
          const compSnap = await getDoc(doc(db, "companies", code));
          if (compSnap.exists()) {
            const cd = compSnap.data() as any;
            companyName = (cd?.name || cd?.companyName || null) as string | null;
          }
        } catch {
          // noop
        }

        const displayName = u.displayName || u.email?.split("@")[0] || "ユーザー";
        const newProfile: MemberProfile = {
          uid: u.uid,
          displayName,
          email: u.email || null,
          companyCode: code,
          companyName,
        };

        await setDoc(doc(db, "profiles", u.uid), newProfile, { merge: true });
        setProfile(newProfile);

        const loadedEmployees = await loadEmployees(code, u.uid);
        await loadCustomersDeals(code);
        
        // 追加: オーナー情報を取得
        try {
          const compSnap = await getDoc(doc(db, "companies", code));
          if (compSnap.exists()) {
            setCompanyOwnerUid(compSnap.data().ownerUid || null);
          }
        } catch { /* noop */ }

        const employeeUids = loadedEmployees.map(e => e.authUid).filter((id): id is string => !!id);
        await loadEntries(code, employeeUids);
      }
      console.log("チームカレンダー: loading完了");
      setLoading(false);
    });
    return () => unsub();
  }, [router, loadEntries, loadEmployees]);

  const createEntry = async () => {
    if (!user) return;
    const project = newProject.trim();
    // project(作業名) は任意。顧客/案件の文脈を付けられるようにする。
    const startIso = new Date(`${newDate}T${newStartTime}:00`).toISOString();
    const endIso = new Date(`${newDate}T${newEndTime}:00`).toISOString();
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      alert("終了時刻は開始時刻より後にしてください");
      return;
    }

    const repeat: RepeatRule | null = newRepeatEnabled
      ? {
          freq: "WEEKLY",
          interval: Math.max(1, Math.floor(newRepeatInterval || 1)),
          byWeekday: (newRepeatByWeekday.length ? newRepeatByWeekday : [new Date(`${newDate}T00:00:00`).getDay()]).slice().sort((a, b) => a - b),
          end:
            newRepeatEndType === "UNTIL" && newRepeatUntil
              ? { type: "UNTIL" as const, until: newRepeatUntil }
              : newRepeatEndType === "COUNT"
                ? { type: "COUNT" as const, count: Math.max(1, Math.floor(newRepeatCount || 1)) }
                : { type: "NONE" as const },
        }
      : null;

    const payload = {
      uid: user.uid,
      companyCode: (profile?.companyCode || "").trim(),
      customerId: newCustomerId || null,
      dealId: newDealId || null,
      project,
      summary: newSummary.trim(),
      start: startIso,
      end: endIso,
      repeat,
      guestUids: Array.from(new Set(newGuestUids)).filter(Boolean),
    };

    await addDoc(collection(db, "timeEntries"), payload);

    // アクティビティログ（顧客・案件）
    if (profile?.companyCode) {
      const customerName = customers.find((c) => c.id === newCustomerId)?.name || "";
      const dealTitle = deals.find((d) => d.id === newDealId)?.title || "";
      const eventTitle = project || dealTitle || customerName || "予定";
      const startDate = new Date(startIso);
      const dateStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
      const timeStr = `${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`;

      if (newCustomerId) {
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "CALENDAR_EVENT_CREATED",
          customerId: newCustomerId,
          dealId: newDealId || null,
          message: `カレンダー予定を登録: ${eventTitle}（${dateStr} ${timeStr}）`,
          link: "/calendar/team",
        });
      }
      if (newDealId && newDealId !== newCustomerId) {
        // 案件が顧客と別IDの場合は案件側にも記録
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "CALENDAR_EVENT_CREATED",
          customerId: newCustomerId || null,
          dealId: newDealId,
          message: `カレンダー予定を登録: ${eventTitle}（${dateStr} ${timeStr}）`,
          link: "/calendar/team",
        });
      }
    }

    setCreateOpen(false);
    setNewCustomerId("");
    setNewDealId("");
    setNewProject("");
    setNewSummary("");
    setNewRepeatEnabled(false);
    setNewRepeatInterval(1);
    setNewRepeatByWeekday([]);
    setNewRepeatEndType("NONE");
    setNewRepeatUntil("");
    setNewRepeatCount(13);
    setNewGuestUids([]);

    // 直後に再ロード
    const employeeUids = employees.map(e => e.authUid).filter((id): id is string => !!id);
    await loadEntries(profile?.companyCode || "", employeeUids);
  };

  // 初期表示をビジネスタイム（8:00付近）に合わせる
  const scrollToBusinessHours = useCallback(() => {
    const targetTop = Math.max(0, 8 * HOUR_PX - HOUR_PX); // 7:00〜8:00あたりを上端に
    if (viewMode === "day") {
      dayScrollRef.current?.scrollTo({ top: targetTop });
    } else if (viewMode === "week") {
      weekScrollRef.current?.scrollTo({ top: targetTop });
    }
  }, [viewMode]);

  useEffect(() => {
    // レイアウト確定後にスクロール（初回・日付変更・表示切替）
    // ※初回は loading=true の間はスクロール領域(ref)が存在しないので、loadingが終わってから実行する
    if (loading) return;
    const t = window.setTimeout(() => scrollToBusinessHours(), 50);
    return () => window.clearTimeout(t);
  }, [loading, scrollToBusinessHours, viewMode, currentDate]);

  const openEntryDetail = (entry: TimeEntry) => {
    // 繰り返しの各回は baseId を持つ。保存先は baseId（シリーズの元）に寄せる
    const base = entry.baseId ? ({ ...entry, id: entry.baseId } as TimeEntry) : entry;
    setActiveEntry(base);
    setActiveOccurrenceDateKey(toDateKey(new Date(entry.start)));
    setDetailOpen(true);
    setDetailEdit(false);
    setRecurringDeleteOpen(false);

    const start = new Date(entry.start);
    const end = new Date(entry.end);
    const d = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    setEditDate(d);
    setEditStartTime(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
    setEditEndTime(`${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`);
    setEditProject(base.project || "");
    setEditSummary(base.summary || "");
    setEditGuestUids((base.guestUids || []).filter(Boolean));

    const r = base.repeat || null;
    setEditRepeatEnabled(!!r);
    setEditRepeatInterval(r?.interval || 1);
    setEditRepeatByWeekday(r?.byWeekday || []);
    setEditRepeatEndType(r?.end?.type || "NONE");
    setEditRepeatUntil(r?.end?.type === "UNTIL" ? r.end.until : "");
    setEditRepeatCount(r?.end?.type === "COUNT" ? r.end.count : 13);
  };

  const saveEntryEdit = async () => {
    if (!activeEntry) return;
    const project = editProject.trim();
    if (!project) {
      alert("案件/作業名を入力してください");
      return;
    }
    // 繰り返しの場合: 日付はシリーズの基準日を変えると意図しないズレが起きやすいので、現状は時間のみ編集可能
    const baseDateKey = activeEntry.repeat ? toDateKey(new Date(activeEntry.start)) : editDate;
    const startIso = new Date(`${baseDateKey}T${editStartTime}:00`).toISOString();
    const endIso = new Date(`${baseDateKey}T${editEndTime}:00`).toISOString();
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      alert("終了時刻は開始時刻より後にしてください");
      return;
    }

    const repeat: RepeatRule | null = editRepeatEnabled
      ? {
          freq: "WEEKLY",
          interval: Math.max(1, Math.floor(editRepeatInterval || 1)),
          byWeekday: (editRepeatByWeekday.length ? editRepeatByWeekday : [new Date(`${baseDateKey}T00:00:00`).getDay()]).slice().sort((a, b) => a - b),
          end:
            editRepeatEndType === "UNTIL" && editRepeatUntil
              ? { type: "UNTIL" as const, until: editRepeatUntil }
              : editRepeatEndType === "COUNT"
                ? { type: "COUNT" as const, count: Math.max(1, Math.floor(editRepeatCount || 1)) }
                : { type: "NONE" as const },
        }
      : null;

    setIsDeleting(true); // 保存中も isDeleting を借用（または isSaving を作る）
    try {
      await updateDoc(doc(db, "timeEntries", activeEntry.id), {
        project,
        summary: editSummary.trim(),
        start: startIso,
        end: endIso,
        repeat,
        guestUids: Array.from(new Set(editGuestUids)).filter(Boolean),
      });

      // 直後に再ロード
      const employeeUids = employees.map(e => e.authUid).filter((id): id is string => !!id);
      await loadEntries(profile?.companyCode || "", employeeUids);

      const updated: TimeEntry = {
        ...activeEntry,
        project,
        summary: editSummary.trim(),
        start: startIso,
        end: endIso,
        repeat,
        guestUids: Array.from(new Set(editGuestUids)).filter(Boolean),
      };
      setActiveEntry(updated);
      setDetailEdit(false);
    } catch (e: any) {
      console.error("Update failed:", e);
      alert("更新に失敗しました: " + (e.message || "権限がないか、エラーが発生しました"));
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteEntry = async () => {
    if (!activeEntry) return;
    if (activeEntry.repeat) {
      setRecurringDeleteOpen(true);
      return;
    }
    if (!confirm("この予定を削除しますか？")) return;
    
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "timeEntries", activeEntry.id));
      setDetailOpen(false);
      setActiveEntry(null);
      setDetailEdit(false);

      const employeeUids = employees.map(e => e.authUid).filter((id): id is string => !!id);
      await loadEntries(profile?.companyCode || "", employeeUids);
    } catch (e: any) {
      console.error("Delete failed:", e);
      alert("削除に失敗しました: " + (e.message || "権限がないか、エラーが発生しました"));
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteRecurringOne = async () => {
    if (!activeEntry || !activeEntry.repeat) return;
    setIsDeleting(true);
    try {
      const key = activeOccurrenceDateKey || toDateKey(new Date(activeEntry.start));
      const nextExdates = Array.from(new Set([...(activeEntry.repeat.exdates || []), key])).sort();
      await updateDoc(doc(db, "timeEntries", activeEntry.id), {
        repeat: { ...activeEntry.repeat, exdates: nextExdates },
      });
    } catch (e: any) {
      console.error("Delete recurring one failed:", e);
      alert("削除に失敗しました: " + (e.message || "エラーが発生しました"));
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteRecurringFromThisDay = async () => {
    if (!activeEntry || !activeEntry.repeat) return;
    setIsDeleting(true);
    try {
      const key = activeOccurrenceDateKey || toDateKey(new Date(activeEntry.start));
      const d = new Date(`${key}T00:00:00`);
      d.setDate(d.getDate() - 1);
      const until = toDateKey(d);
      await updateDoc(doc(db, "timeEntries", activeEntry.id), {
        repeat: { ...activeEntry.repeat, end: { type: "UNTIL", until } },
      });
    } catch (e: any) {
      console.error("Delete recurring from this day failed:", e);
      alert("削除に失敗しました: " + (e.message || "エラーが発生しました"));
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteRecurringAll = async () => {
    if (!activeEntry) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "timeEntries", activeEntry.id));
    } catch (e: any) {
      console.error("Delete recurring all failed:", e);
      alert("削除に失敗しました: " + (e.message || "エラーが発生しました"));
    } finally {
      setIsDeleting(false);
    }
  };

  const actorNameFor = (uid: string) => {
    return employees.find((e) => e.authUid === uid)?.name || (uid === user?.uid ? (profile?.displayName || "私") : "ユーザー");
  };

  const avatarLetterFor = (uid: string) => {
    const n = actorNameFor(uid);
    return (n || "U").trim().charAt(0).toUpperCase();
  };

  const colorForUid = (uid: string) => {
    const emp = employees.find((e) => e.authUid === uid);
    return emp?.color || "#3B82F6";
  };

  const firstUrl = (text: string) => {
    const raw = (text || "").trim();
    if (!raw) return "";
    const m = raw.match(/(https?:\/\/[^\s]+|meet\.google\.com\/[^\s]+)/);
    if (!m) return "";
    const u = m[0];
    return u.startsWith("http") ? u : `https://${u}`;
  };

  const canDragEntry = (e: TimeEntry) => {
    if (!user) return false;
    if (e.isOccurrence) return false; // 1回だけ移動は未対応（シリーズ全体の移動のUIが必要）
    return e.uid === user.uid;
  };

  const moveEntry = async (e: TimeEntry, nextStart: Date, nextEnd: Date) => {
    const id = e.baseId || e.id;
    await updateDoc(doc(db, "timeEntries", id), {
      start: nextStart.toISOString(),
      end: nextEnd.toISOString(),
    });
    const employeeUids = employees.map((x) => x.authUid).filter((id2): id2 is string => !!id2);
    await loadEntries(profile?.companyCode || "", employeeUids);
  };

  useEffect(() => {
    if (dragPreview) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
  }, [dragPreview]);

  // Drag & drop handlers (day/week)
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      if (ev.pointerId !== st.pointerId) return;

      const dx = Math.abs(ev.clientX - st.startClientX);
      const dy = Math.abs(ev.clientY - st.startClientY);
      if (!st.moved && (dx > 4 || dy > 4)) st.moved = true;
      if (!st.moved) return;

      // プレビュー計算
      if (st.mode === "day") {
        const scrollEl = dayScrollRef.current;
        if (!scrollEl) return;
        const rect = scrollEl.getBoundingClientRect();
        const y = ev.clientY - rect.top + scrollEl.scrollTop - (st.offsetMins / 60 * HOUR_PX);
        const mins = timeFromY(y);
        const dateKey = toDateKey(currentDate);
        const nextStart = setTimeOnDateKey(dateKey, mins);
        const nextEnd = new Date(nextStart.getTime() + st.durationMins * 60 * 1000);
        const empColor = employees.find(e => e.authUid === st.entry.uid)?.color || "#3B82F6";
        setDragPreview({ entryId: st.entry.id, start: nextStart, end: nextEnd, uid: st.entry.uid, color: empColor });
      } else if (st.mode === "week") {
        const scrollEl = weekScrollRef.current;
        const colsEl = weekColsRef.current;
        if (!scrollEl || !colsEl) return;
        const rect = scrollEl.getBoundingClientRect();
        const y = ev.clientY - rect.top + scrollEl.scrollTop - (st.offsetMins / 60 * HOUR_PX);
        const mins = timeFromY(y);
        const colsRect = colsEl.getBoundingClientRect();
        const x = ev.clientX - colsRect.left;
        const colW = colsRect.width / 7;
        const dayIdx = clamp(Math.floor(x / Math.max(1, colW)), 0, 6);
        const wkStart = startOfWeek(currentDate);
        const day = new Date(wkStart);
        day.setDate(wkStart.getDate() + dayIdx);
        const dateKey = toDateKey(day);
        const nextStart = setTimeOnDateKey(dateKey, mins);
        const nextEnd = new Date(nextStart.getTime() + st.durationMins * 60 * 1000);
        const empColor = employees.find(e => e.authUid === st.entry.uid)?.color || "#3B82F6";
        setDragPreview({ entryId: st.entry.id, start: nextStart, end: nextEnd, uid: st.entry.uid, color: empColor, dayIdx });
      }
    };

    const onUp = async (ev: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      if (ev.pointerId !== st.pointerId) return;

      const preview = dragPreview;
      dragRef.current = null;
      setDragPreview(null);

      if (!st.moved) return;

      suppressNextClickRef.current = true;
      window.setTimeout(() => (suppressNextClickRef.current = false), 0);

      if (preview) {
        await moveEntry(st.entry, preview.start, preview.end);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [currentDate, dragPreview, moveEntry]);

  // 期間変更時にデータを再ロード
  useEffect(() => {
    // メインのカレンダーの日付が変わったら、ミニカレンダーの表示月も合わせる
    // ただし、ミニカレンダー側で月を切り替えている最中に上書きされないよう、
    // currentDate の月/年が現在の miniCalendarDate と異なる場合のみ同期する
    if (currentDate.getMonth() !== miniCalendarDate.getMonth() || currentDate.getFullYear() !== miniCalendarDate.getFullYear()) {
      setMiniCalendarDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    }

    if (employees.length > 0) {
      void (async () => {
        const employeeUids = employees.map(e => e.authUid).filter((id): id is string => !!id);
        await loadEntries(profile?.companyCode || "", employeeUids);
      })();
    }
  }, [currentDate, viewMode, profile, employees, loadEntries]);

  const goToPrevious = () => {
    if (viewMode === "day") {
      const newDate = new Date(currentDate);
      newDate.setDate(currentDate.getDate() - 1);
      setCurrentDate(newDate);
    } else if (viewMode === "week") {
      const newDate = new Date(currentDate);
      newDate.setDate(currentDate.getDate() - 7);
      setCurrentDate(newDate);
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    }
  };

  const goToNext = () => {
    if (viewMode === "day") {
      const newDate = new Date(currentDate);
      newDate.setDate(currentDate.getDate() + 1);
      setCurrentDate(newDate);
    } else if (viewMode === "week") {
      const newDate = new Date(currentDate);
      newDate.setDate(currentDate.getDate() + 7);
      setCurrentDate(newDate);
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getDateRangeText = () => {
    if (viewMode === "day") {
      return `${currentDate.getFullYear()}年 ${currentDate.getMonth() + 1}月 ${currentDate.getDate()}日`;
    } else if (viewMode === "week") {
      const day = currentDate.getDay();
      const start = new Date(currentDate);
      start.setDate(currentDate.getDate() - day);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      
      if (start.getMonth() === end.getMonth()) {
        return `${start.getFullYear()}年 ${start.getMonth() + 1}月 ${start.getDate()}日 - ${end.getDate()}日`;
      } else {
        return `${start.getFullYear()}年 ${start.getMonth() + 1}月 ${start.getDate()}日 - ${end.getMonth() + 1}月 ${end.getDate()}日`;
      }
    } else {
      return `${currentDate.getFullYear()}年 ${currentDate.getMonth() + 1}月`;
    }
  };

  const renderMiniCalendar = () => {
    const year = miniCalendarDate.getFullYear();
    const month = miniCalendarDate.getMonth();
    
    // 月の初日の曜日
    const firstDay = new Date(year, month, 1);
    const firstDayIdx = firstDay.getDay();
    
    // カレンダーに表示する日付の配列
    const days: (Date | null)[] = [];
    
    // 前月の埋め
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = 0; i < firstDayIdx; i++) {
      days.push(new Date(year, month - 1, prevMonthLastDay - firstDayIdx + 1 + i));
    }
    
    // 今月の日付
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= lastDay; i++) {
      days.push(new Date(year, month, i));
    }
    
    // 次月の埋め
    const remaining = 42 - days.length; // 6行分
    for (let i = 1; i <= remaining; i++) {
      days.push(new Date(year, month + 1, i));
    }

    const prevMonth = () => {
      setMiniCalendarDate(new Date(year, month - 1, 1));
    };
    const nextMonth = () => {
      setMiniCalendarDate(new Date(year, month + 1, 1));
    };

    return (
      <div className="mb-6 px-2">
        <div className="mb-4 flex items-center justify-between px-1">
          <span className="text-sm font-extrabold text-slate-700">
            {year}年 {month + 1}月
          </span>
          <div className="flex gap-1">
            <button
              onClick={prevMonth}
              className="rounded p-1 hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={nextMonth}
              className="rounded p-1 hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
            <div key={d} className="text-center text-[10px] font-bold text-slate-400 py-1">
              {d}
            </div>
          ))}
          {days.map((date, idx) => {
            if (!date) return <div key={idx} />;
            const isCurrentMonth = date.getMonth() === month;
            const isSelected = 
              date.getDate() === currentDate.getDate() &&
              date.getMonth() === currentDate.getMonth() &&
              date.getFullYear() === currentDate.getFullYear();
            const isToday = 
              date.getDate() === now.getDate() &&
              date.getMonth() === now.getMonth() &&
              date.getFullYear() === now.getFullYear();

            return (
              <button
                key={idx}
                onClick={() => setCurrentDate(new Date(date))}
                className={clsx(
                  "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all mx-auto",
                  !isCurrentMonth ? "text-slate-300" : isSelected ? "bg-blue-600 text-white" : isToday ? "text-blue-600 bg-blue-50" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSidebar = () => {
    return (
      <div
        className={clsx(
          "flex w-64 flex-col border-r border-slate-200 bg-white transition-all duration-300",
          showSidebar ? "" : "-ml-64",
        )}
      >
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {renderMiniCalendar()}
          
          <div className="mb-6 px-2">
            <div className="relative">
              <input
                type="text"
                placeholder="ユーザーを検索"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-xs font-bold text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100 transition-all shadow-inner"
              />
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="mb-3 px-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              チームメンバー ({employees.filter(emp => emp.name.toLowerCase().includes(memberSearch.toLowerCase())).length})
            </h3>
            <div className="space-y-0.5">
              {employees.filter(emp => emp.name.toLowerCase().includes(memberSearch.toLowerCase())).length === 0 && (
                <div className="mx-2 rounded-lg bg-slate-50 p-3 text-center border border-dashed border-slate-200">
                  <p className="text-xs font-bold text-slate-400 italic">メンバーなし</p>
                </div>
              )}
              {employees
                .filter(emp => emp.name.toLowerCase().includes(memberSearch.toLowerCase()))
                .map((emp) => (
                <label
                  key={emp.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 cursor-pointer transition-colors group"
                >
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={emp.authUid ? selectedEmployeeIds.has(emp.authUid) : false}
                      onChange={(e) => {
                        if (!emp.authUid) return;
                        const newSet = new Set(selectedEmployeeIds);
                        if (e.target.checked) newSet.add(emp.authUid);
                        else newSet.delete(emp.authUid);
                        setSelectedEmployeeIds(newSet);
                      }}
                      className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-slate-300 checked:border-orange-500 checked:bg-orange-500 focus:ring-2 focus:ring-orange-100 transition-all"
                    />
                    <svg
                      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100 transition-opacity"
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path d="M3.5 6L5 7.5L8.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white shadow-sm transition group-hover:scale-110"
                      style={{ backgroundColor: emp.color || "#3B82F6" }}
                    >
                      {emp.name.charAt(0)}
                    </div>
                    <span className="text-xs font-bold text-slate-700 truncate group-hover:text-slate-900">{emp.name}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTeamDayView = () => {
    const getEmployeeEntries = (uid: string) => {
      return entries.filter((entry) => {
        const isParticipant = entry.uid === uid || (entry.guestUids || []).includes(uid);
        if (!isParticipant) return false;
        const entryDate = new Date(entry.start);
        return (
          entryDate.getDate() === currentDate.getDate() &&
          entryDate.getMonth() === currentDate.getMonth() &&
          entryDate.getFullYear() === currentDate.getFullYear()
        );
      });
    };

    const displayEmployees = employees
      .map((emp) => ({
        id: emp.id,
        name: emp.name,
        uid: emp.authUid,
        color: emp.color,
      }))
      .filter((emp) => emp.uid && selectedEmployeeIds.has(emp.uid));

    const isToday =
      currentDate.getDate() === now.getDate() &&
      currentDate.getMonth() === now.getMonth() &&
      currentDate.getFullYear() === now.getFullYear();

    const currentTimeTop = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;
    const isSingle = displayEmployees.length === 1;

    return (
      <div className="flex h-full flex-col overflow-hidden bg-white">
        <div className="flex flex-1 overflow-hidden">
          {/* 時間軸 (Sticky) */}
          <div className="z-30 w-16 flex-shrink-0 border-r border-slate-200 bg-white">
            <div className="h-12 border-b border-slate-200 bg-white"></div>
            <div className="relative h-[calc(100%-48px)] overflow-y-hidden" id="time-axis-scroll">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative pr-2 pt-1 text-right text-[10px] font-bold text-slate-400"
                  style={{ height: HOUR_PX }}
                >
                  <span className="-top-2 relative">{hour === 0 ? "" : `${hour}:00`}</span>
                </div>
              ))}
            </div>
          </div>

          {/* メインエリア (Scrollable) */}
          <div
            className="flex-1 overflow-auto custom-scrollbar"
            ref={dayScrollRef}
            onScroll={(e) => {
              const el = document.getElementById("time-axis-scroll");
              if (el) el.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
            }}
          >
            <div
              ref={dayColsRef}
              className={clsx("flex min-h-full relative", isSingle ? "min-w-full" : "min-w-max")}
            >
              {displayEmployees.length === 0 ? (
                <div className="flex h-96 w-full items-center justify-center text-slate-400">
                  <div className="text-center">
                    <p className="text-lg font-bold">表示する社員がいません</p>
                    <p className="text-sm">左のサイドバーから社員を選択してください</p>
                  </div>
                </div>
              ) : (
                <>
                  {displayEmployees.map((emp) => {
                    const empEntries = emp.uid ? getEmployeeEntries(emp.uid) : [];

                    return (
                      <div
                        key={emp.id}
                        className={clsx(
                          "group/col border-r border-slate-100 bg-white relative",
                          isSingle ? "flex-1 min-w-0" : "w-64",
                        )}
                      >
                        {/* ユーザーヘッダー (Sticky) */}
                        <div className="sticky top-0 z-20 flex h-12 items-center justify-center border-b border-slate-200 bg-white/95 px-2 backdrop-blur-sm">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold text-white shadow-sm transition group-hover/col:scale-110"
                              style={{ backgroundColor: emp.color || "#3B82F6" }}
                            >
                              {emp.name.charAt(0)}
                            </div>
                            <div className="truncate text-xs font-extrabold text-slate-700">
                              {emp.name}
                            </div>
                          </div>
                        </div>

                        <div className="relative">
                          {/* グリッド & クリック可能エリア */}
                          {HOURS.map((hour) => (
                            <div
                              key={hour}
                              className="border-b border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                              style={{ height: HOUR_PX }}
                              onClick={() => {
                                setNewDate(`${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`);
                                setNewStartTime(`${String(hour).padStart(2, "0")}:00`);
                                setNewEndTime(`${String(hour + 1).padStart(2, "0")}:00`);
                                setCreateOpen(true);
                              }}
                            ></div>
                          ))}

                          {/* イベント */}
                          {empEntries.map((entry) => {
                            const start = new Date(entry.start);
                            const end = new Date(entry.end);
                            const startHour = start.getHours();
                            const startMinute = start.getMinutes();
                            const endHour = end.getHours();
                            const endMinute = end.getMinutes();

                            const top = (startHour + startMinute / 60) * HOUR_PX;
                            const height = Math.max((endHour + endMinute / 60 - (startHour + startMinute / 60)) * HOUR_PX, 24);

                            const empColors = getEmployeeColors(emp.color || "#3B82F6");
                            const isDraggingThis = dragPreview?.entryId === entry.id;

                            return (
                              <div
                                key={entry.id}
                                className={clsx(
                                  "absolute left-1 right-1 z-10 overflow-hidden rounded-md border-l-4 px-2 py-1.5 shadow-sm transition hover:shadow-md hover:brightness-95 active:scale-[0.98]",
                                  isDraggingThis && "opacity-30 grayscale-[0.5] scale-[0.98] shadow-none pointer-events-none"
                                )}
                                title={`${entryTitle(entry)}\n${formatTime(entry.start)} - ${formatTime(entry.end)}\n${entry.summary || ""}`}
                                onPointerDown={(ev) => {
                                  if (!canDragEntry(entry)) return;
                                  ev.stopPropagation();
                                  const rect = ev.currentTarget.getBoundingClientRect();
                                  const offsetY = ev.clientY - rect.top;
                                  const offsetMins = (offsetY / HOUR_PX) * 60;
                                  (ev.currentTarget as HTMLDivElement).setPointerCapture(ev.pointerId);
                                  const s = new Date(entry.start);
                                  const e = new Date(entry.end);
                                  const dur = Math.max(15, Math.round((e.getTime() - s.getTime()) / 60000));
                                  dragRef.current = {
                                    entry,
                                    mode: "day",
                                    pointerId: ev.pointerId,
                                    startClientX: ev.clientX,
                                    startClientY: ev.clientY,
                                    moved: false,
                                    durationMins: dur,
                                    offsetMins,
                                  };
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (suppressNextClickRef.current) return;
                                  openEntryDetail(entry);
                                }}
                                style={{
                                  top: `${top}px`,
                                  height: `${height}px`,
                                  backgroundColor: empColors.light,
                                  borderLeftColor: empColors.border,
                                  cursor: canDragEntry(entry) ? "grab" : "pointer",
                                }}
                              >
                                <div className="text-[11px] font-extrabold text-slate-900 truncate leading-tight">
                                  {entryTitle(entry)}
                                </div>
                                <div className="text-[9px] font-bold text-slate-600 truncate opacity-80 mt-0.5">
                                  {formatTime(entry.start)} - {formatTime(entry.end)}
                                </div>
                                {height > 40 && entry.summary && (
                                  <div className="text-[9px] text-slate-500 truncate mt-1 leading-tight">{entry.summary}</div>
                                )}
                              </div>
                            );
                          })}

                          {/* プレビュー (ドラッグ中) */}
                          {dragPreview && viewMode === "day" && dragPreview.uid === emp.uid && (
                            <div
                              className="pointer-events-none absolute left-1 right-1 z-50 overflow-hidden rounded-md border-l-4 border-dashed px-2 py-1.5 opacity-70 shadow-2xl scale-[1.02] transition-transform duration-75"
                              style={{
                                top: `${(dragPreview.start.getHours() + dragPreview.start.getMinutes() / 60) * HOUR_PX}px`,
                                height: `${Math.max((dragPreview.end.getTime() - dragPreview.start.getTime()) / 60000 / 60 * HOUR_PX, 24)}px`,
                                backgroundColor: getEmployeeColors(dragPreview.color).light,
                                borderLeftColor: getEmployeeColors(dragPreview.color).border,
                                boxShadow: `0 20px 25px -5px ${dragPreview.color}20, 0 8px 10px -6px ${dragPreview.color}20`,
                              }}
                            >
                              <div className="text-[11px] font-extrabold text-slate-900 truncate">
                                {formatTime(dragPreview.start.toISOString())} - {formatTime(dragPreview.end.toISOString())}
                              </div>
                              <div className="text-[9px] font-bold text-slate-600 truncate mt-0.5">
                                移動中...
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* 現在時刻のインジケーター (赤い線) */}
                  {isToday && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-40 border-t-2 border-rose-500"
                      style={{ top: `${currentTimeTop}px` }}
                    >
                      <div className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-rose-500 shadow-sm" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const day = currentDate.getDay();
    const start = new Date(currentDate);
    start.setDate(currentDate.getDate() - day);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return date;
    });

    const getDayEntries = (date: Date) => {
      return entries.filter((entry) => {
        const entryDate = new Date(entry.start);
        const isSelectedParticipant =
          selectedEmployeeIds.has(entry.uid) || (entry.guestUids || []).some((u) => selectedEmployeeIds.has(u));
        return (
          entryDate.getDate() === date.getDate() &&
          entryDate.getMonth() === date.getMonth() &&
          entryDate.getFullYear() === date.getFullYear() &&
          isSelectedParticipant
        );
      });
    };

    const currentTimeTop = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;
    const currentDayIdx = now.getDay();

    return (
      <div className="flex h-full flex-col overflow-hidden bg-white">
        <div className="flex flex-1 overflow-hidden">
          {/* 時間軸 (Sticky) */}
          <div className="z-30 w-16 flex-shrink-0 border-r border-slate-200 bg-white">
            <div className="h-16 border-b border-slate-200 bg-white"></div>
            <div className="relative h-[calc(100%-64px)] overflow-y-hidden" id="week-time-axis-scroll">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative pr-2 pt-1 text-right text-[10px] font-bold text-slate-400"
                  style={{ height: HOUR_PX }}
                >
                  <span className="-top-2 relative">{hour === 0 ? "" : `${hour}:00`}</span>
                </div>
              ))}
            </div>
          </div>

          {/* メインエリア (Scrollable) */}
          <div
            className="flex-1 overflow-auto custom-scrollbar"
            ref={weekScrollRef}
            onScroll={(e) => {
              const el = document.getElementById("week-time-axis-scroll");
              if (el) el.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
            }}
          >
            <div
              ref={weekColsRef}
              className="flex min-w-[800px] min-h-full relative divide-x divide-slate-100"
            >
              {weekDays.map((date, index) => {
                const isToday =
                  date.getDate() === now.getDate() &&
                  date.getMonth() === now.getMonth() &&
                  date.getFullYear() === now.getFullYear();
                const dayEntries = getDayEntries(date);

                return (
                  <div key={index} className="flex-1 min-w-[120px] bg-white relative">
                    {/* 曜日ヘッダー (Sticky) */}
                    <div className="sticky top-0 z-20 flex h-16 flex-col items-center justify-center border-b border-slate-200 bg-white/95 backdrop-blur-sm">
                      <div className={clsx("text-[10px] font-extrabold uppercase mb-1", isToday ? "text-blue-600" : "text-slate-500")}>
                        {["日", "月", "火", "水", "木", "金", "土"][date.getDay()]}
                      </div>
                      <div
                        className={clsx(
                          "flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform",
                          isToday ? "bg-blue-600 text-white font-extrabold shadow-sm" : "text-slate-700 font-bold hover:bg-slate-100",
                        )}
                      >
                        {date.getDate()}
                      </div>
                    </div>

                    <div className="relative group/day">
                      {/* グリッド & クリック可能エリア */}
                      {HOURS.map((hour) => (
                        <div
                          key={hour}
                          className="border-b border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                          style={{ height: HOUR_PX }}
                          onClick={() => {
                            setNewDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
                            setNewStartTime(`${String(hour).padStart(2, "0")}:00`);
                            setNewEndTime(`${String(hour + 1).padStart(2, "0")}:00`);
                            setCreateOpen(true);
                          }}
                        ></div>
                      ))}

                      {/* 現在時刻のインジケーター (赤い線) */}
                      {isToday && (
                        <div
                          className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-rose-500"
                          style={{ top: `${currentTimeTop}px` }}
                        >
                          <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-rose-500 shadow-sm" />
                        </div>
                      )}

                      {/* イベント */}
                      {dayEntries.map((entry) => {
                        const start = new Date(entry.start);
                        const end = new Date(entry.end);
                        const startHour = start.getHours();
                        const startMinute = start.getMinutes();
                        const endHour = end.getHours();
                        const endMinute = end.getMinutes();

                        const top = (startHour + startMinute / 60) * HOUR_PX;
                        const height = Math.max((endHour + endMinute / 60 - (startHour + startMinute / 60)) * HOUR_PX, 24);

                        const emp = employees.find((e) => e.authUid === entry.uid);
                        const empColors = getEmployeeColors(emp?.color || "#3B82F6");
                        const isDraggingThis = dragPreview?.entryId === entry.id;

                        return (
                          <div
                            key={entry.id}
                            className={clsx(
                              "absolute left-1 right-1 z-10 overflow-hidden rounded-md border-l-4 px-2 py-1 shadow-sm transition hover:shadow-md hover:brightness-95 active:scale-[0.98]",
                              isDraggingThis && "opacity-30 grayscale-[0.5] scale-[0.98] shadow-none pointer-events-none"
                            )}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              backgroundColor: empColors.light,
                              borderLeftColor: empColors.border,
                              cursor: canDragEntry(entry) ? "grab" : "pointer",
                            }}
                            title={`${emp?.name || "不明"} - ${entryTitle(entry)}\n${formatTime(entry.start)} - ${formatTime(entry.end)}`}
                            onPointerDown={(ev) => {
                              if (!canDragEntry(entry)) return;
                              ev.stopPropagation();
                              const rect = ev.currentTarget.getBoundingClientRect();
                              const offsetY = ev.clientY - rect.top;
                              const offsetMins = (offsetY / HOUR_PX) * 60;
                              (ev.currentTarget as HTMLDivElement).setPointerCapture(ev.pointerId);
                              const s = new Date(entry.start);
                              const e = new Date(entry.end);
                              const dur = Math.max(15, Math.round((e.getTime() - s.getTime()) / 60000));
                              dragRef.current = {
                                entry,
                                mode: "week",
                                pointerId: ev.pointerId,
                                startClientX: ev.clientX,
                                startClientY: ev.clientY,
                                moved: false,
                                durationMins: dur,
                                offsetMins,
                              };
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (suppressNextClickRef.current) return;
                              openEntryDetail(entry);
                            }}
                          >
                            <div className="flex items-center gap-1 text-[10px] font-extrabold text-slate-900 leading-tight">
                              <div className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: empColors.base }} />
                              <span className="truncate">{emp?.name || "不明"}</span>
                            </div>
                            <div className="text-[10px] font-bold text-slate-700 truncate mt-0.5">{entryTitle(entry)}</div>
                            {height > 40 && (
                              <div className="text-[9px] text-slate-500 truncate opacity-80">
                                {formatTime(entry.start)} - {formatTime(entry.end)}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* プレビュー (ドラッグ中) */}
                      {dragPreview && viewMode === "week" && dragPreview.dayIdx === index && (
                        <div
                          className="pointer-events-none absolute left-1 right-1 z-50 overflow-hidden rounded-md border-l-4 border-dashed px-2 py-1 opacity-70 shadow-2xl scale-[1.02] transition-transform duration-75"
                          style={{
                            top: `${(dragPreview.start.getHours() + dragPreview.start.getMinutes() / 60) * HOUR_PX}px`,
                            height: `${Math.max((dragPreview.end.getTime() - dragPreview.start.getTime()) / 60000 / 60 * HOUR_PX, 24)}px`,
                            backgroundColor: getEmployeeColors(dragPreview.color).light,
                            borderLeftColor: getEmployeeColors(dragPreview.color).border,
                            boxShadow: `0 20px 25px -5px ${dragPreview.color}20, 0 8px 10px -6px ${dragPreview.color}20`,
                          }}
                        >
                          <div className="text-[10px] font-extrabold text-slate-900 truncate">
                            {formatTime(dragPreview.start.toISOString())} - {formatTime(dragPreview.end.toISOString())}
                          </div>
                          <div className="text-[8px] font-bold text-slate-600 truncate leading-tight">
                            移動中...
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const numDays = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= numDays; i++) days.push(new Date(year, month, i));

    const getDayEntries = (date: Date) => {
      return entries.filter((entry) => {
        const entryDate = new Date(entry.start);
        const isSelectedParticipant =
          selectedEmployeeIds.has(entry.uid) || (entry.guestUids || []).some((u) => selectedEmployeeIds.has(u));
        return (
          entryDate.getDate() === date.getDate() &&
          entryDate.getMonth() === date.getMonth() &&
          entryDate.getFullYear() === date.getFullYear() &&
          isSelectedParticipant
        );
      });
    };

    return (
      <div className="flex h-full flex-col bg-white overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/50">
          {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
            <div
              key={day}
              className={clsx(
                "py-2 text-center text-[10px] font-extrabold uppercase tracking-wider",
                index === 0 ? "text-rose-500" : index === 6 ? "text-blue-500" : "text-slate-500",
              )}
            >
              {day}
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto custom-scrollbar divide-x divide-y divide-slate-100 border-b border-slate-100">
          {days.map((day, index) => {
            if (!day) return <div key={index} className="bg-slate-50/30" />;

            const isToday =
              day.getDate() === now.getDate() &&
              day.getMonth() === now.getMonth() &&
              day.getFullYear() === now.getFullYear();
            const dayEntries = getDayEntries(day);

            return (
              <div
                key={index}
                className="group/day min-h-[100px] p-1 transition hover:bg-slate-50/50 cursor-pointer"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setNewDate(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`);
                    setCreateOpen(true);
                  }
                }}
              >
                <div className="flex justify-center mb-1">
                  <span
                    className={clsx(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs transition-transform group-hover/day:scale-110",
                      isToday ? "bg-blue-600 text-white font-extrabold shadow-sm" : "text-slate-600 font-bold",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {dayEntries.slice(0, 5).map((entry) => {
                    const emp = employees.find((e) => e.authUid === entry.uid);
                    const empColors = getEmployeeColors(emp?.color || "#3B82F6");
                    return (
                      <div
                        key={entry.id}
                        className="truncate rounded px-1 py-0.5 text-[9px] font-bold text-slate-700 shadow-sm transition hover:brightness-95"
                        style={{
                          backgroundColor: empColors.light,
                          borderLeft: `2px solid ${empColors.border}`,
                        }}
                        title={`${emp?.name || "?"}: ${entryTitle(entry)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEntryDetail(entry);
                        }}
                      >
                        <span className="opacity-70 mr-1">{formatTime(entry.start)}</span>
                        {entryTitle(entry)}
                      </div>
                    );
                  })}
                  {dayEntries.length > 5 && (
                    <div className="text-[9px] text-slate-400 text-center font-extrabold py-0.5">他 {dayEntries.length - 5} 件</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    console.log("チームカレンダー: loading中...");
    return (
      <AppShell title="カレンダー">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    console.log("チームカレンダー: userがnullです");
    return null;
  }

  console.log("=== チームカレンダー: レンダリング ===");
  console.log("user:", user.uid);
  console.log("profile:", profile);
  console.log("employees:", employees);
  console.log("showSidebar:", showSidebar);

  return (
    <AppShell title="カレンダー" subtitle={getDateRangeText()}>
      <div className="flex h-[calc(100vh-140px)] flex-col bg-white overflow-hidden rounded-xl border border-slate-200 shadow-sm transition-all">
        {/* Sub Header */}
        <div className="border-b border-slate-200 bg-slate-50/50 px-4 py-2 flex items-center justify-between flex-shrink-0 z-40">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="rounded-lg p-2 hover:bg-white text-slate-600 shadow-sm border border-transparent hover:border-slate-200 transition-all"
              title="サイドバーを切替"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1" />
            <button
              onClick={goToToday}
              className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            >
              今日
            </button>
            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={goToPrevious}
                className="rounded-lg p-1.5 hover:bg-white text-slate-600 border border-transparent hover:border-slate-200 transition-all"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={goToNext}
                className="rounded-lg p-1.5 hover:bg-white text-slate-600 border border-transparent hover:border-slate-200 transition-all"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <h2 className="ml-2 text-sm font-extrabold text-slate-800">
              {getDateRangeText()}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const d = currentDate;
                setNewDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
                setCreateOpen(true);
              }}
              className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-orange-700 transition-all shadow-md active:scale-95"
              type="button"
            >
              ＋ 工数登録
            </button>
            <div className="flex rounded-lg border border-slate-200 bg-white shadow-sm p-0.5">
              {[
                { mode: "day" as const, label: "日" },
                { mode: "week" as const, label: "週" },
                { mode: "month" as const, label: "月" },
              ].map((v) => (
                <button
                  key={v.mode}
                  onClick={() => setViewMode(v.mode)}
                  className={clsx(
                    "px-4 py-1 text-xs font-extrabold transition-all rounded-md",
                    viewMode === v.mode ? "bg-slate-100 text-slate-900 shadow-inner" : "text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 min-h-0 overflow-hidden relative">
          {renderSidebar()}
          <main className="flex-1 min-h-0 overflow-hidden relative bg-slate-50">
            {viewMode === "day" && renderTeamDayView()}
            {viewMode === "week" && renderWeekView()}
            {viewMode === "month" && renderMonthView()}
          </main>
        </div>

      {createOpen && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCreateOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-sm font-extrabold text-slate-900">工数を登録</div>
              <button
                onClick={() => setCreateOpen(false)}
                className="rounded-md px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-50"
                type="button"
              >
                ×
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <div className="text-xs font-extrabold text-slate-500">日付</div>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewDate(val);
                    // 繰り返しがONなら、新しい日付の曜日を自動選択
                    if (newRepeatEnabled && val) {
                      const d = new Date(`${val}T00:00:00`);
                      setNewRepeatByWeekday([d.getDay()]);
                    }
                  }}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-extrabold text-slate-500">開始</div>
                  <div className="mt-1 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const [h, m] = newStartTime.split(":").map(Number);
                        const totalMinutes = h * 60 + m - 30;
                        const newH = Math.floor((totalMinutes + 1440) % 1440 / 60);
                        const newM = (totalMinutes + 1440) % 60;
                        setNewStartTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-all"
                      title="30分早める"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <input
                      type="time"
                      value={newStartTime}
                      onChange={(e) => setNewStartTime(e.target.value)}
                      className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const [h, m] = newStartTime.split(":").map(Number);
                        const totalMinutes = h * 60 + m + 30;
                        const newH = Math.floor(totalMinutes % 1440 / 60);
                        const newM = totalMinutes % 60;
                        setNewStartTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-all"
                      title="30分遅める"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-extrabold text-slate-500">終了</div>
                  <div className="mt-1 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const [h, m] = newEndTime.split(":").map(Number);
                        const totalMinutes = h * 60 + m - 30;
                        const newH = Math.floor((totalMinutes + 1440) % 1440 / 60);
                        const newM = (totalMinutes + 1440) % 60;
                        setNewEndTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-all"
                      title="30分早める"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <input
                      type="time"
                      value={newEndTime}
                      onChange={(e) => setNewEndTime(e.target.value)}
                      className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const [h, m] = newEndTime.split(":").map(Number);
                        const totalMinutes = h * 60 + m + 30;
                        const newH = Math.floor(totalMinutes % 1440 / 60);
                        const newM = totalMinutes % 60;
                        setNewEndTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-all"
                      title="30分遅める"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-slate-500">顧客</div>
                <select
                  value={newCustomerId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewCustomerId(v);
                    setNewDealId("");
                  }}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                >
                  <option value="">（未選択）</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs font-extrabold text-slate-500">案件</div>
                <select
                  value={newDealId}
                  onChange={(e) => setNewDealId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                >
                  <option value="">（未選択）</option>
                  {deals
                    .filter((d) => !newCustomerId || !d.customerId || d.customerId === newCustomerId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                </select>
                <div className="mt-1 text-[10px] font-bold text-slate-500">
                  ※ 顧客を選ぶと、関連する案件を優先表示します
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-slate-500">案件/作業名</div>
                <input
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  placeholder="例）A社 定例MTG / バグ修正"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                />
              </div>

              <div>
                <div className="text-xs font-extrabold text-slate-500">メモ（任意）</div>
                <input
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="例）議事録作成、対応内容など"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-extrabold text-slate-700">繰り返し</div>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={newRepeatEnabled}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setNewRepeatEnabled(checked);
                        if (checked) {
                          // ON時は必ず「当日の曜日」を自動選択
                          const d = new Date(`${newDate}T00:00:00`);
                          setNewRepeatByWeekday([d.getDay()]);
                        }
                      }}
                      className="h-4 w-4"
                    />
                    毎週
                  </label>
                </div>

                {newRepeatEnabled && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                      <span>繰り返し間隔</span>
                      <input
                        type="number"
                        min={1}
                        value={newRepeatInterval}
                        onChange={(e) => setNewRepeatInterval(Number(e.target.value || 1))}
                        className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-800"
                      />
                      <span>週ごと</span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_LABELS.map((lbl, idx) => {
                        const on = newRepeatByWeekday.includes(idx);
                        return (
                          <button
                            key={lbl}
                            type="button"
                            onClick={() => {
                              setNewRepeatByWeekday((prev) => {
                                const s = new Set(prev);
                                if (s.has(idx)) s.delete(idx);
                                else s.add(idx);
                                return Array.from(s.values()).sort((a, b) => a - b);
                              });
                            }}
                            className={clsx(
                              "h-8 w-8 rounded-full text-xs font-extrabold transition",
                              on ? "bg-orange-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                            )}
                            title={lbl}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input
                          type="radio"
                          name="newRepeatEnd"
                          checked={newRepeatEndType === "NONE"}
                          onChange={() => setNewRepeatEndType("NONE")}
                        />
                        終了なし
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input
                          type="radio"
                          name="newRepeatEnd"
                          checked={newRepeatEndType === "UNTIL"}
                          onChange={() => setNewRepeatEndType("UNTIL")}
                        />
                        終了日
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input
                          type="radio"
                          name="newRepeatEnd"
                          checked={newRepeatEndType === "COUNT"}
                          onChange={() => setNewRepeatEndType("COUNT")}
                        />
                        回数
                      </label>
                    </div>

                    {newRepeatEndType === "UNTIL" && (
                      <input
                        type="date"
                        value={newRepeatUntil}
                        onChange={(e) => setNewRepeatUntil(e.target.value)}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                      />
                    )}
                    {newRepeatEndType === "COUNT" && (
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input
                          type="number"
                          min={1}
                          value={newRepeatCount}
                          onChange={(e) => setNewRepeatCount(Number(e.target.value || 1))}
                          className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-800"
                        />
                        回
                      </div>
                    )}

                    <div className="text-[11px] font-bold text-slate-500">
                      ※ 繰り返しは「毎週」のみ対応（順次拡張予定）
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-extrabold text-slate-700">ゲスト（チームメンバー）</div>
                  <div className="text-[11px] font-bold text-slate-500">{newGuestUids.length} 人</div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1">
                  {employees
                    .filter((e) => !!e.authUid && e.authUid !== user?.uid)
                    .map((emp) => {
                      const uid = emp.authUid as string;
                      const checked = newGuestUids.includes(uid);
                      return (
                        <label key={uid} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(ev) => {
                              setNewGuestUids((prev) => {
                                const s = new Set(prev);
                                if (ev.target.checked) s.add(uid);
                                else s.delete(uid);
                                return Array.from(s.values());
                              });
                            }}
                            className="h-4 w-4"
                          />
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                              style={{ backgroundColor: emp.color || "#3B82F6" }}
                            >
                              {emp.name.charAt(0)}
                            </div>
                            <div className="truncate text-xs font-bold text-slate-700">{emp.name}</div>
                          </div>
                        </label>
                      );
                    })}
                  {employees.filter((e) => !!e.authUid && e.authUid !== user?.uid).length === 0 ? (
                    <div className="text-xs font-bold text-slate-500">招待できるメンバーがいません</div>
                  ) : null}
                </div>
                <div className="mt-2 text-[10px] font-bold text-slate-500">
                  ※ 現状はチーム内メンバー（ログインユーザー）のみ招待できます
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                type="button"
              >
                キャンセル
              </button>
              <button
                onClick={() => void createEntry()}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
                type="button"
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}

      {detailOpen && activeEntry && (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setDetailOpen(false);
              setDetailEdit(false);
              setActiveEntry(null);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 rounded"
                    style={{ backgroundColor: getEmployeeColors(employees.find((e) => e.authUid === activeEntry.uid)?.color || "#3B82F6").base }}
                  />
                  <div className="truncate text-2xl font-extrabold">{entryTitle(activeEntry)}</div>
                </div>
                <div className="mt-2 text-sm text-white/70">
                  {(() => {
                    const s = new Date(activeEntry.start);
                    const e = new Date(activeEntry.end);
                    const dateText = s.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
                    return `${dateText} ・ ${formatTime(activeEntry.start)}〜${formatTime(activeEntry.end)}`;
                  })()}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(activeEntry.uid === user?.uid || user?.uid === companyOwnerUid) && (
                  <>
                    <button
                      onClick={() => setDetailEdit((v) => !v)}
                      className={clsx(
                        "rounded-lg p-2 transition-all",
                        detailEdit ? "bg-orange-600 text-white" : "bg-white/10 hover:bg-white/15 text-white/70"
                      )}
                      title="編集"
                      type="button"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => void deleteEntry()}
                      disabled={isDeleting}
                      className={clsx(
                        "rounded-lg p-2 transition-all",
                        recurringDeleteOpen ? "bg-rose-600 text-white" : "bg-white/10 hover:bg-white/15 text-white/70",
                        isDeleting && "opacity-50 cursor-not-allowed"
                      )}
                      title="削除"
                      type="button"
                    >
                      {isDeleting ? (
                        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0H7m2 0V5a2 2 0 012-2h2a2 2 0 012 2v2" />
                        </svg>
                      )}
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setDetailOpen(false);
                    setDetailEdit(false);
                    setRecurringDeleteOpen(false);
                    setActiveEntry(null);
                  }}
                  className="rounded-lg bg-white/10 p-2 hover:bg-white/15 text-white/70"
                  title="閉じる"
                  type="button"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {!detailEdit ? (
                <>
                  {activeEntry.summary ? (
                    <div className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{activeEntry.summary}</div>
                  ) : (
                    <div className="text-sm text-white/50">メモはありません</div>
                  )}

                  <div className="flex items-center gap-3 text-sm text-white/70">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-white/50">担当</span>
                      <span className="font-extrabold text-white">{actorNameFor(activeEntry.uid)}</span>
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl bg-white/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-extrabold text-white">ゲスト</div>
                      <div className="text-xs font-bold text-white/60">
                        {(activeEntry.guestUids?.length || 0) + 1} 人
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {/* 主催者 */}
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold text-white"
                          style={{ backgroundColor: colorForUid(activeEntry.uid) }}
                        >
                          {avatarLetterFor(activeEntry.uid)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-white truncate">{actorNameFor(activeEntry.uid)}</div>
                          <div className="text-xs font-bold text-white/50">主催者</div>
                        </div>
                      </div>
                      {/* ゲスト */}
                      {(activeEntry.guestUids || []).map((uid) => (
                        <div key={uid} className="flex items-center gap-3">
                          <div
                            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold text-white"
                            style={{ backgroundColor: colorForUid(uid) }}
                          >
                            {avatarLetterFor(uid)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white/90 truncate">{actorNameFor(uid)}</div>
                          </div>
                        </div>
                      ))}
                      {(!activeEntry.guestUids || activeEntry.guestUids.length === 0) ? (
                        <div className="text-xs font-bold text-white/50">ゲストはいません</div>
                      ) : null}
                    </div>
                  </div>

                  {(() => {
                    const url = firstUrl(`${entryTitle(activeEntry)}\n${activeEntry.summary || ""}`);
                    if (!url) return null;
                    return (
                      <div className="pt-2">
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-5 py-2 text-sm font-extrabold text-blue-100 hover:bg-blue-500/30"
                        >
                          リンクを開く →
                        </a>
                        <div className="mt-2 text-xs text-white/50 break-all">{url}</div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="rounded-xl bg-white p-4 text-slate-900">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs font-extrabold text-slate-500">日付</div>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          disabled={!!activeEntry.repeat}
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                        />
                        {activeEntry.repeat ? (
                          <div className="mt-1 text-[10px] font-bold text-slate-500">
                            ※ 繰り返しの予定は「日付の個別変更」は未対応です（現状はシリーズ全体の編集になります）
                          </div>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs font-extrabold text-slate-500">開始</div>
                          <input
                            type="time"
                            value={editStartTime}
                            onChange={(e) => setEditStartTime(e.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                          />
                        </div>
                        <div>
                          <div className="text-xs font-extrabold text-slate-500">終了</div>
                          <input
                            type="time"
                            value={editEndTime}
                            onChange={(e) => setEditEndTime(e.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-extrabold text-slate-500">案件/作業名</div>
                      <input
                        value={editProject}
                        onChange={(e) => setEditProject(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                      />
                    </div>

                    <div>
                      <div className="text-xs font-extrabold text-slate-500">メモ（任意）</div>
                      <input
                        value={editSummary}
                        onChange={(e) => setEditSummary(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                      />
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-extrabold text-slate-700">繰り返し</div>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={editRepeatEnabled}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setEditRepeatEnabled(checked);
                              if (checked) {
                                // 初回ON時は「当日の曜日」を自動選択（ユーザーが既に選んでいる場合は上書きしない）
                                setEditRepeatByWeekday((prev) => {
                                  if (prev.length > 0) return prev;
                                  const d = new Date(`${editDate}T00:00:00`);
                                  return [d.getDay()];
                                });
                              }
                            }}
                            className="h-4 w-4"
                          />
                          毎週
                        </label>
                      </div>

                      {editRepeatEnabled && (
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <span>繰り返し間隔</span>
                            <input
                              type="number"
                              min={1}
                              value={editRepeatInterval}
                              onChange={(e) => setEditRepeatInterval(Number(e.target.value || 1))}
                              className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-800"
                            />
                            <span>週ごと</span>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {WEEKDAY_LABELS.map((lbl, idx) => {
                              const on = editRepeatByWeekday.includes(idx);
                              return (
                                <button
                                  key={lbl}
                                  type="button"
                                  onClick={() => {
                                    setEditRepeatByWeekday((prev) => {
                                      const s = new Set(prev);
                                      if (s.has(idx)) s.delete(idx);
                                      else s.add(idx);
                                      return Array.from(s.values()).sort((a, b) => a - b);
                                    });
                                  }}
                                  className={clsx(
                                    "h-8 w-8 rounded-full text-xs font-extrabold transition",
                                    on ? "bg-orange-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                                  )}
                                  title={lbl}
                                >
                                  {lbl}
                                </button>
                              );
                            })}
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                              <input
                                type="radio"
                                name="editRepeatEnd"
                                checked={editRepeatEndType === "NONE"}
                                onChange={() => setEditRepeatEndType("NONE")}
                              />
                              終了なし
                            </label>
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                              <input
                                type="radio"
                                name="editRepeatEnd"
                                checked={editRepeatEndType === "UNTIL"}
                                onChange={() => setEditRepeatEndType("UNTIL")}
                              />
                              終了日
                            </label>
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                              <input
                                type="radio"
                                name="editRepeatEnd"
                                checked={editRepeatEndType === "COUNT"}
                                onChange={() => setEditRepeatEndType("COUNT")}
                              />
                              回数
                            </label>
                          </div>

                          {editRepeatEndType === "UNTIL" && (
                            <input
                              type="date"
                              value={editRepeatUntil}
                              onChange={(e) => setEditRepeatUntil(e.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                            />
                          )}
                          {editRepeatEndType === "COUNT" && (
                            <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                              <input
                                type="number"
                                min={1}
                                value={editRepeatCount}
                                onChange={(e) => setEditRepeatCount(Number(e.target.value || 1))}
                                className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-800"
                              />
                              回
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-extrabold text-slate-700">ゲスト（チームメンバー）</div>
                        <div className="text-[11px] font-bold text-slate-500">
                          {editGuestUids.length} 人
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-1">
                        {employees
                          .filter((e) => !!e.authUid && e.authUid !== activeEntry.uid)
                          .map((emp) => {
                            const uid = emp.authUid as string;
                            const checked = editGuestUids.includes(uid);
                            return (
                              <label key={uid} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(ev) => {
                                    setEditGuestUids((prev) => {
                                      const s = new Set(prev);
                                      if (ev.target.checked) s.add(uid);
                                      else s.delete(uid);
                                      return Array.from(s.values());
                                    });
                                  }}
                                  className="h-4 w-4"
                                />
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                                    style={{ backgroundColor: emp.color || "#3B82F6" }}
                                  >
                                    {emp.name.charAt(0)}
                                  </div>
                                  <div className="truncate text-xs font-bold text-slate-700">{emp.name}</div>
                                </div>
                              </label>
                            );
                          })}
                        {employees.filter((e) => !!e.authUid && e.authUid !== activeEntry.uid).length === 0 ? (
                          <div className="text-xs font-bold text-slate-500">招待できるメンバーがいません</div>
                        ) : null}
                      </div>
                      <div className="mt-2 text-[10px] font-bold text-slate-500">
                        ※ 現状はチーム内メンバー（ログインユーザー）のみ招待できます
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      onClick={() => setDetailEdit(false)}
                      className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                      type="button"
                    >
                      戻る
                    </button>
                    <button
                      onClick={() => void saveEntryEdit()}
                      disabled={isDeleting}
                      className="flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:opacity-50"
                      type="button"
                    >
                      {isDeleting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>

            {recurringDeleteOpen && activeEntry.repeat && (
              <div className="fixed inset-0 z-[80]">
                <div className="absolute inset-0 bg-black/60" onClick={() => !isDeleting && setRecurringDeleteOpen(false)} />
                <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-slate-900">繰り返し予定の削除</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        対象日: {activeOccurrenceDateKey || toDateKey(new Date(activeEntry.start))}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setRecurringDeleteOpen(false)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      title="閉じる"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      disabled={isDeleting}
                      className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-50 active:scale-[0.99]"
                      onClick={async () => {
                        if (!confirm("この回だけ削除しますか？")) return;
                        await deleteRecurringOne();
                        setRecurringDeleteOpen(false);
                        setDetailOpen(false);
                        setActiveEntry(null);
                        const employeeUids = employees.map((e) => e.authUid).filter((id): id is string => !!id);
                        await loadEntries(profile?.companyCode || "", employeeUids);
                      }}
                    >
                      {isDeleting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                      この予定だけ削除
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-50 active:scale-[0.99]"
                      onClick={async () => {
                        if (!confirm("この日以降の繰り返しを全て削除しますか？")) return;
                        await deleteRecurringFromThisDay();
                        setRecurringDeleteOpen(false);
                        setDetailOpen(false);
                        setActiveEntry(null);
                        const employeeUids = employees.map((e) => e.authUid).filter((id): id is string => !!id);
                        await loadEntries(profile?.companyCode || "", employeeUids);
                      }}
                    >
                      {isDeleting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                      その日以降の全てを削除
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      className="flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-rose-700 disabled:opacity-50 active:scale-[0.99]"
                      onClick={async () => {
                        if (!confirm("過去も含めて全て削除しますか？")) return;
                        await deleteRecurringAll();
                        setRecurringDeleteOpen(false);
                        setDetailOpen(false);
                        setActiveEntry(null);
                        const employeeUids = employees.map((e) => e.authUid).filter((id): id is string => !!id);
                        await loadEntries(profile?.companyCode || "", employeeUids);
                      }}
                    >
                      {isDeleting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                      過去も含めて全て削除
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      className="mt-1 rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => setRecurringDeleteOpen(false)}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
