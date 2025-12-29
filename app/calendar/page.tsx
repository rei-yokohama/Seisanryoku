"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  companyName?: string | null;
  email?: string | null;
  companyCode: string;
  calendarLinked?: boolean;
};

type TimeEntry = {
  id: string;
  uid: string;
  companyCode: string;
  project: string;
  summary: string;
  start: string;
  end: string;
};

type ViewMode = "day" | "week" | "month";

// プロジェクトカラーのマッピング
const PROJECT_COLORS: Record<string, { bg: string; border: string; text: string; light: string }> = {
  開発: { bg: "bg-blue-500", border: "border-blue-600", text: "text-blue-900", light: "bg-blue-100" },
  会議: { bg: "bg-green-500", border: "border-green-600", text: "text-green-900", light: "bg-green-100" },
  営業: { bg: "bg-purple-500", border: "border-purple-600", text: "text-purple-900", light: "bg-purple-100" },
  設計: { bg: "bg-orange-500", border: "border-orange-600", text: "text-orange-900", light: "bg-orange-100" },
  レビュー: { bg: "bg-pink-500", border: "border-pink-600", text: "text-pink-900", light: "bg-pink-100" },
  その他: { bg: "bg-gray-500", border: "border-gray-600", text: "text-gray-900", light: "bg-gray-100" },
};

const getProjectColor = (project: string) => {
  return PROJECT_COLORS[project] || PROJECT_COLORS["その他"];
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};

// ローカル日付(YYYY-MM-DD)を安定して作る（toISOString() はUTCなので日付がズレることがある）
const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const calculateDuration = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = endDate.getTime() - startDate.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return { hours, minutes, totalMinutes: Math.floor(diff / (1000 * 60)) };
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function CalendarInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // day/week の「時間軸」と「グリッド」の縦スクロール同期用
  const dayTimeAxisRef = useRef<HTMLDivElement | null>(null);
  const dayGridScrollRef = useRef<HTMLDivElement | null>(null);
  const weekTimeAxisRef = useRef<HTMLDivElement | null>(null);
  const weekGridScrollRef = useRef<HTMLDivElement | null>(null);

  const syncDayScroll = useCallback((source: "grid" | "axis") => {
    const axis = dayTimeAxisRef.current;
    const grid = dayGridScrollRef.current;
    if (!axis || !grid) return;
    const from = source === "grid" ? grid : axis;
    const to = source === "grid" ? axis : grid;
    if (to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
  }, []);

  const syncWeekScroll = useCallback((source: "grid" | "axis") => {
    const axis = weekTimeAxisRef.current;
    const grid = weekGridScrollRef.current;
    if (!axis || !grid) return;
    const from = source === "grid" ? grid : axis;
    const to = source === "grid" ? axis : grid;
    if (to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
  }, []);

  // グリッド上端からのクリック位置(px)を「15分刻みの時刻」に変換（境界の揺れを抑えて常に安定）
  const snapTimeFromGridY = useCallback((yPx: number, hourHeightPx: number) => {
    const totalMinutesRaw = (yPx / hourHeightPx) * 60;
    // 境界のブレを抑えるために微小値を引く（ちょうど境界で下側に落ちるのを防ぐ）
    const snapped = Math.floor((totalMinutesRaw - 0.0001) / 15) * 15;
    const clamped = Math.max(0, Math.min(snapped, 23 * 60 + 45)); // 0:00〜23:45
    return { hour: Math.floor(clamped / 60), minute: clamped % 60 };
  }, []);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const view = searchParams.get("view");
    return view === "day" || view === "week" || view === "month" ? view : "month";
  });
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [miniCalendarDate, setMiniCalendarDate] = useState(new Date());
  const [prefillApplied, setPrefillApplied] = useState(false);

  // ビュー変更時にURLパラメータを更新して状態維持
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "month") {
      params.delete("view");
    } else {
      params.set("view", mode);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Backlog（課題）側からの「工数追加」導線: /calendar?create=1&prefillSummary=...&prefillProject=...
  useEffect(() => {
    if (prefillApplied) return;
    const create = searchParams.get("create");
    if (create !== "1") return;

    const prefillSummary = searchParams.get("prefillSummary") || "";
    const prefillProject = searchParams.get("prefillProject") || "開発";
    const prefillDate = searchParams.get("prefillDate"); // YYYY-MM-DD
    const prefillTime = searchParams.get("prefillTime"); // HH:mm

    const targetDate = prefillDate ? new Date(`${prefillDate}T00:00:00`) : currentDate;
    const dateStr = formatLocalDate(targetDate);
    const startTime = prefillTime && /^\d{2}:\d{2}$/.test(prefillTime) ? prefillTime : "09:00";
    const startDateTime = new Date(`${dateStr}T${startTime}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    setCurrentDate(targetDate);
    setEventForm({
      project: prefillProject,
      summary: prefillSummary,
      startDate: dateStr,
      startTime,
      endDate: formatLocalDate(endDateTime),
      endTime: `${endDateTime.getHours().toString().padStart(2, "0")}:${endDateTime.getMinutes().toString().padStart(2, "0")}`,
    });
    setSelectedEntry(null);
    setShowEventModal(true);
    setPrefillApplied(true);
  }, [searchParams, currentDate, prefillApplied]);

  const [eventForm, setEventForm] = useState({
    project: "開発",
    summary: "",
    startDate: "",
    startTime: "09:00",
    endDate: "",
    endTime: "10:00",
  });

  const loadEntries = useCallback(
    async (uid: string) => {
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
        const q = query(
          collection(db, "timeEntries"),
          where("uid", "==", uid),
          where("start", ">=", start.toISOString()),
          where("start", "<=", end.toISOString())
        );
        
        const snap = await getDocs(q);
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeEntry));
        setEntries(items);
      } catch (error) {
        console.error("Error loading entries:", error);
        setEntries([]);
      }
    },
    [currentDate, viewMode]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/employee-login");
        return;
      }

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (profSnap.exists()) {
        const data = profSnap.data() as MemberProfile;
        setProfile(data);
        
        // 会社情報の確認（管理者の場合はチームカレンダーへリダイレクト）
        if (data.companyCode) {
          const compSnap = await getDoc(doc(db, "companies", data.companyCode));
          if (compSnap.exists() && compSnap.data().ownerUid === u.uid) {
            router.push("/calendar/team");
            return;
          }
          await loadEntries(u.uid);
        } else {
          await loadEntries(u.uid);
        }
      } else {
        const defaultProfile: MemberProfile = {
          uid: u.uid,
          displayName: u.displayName,
          email: u.email,
          companyCode: "",
          calendarLinked: false,
        };
        setProfile(defaultProfile);
        await loadEntries(u.uid);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [router, loadEntries]);

  // currentDateが変更されたらminiCalendarDateも同期
  useEffect(() => {
    setMiniCalendarDate(currentDate);
  }, [currentDate]);

  const weekDays = useMemo(() => {
    if (viewMode !== "week") return [];
    const day = currentDate.getDay();
    const start = new Date(currentDate);
    start.setDate(currentDate.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return date;
    });
  }, [currentDate, viewMode]);

  const daysInMonth = useMemo(() => {
    if (viewMode !== "month") return [];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const numDays = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= numDays; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [currentDate, viewMode]);

  const getDayEntries = (day: Date) => {
    return entries
      .filter((entry) => {
        const entryDate = new Date(entry.start);
        return (
          entryDate.getDate() === day.getDate() &&
          entryDate.getMonth() === day.getMonth() &&
          entryDate.getFullYear() === day.getFullYear()
        );
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  };

  const monthSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    entries.forEach((entry) => {
      const duration = calculateDuration(entry.start, entry.end);
      if (!summary[entry.project]) {
        summary[entry.project] = 0;
      }
      summary[entry.project] += duration.totalMinutes;
    });
    return Object.entries(summary)
      .map(([project, minutes]) => ({
        project,
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
        totalMinutes: minutes,
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [entries]);

  const totalHours = useMemo(() => {
    const total = monthSummary.reduce((sum, item) => sum + item.totalMinutes, 0);
    return {
      hours: Math.floor(total / 60),
      minutes: total % 60,
    };
  }, [monthSummary]);

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

  const openCreateModal = (day?: Date, hour?: number, minute?: number) => {
    const targetDate = day || currentDate;
    const dateStr = formatLocalDate(targetDate);
    const startHour = hour !== undefined ? hour : 9;
    const startMinute = minute !== undefined ? minute : 0;
    const startTime = `${startHour.toString().padStart(2, "0")}:${startMinute.toString().padStart(2, "0")}`;
    
    // 終了時刻は開始から1時間後（24時跨ぎも正しく扱う）
    const startDateTime = new Date(`${dateStr}T${startTime}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
    const endDateStr = formatLocalDate(endDateTime);
    const endTime = `${endDateTime.getHours().toString().padStart(2, "0")}:${endDateTime.getMinutes().toString().padStart(2, "0")}`;
    
    setEventForm({
      project: "開発",
      summary: "",
      startDate: dateStr,
      startTime: startTime,
      endDate: endDateStr,
      endTime: endTime,
    });
    setSelectedEntry(null);
    setShowEventModal(true);
  };

  const openEditModal = (entry: TimeEntry) => {
    const startDate = new Date(entry.start);
    const endDate = new Date(entry.end);
    setEventForm({
      project: entry.project,
      summary: entry.summary,
      startDate: formatLocalDate(startDate),
      startTime: formatTime(entry.start),
      endDate: formatLocalDate(endDate),
      endTime: formatTime(entry.end),
    });
    setSelectedEntry(entry);
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    if (!user || !profile) {
      alert("ユーザー情報が読み込まれていません");
      return;
    }

    const startDateTime = new Date(`${eventForm.startDate}T${eventForm.startTime}`);
    const endDateTime = new Date(`${eventForm.endDate}T${eventForm.endTime}`);

    if (startDateTime >= endDateTime) {
      alert("終了時刻は開始時刻より後にしてください");
      return;
    }

    try {
      if (selectedEntry) {
        await updateDoc(doc(db, "timeEntries", selectedEntry.id), {
          project: eventForm.project,
          summary: eventForm.summary,
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
        });
      } else {
        await addDoc(collection(db, "timeEntries"), {
          uid: user.uid,
          companyCode: profile.companyCode || "",
          project: eventForm.project,
          summary: eventForm.summary,
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
        });
      }

      await loadEntries(user.uid);
      setShowEventModal(false);
    } catch (error) {
      console.error("Error saving event:", error);
      alert(`予定の保存に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`);
    }
  };

  const handleDeleteEvent = async () => {
    if (!selectedEntry || !user || !profile) return;

    if (!confirm("この予定を削除してもよろしいですか？")) return;

    try {
      await deleteDoc(doc(db, "timeEntries", selectedEntry.id));
      await loadEntries(user.uid);
      setShowEventModal(false);
    } catch (error) {
      console.error("Error deleting event:", error);
      alert(`予定の削除に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`);
    }
  };

  const renderDayView = () => {
    const dayEntries = getDayEntries(currentDate);
    const isToday =
      currentDate.getDate() === new Date().getDate() &&
      currentDate.getMonth() === new Date().getMonth() &&
      currentDate.getFullYear() === new Date().getFullYear();

    return (
      <div className="flex h-full overflow-hidden bg-white rounded-lg border border-gray-200">
        {/* 時間軸 */}
        <div
          ref={dayTimeAxisRef}
          onScroll={() => syncDayScroll("axis")}
          className="w-16 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto"
        >
          {/* 右側のstickyヘッダーと同じ挙動にしてズレを防ぐ */}
          <div className="sticky top-0 z-20 h-14 border-b border-gray-200 bg-white"></div>
          {HOURS.map((hour) => (
            <div key={hour} className="relative h-20">
              <div className="absolute -top-2.5 right-2 text-xs text-gray-500">
                {hour === 0 ? "" : `${hour}:00`}
              </div>
              <div className="absolute top-1/2 right-0 left-0 h-px bg-gray-100"></div>
            </div>
          ))}
        </div>

        {/* イベントエリア */}
        <div
          ref={dayGridScrollRef}
          onScroll={() => syncDayScroll("grid")}
          className="flex-1 overflow-y-auto relative"
        >
          <div className="sticky top-0 z-10 flex h-14 items-center justify-center border-b border-gray-200 bg-white shadow-sm">
            <div className={`text-center ${isToday ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
              <div className="text-xs font-medium uppercase mb-1">
                {["日", "月", "火", "水", "木", "金", "土"][currentDate.getDay()]}
              </div>
              <div className={`flex items-center justify-center ${isToday ? "h-9 w-9 rounded-full bg-blue-600 text-white font-bold text-xl mx-auto" : "text-2xl"}`}>
                {currentDate.getDate()}
              </div>
            </div>
          </div>

          {/* グリッド（クリック位置→時刻の計算を全体基準にして安定化） */}
          <div
            className="relative"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const t = snapTimeFromGridY(y, 80); // day: 1時間=80px
              openCreateModal(currentDate, t.hour, t.minute);
            }}
          >
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="h-20 border-b border-gray-100 hover:bg-gray-50 cursor-pointer relative"
              >
                {/* 30分のライン */}
                <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-100"></div>
              </div>
            ))}

            {/* イベント */}
            {dayEntries.map((entry) => {
              const start = new Date(entry.start);
              const end = new Date(entry.end);
              const startHour = start.getHours();
              const startMinute = start.getMinutes();
              const endHour = end.getHours();
              const endMinute = end.getMinutes();
              
              const top = (startHour + startMinute / 60) * 80;
              const height = Math.max(((endHour + endMinute / 60) - (startHour + startMinute / 60)) * 80, 20);
              
              const color = getProjectColor(entry.project);

              return (
                <div
                  key={entry.id}
                  className={`absolute left-2 right-2 cursor-pointer overflow-hidden rounded-md border-l-4 ${color.border} ${color.light} p-2 shadow-sm hover:shadow-md transition-shadow z-10`}
                  style={{ top: `${top}px`, height: `${height}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditModal(entry);
                  }}
                >
                  <div className="text-xs font-bold text-gray-900 truncate">{entry.project}</div>
                  <div className="text-xs text-gray-700 truncate">
                    {formatTime(entry.start)} - {formatTime(entry.end)}
                  </div>
                  {entry.summary && (
                    <div className="text-xs text-gray-600 truncate mt-1">{entry.summary}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    return (
      <div className="flex h-full overflow-hidden bg-white rounded-lg border border-gray-200">
        {/* 時間軸 */}
        <div
          ref={weekTimeAxisRef}
          onScroll={() => syncWeekScroll("axis")}
          className="w-16 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto"
        >
          {/* 週表示もヘッダーをstickyにしてズレを防ぐ */}
          <div className="sticky top-0 z-20 h-14 border-b border-gray-200 bg-white"></div>
          {HOURS.map((hour) => (
            <div key={hour} className="relative h-16">
              <div className="absolute -top-2 right-2 text-xs text-gray-500">
                {hour === 0 ? "" : `${hour}:00`}
              </div>
              <div className="absolute top-1/2 right-0 left-0 h-px bg-gray-100"></div>
            </div>
          ))}
        </div>

        {/* 週の各日 */}
        <div
          ref={weekGridScrollRef}
          onScroll={() => syncWeekScroll("grid")}
          className="flex-1 flex overflow-auto"
        >
          {weekDays.map((day, dayIndex) => {
            const dayEntries = getDayEntries(day);
            const isToday =
              day.getDate() === new Date().getDate() &&
              day.getMonth() === new Date().getMonth() &&
              day.getFullYear() === new Date().getFullYear();

            return (
              <div key={dayIndex} className="flex-1 min-w-[120px] border-r border-gray-200 last:border-r-0 overflow-hidden">
                <div className="sticky top-0 z-10 flex h-14 items-center justify-center border-b border-gray-200 bg-white shadow-sm">
                  <div className={`text-center ${isToday ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                    <div className="text-xs font-medium uppercase mb-1">
                      {["日", "月", "火", "水", "木", "金", "土"][day.getDay()]}
                    </div>
                    <div className={`flex items-center justify-center ${isToday ? "h-8 w-8 rounded-full bg-blue-600 text-white font-bold text-lg mx-auto" : "text-xl"}`}>
                      {day.getDate()}
                    </div>
                  </div>
                </div>

                {/* グリッド */}
                <div
                  className="relative"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const t = snapTimeFromGridY(y, 64); // week: 1時間=64px
                    openCreateModal(day, t.hour, t.minute);
                  }}
                >
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="h-16 border-b border-gray-100 hover:bg-gray-50 cursor-pointer relative"
                    >
                      <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-100"></div>
                    </div>
                  ))}

                  {/* イベント */}
                  {dayEntries.map((entry) => {
                    const start = new Date(entry.start);
                    const end = new Date(entry.end);
                    const startHour = start.getHours();
                    const startMinute = start.getMinutes();
                    const endHour = end.getHours();
                    const endMinute = end.getMinutes();
                    
                    const top = (startHour + startMinute / 60) * 64;
                    const height = Math.max(((endHour + endMinute / 60) - (startHour + startMinute / 60)) * 64, 18);
                    
                    const color = getProjectColor(entry.project);

                    return (
                      <div
                        key={entry.id}
                        className={`absolute left-1 right-1 cursor-pointer overflow-hidden rounded border-l-3 ${color.border} ${color.light} p-1 text-xs shadow-sm hover:shadow-md transition-shadow z-10`}
                        style={{ top: `${top}px`, height: `${height}px` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(entry);
                        }}
                      >
                        <div className="font-bold text-gray-900 truncate">{entry.project}</div>
                        <div className="text-gray-700 truncate text-[10px]">{entry.summary}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
            <div
              key={day}
              className={`border-r border-gray-200 py-3 text-center text-sm font-semibold last:border-r-0 ${
                index === 0 ? "text-red-600" : index === 6 ? "text-blue-600" : "text-gray-700"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* カレンダーグリッド */}
        <div className="grid grid-cols-7">
          {daysInMonth.map((day, index) => {
            const dayEntries = day ? getDayEntries(day) : [];
            const isToday =
              day &&
              day.getDate() === new Date().getDate() &&
              day.getMonth() === new Date().getMonth() &&
              day.getFullYear() === new Date().getFullYear();

            return (
              <div
                key={index}
                className={`min-h-[120px] cursor-pointer border-r border-b border-gray-100 bg-white p-2 last:border-r-0 hover:bg-gray-50 transition-colors ${
                  !day ? "bg-gray-50/50" : ""
                }`}
                onClick={() => day && openCreateModal(day, 9, 0)}
              >
                {day && (
                  <>
                    <div className="mb-1 flex justify-center">
                      <span
                        className={`flex h-7 w-7 items-center justify-center text-sm font-medium ${
                          isToday
                            ? "rounded-full bg-blue-600 text-white font-bold"
                            : day.getDay() === 0
                            ? "text-red-600"
                            : day.getDay() === 6
                            ? "text-blue-600"
                            : "text-gray-700"
                        }`}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {dayEntries.slice(0, 3).map((entry) => {
                        const color = getProjectColor(entry.project);
                        return (
                          <div
                            key={entry.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(entry);
                            }}
                            className={`cursor-pointer rounded-sm border-l-2 ${color.border} ${color.light} px-1.5 py-0.5 text-xs hover:opacity-90 transition-opacity`}
                          >
                            <div className="font-semibold text-gray-900 truncate">
                              <span className="text-[10px]">{formatTime(entry.start)}</span> {entry.project}
                            </div>
                            {entry.summary && (
                              <div className="truncate text-gray-700 text-[10px]">{entry.summary}</div>
                            )}
                          </div>
                        );
                      })}
                      {dayEntries.length > 3 && (
                        <div className="text-[10px] text-gray-500 font-medium pl-1">
                          +{dayEntries.length - 3} 件
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ミニカレンダーの日付配列を生成
  const getMiniCalendarDays = () => {
    const year = miniCalendarDate.getFullYear();
    const month = miniCalendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const numDays = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= numDays; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const goToPreviousMiniMonth = () => {
    const newDate = new Date(miniCalendarDate);
    newDate.setMonth(miniCalendarDate.getMonth() - 1);
    setMiniCalendarDate(newDate);
  };

  const goToNextMiniMonth = () => {
    const newDate = new Date(miniCalendarDate);
    newDate.setMonth(miniCalendarDate.getMonth() + 1);
    setMiniCalendarDate(newDate);
  };

  const handleMiniCalendarDateClick = (date: Date) => {
    setCurrentDate(date);
    // 日ビューに自動切り替え
    changeViewMode("day");
  };

  const renderMiniCalendar = () => {
    const miniDays = getMiniCalendarDays();
    
    return (
      <div className="w-64 border-r border-gray-200 bg-white p-4">
        {/* ミニカレンダーヘッダー */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            {miniCalendarDate.getFullYear()}年 {miniCalendarDate.getMonth() + 1}月
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPreviousMiniMonth}
              className="rounded-full p-1 hover:bg-gray-100 transition"
            >
              <svg className="h-4 w-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={goToNextMiniMonth}
              className="rounded-full p-1 hover:bg-gray-100 transition"
            >
              <svg className="h-4 w-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 曜日ヘッダー */}
        <div className="mb-1 grid grid-cols-7 gap-1">
          {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
            <div
              key={day}
              className={`text-center text-xs font-medium ${
                index === 0 ? "text-red-500" : index === 6 ? "text-blue-500" : "text-gray-600"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* カレンダーグリッド */}
        <div className="grid grid-cols-7 gap-1">
          {miniDays.map((day, index) => {
            if (!day) {
              return <div key={index} className="aspect-square"></div>;
            }

            const isToday =
              day.getDate() === new Date().getDate() &&
              day.getMonth() === new Date().getMonth() &&
              day.getFullYear() === new Date().getFullYear();

            const isSelected =
              day.getDate() === currentDate.getDate() &&
              day.getMonth() === currentDate.getMonth() &&
              day.getFullYear() === currentDate.getFullYear();

            const dayEntries = getDayEntries(day);

            return (
              <button
                key={index}
                onClick={() => handleMiniCalendarDateClick(day)}
                className={`aspect-square flex flex-col items-center justify-center rounded-full text-xs font-medium transition-colors ${
                  isToday && !isSelected
                    ? "bg-blue-100 text-blue-700 font-bold"
                    : isSelected
                    ? "bg-blue-600 text-white font-bold"
                    : day.getDay() === 0
                    ? "text-red-600 hover:bg-gray-100"
                    : day.getDay() === 6
                    ? "text-blue-600 hover:bg-gray-100"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {day.getDate()}
                {dayEntries.length > 0 && !isSelected && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dayEntries.slice(0, 3).map((_, i) => (
                      <div key={i} className="h-1 w-1 rounded-full bg-blue-500"></div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* 作成ボタン */}
        <button
          onClick={() => openCreateModal()}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:shadow transition-all"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>作成</span>
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <AppShell title="カレンダー">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return null;
  }

  const getDateRangeText = () => {
    if (viewMode === "day") {
      return `${currentDate.getFullYear()}年 ${currentDate.getMonth() + 1}月 ${currentDate.getDate()}日`;
    } else if (viewMode === "week") {
      const start = weekDays[0];
      const end = weekDays[6];
      if (start.getMonth() === end.getMonth()) {
        return `${start.getFullYear()}年 ${start.getMonth() + 1}月 ${start.getDate()}日 - ${end.getDate()}日`;
      } else {
        return `${start.getFullYear()}年 ${start.getMonth() + 1}月 ${start.getDate()}日 - ${end.getMonth() + 1}月 ${end.getDate()}日`;
      }
    } else {
      return `${currentDate.getFullYear()}年 ${currentDate.getMonth() + 1}月`;
    }
  };

  return (
    <AppShell title="カレンダー" subtitle={getDateRangeText()}>
      <div className="flex h-full min-h-0 flex-col -mx-3 -my-4 sm:-mx-6 sm:-my-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={goToToday}
              className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50 transition"
            >
              今日
            </button>
            <div className="flex items-center gap-1">
              <button onClick={goToPrevious} className="rounded-full p-2 hover:bg-emerald-50 text-emerald-900 transition" aria-label="前へ">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button onClick={goToNext} className="rounded-full p-2 hover:bg-emerald-50 text-emerald-900 transition" aria-label="次へ">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="text-sm font-extrabold text-slate-800">{getDateRangeText()}</div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
              <button
                onClick={() => changeViewMode("day")}
                className={`px-4 py-2 text-sm font-bold transition ${
                  viewMode === "day" ? "bg-emerald-100 text-emerald-900" : "text-slate-700 hover:bg-emerald-50"
                }`}
              >
                日
              </button>
              <button
                onClick={() => changeViewMode("week")}
                className={`border-l border-emerald-200 px-4 py-2 text-sm font-bold transition ${
                  viewMode === "week" ? "bg-emerald-100 text-emerald-900" : "text-slate-700 hover:bg-emerald-50"
                }`}
              >
                週
              </button>
              <button
                onClick={() => changeViewMode("month")}
                className={`border-l border-emerald-200 px-4 py-2 text-sm font-bold transition ${
                  viewMode === "month" ? "bg-emerald-100 text-emerald-900" : "text-slate-700 hover:bg-emerald-50"
                }`}
              >
                月
              </button>
            </div>
            <button
              onClick={() => setShowSummaryModal(true)}
              className="rounded-lg bg-gradient-to-r from-emerald-300 to-emerald-500 px-4 py-2 text-sm font-extrabold text-emerald-950 shadow hover:shadow-md transition-all"
            >
              月次サマリー
            </button>
            <Link
              href="/calendar/team"
              className="rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50 transition"
            >
              チームカレンダー
            </Link>
          </div>
        </div>

        {/* Calendar Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar - Mini Calendar */}
        {renderMiniCalendar()}

        {/* Main Calendar Area */}
        <main className="flex-1 overflow-hidden p-6 bg-gray-50">
          {viewMode === "day" && renderDayView()}
          {viewMode === "week" && renderWeekView()}
          {viewMode === "month" && renderMonthView()}
        </main>
      </div>

      {/* Event Modal - Google Calendar Style */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-2xl rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <button
                onClick={() => setShowEventModal(false)}
                className="rounded-full p-2 hover:bg-gray-100 transition"
              >
                <svg className="h-6 w-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[80vh] overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Title Input */}
                <div>
                  <input
                    type="text"
                    value={eventForm.summary}
                    onChange={(e) => setEventForm({ ...eventForm, summary: e.target.value })}
                    placeholder="タイトルを追加"
                    className="w-full border-b-2 border-gray-200 bg-transparent px-0 py-3 text-2xl text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-blue-500"
                  />
                </div>

                {/* Date and Time */}
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center text-gray-600">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <input
                        type="date"
                        value={eventForm.startDate}
                        onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value, endDate: e.target.value })}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      />
                      <input
                        type="time"
                        value={eventForm.startTime}
                        onChange={(e) => setEventForm({ ...eventForm, startTime: e.target.value })}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      />
                      <span className="text-gray-600 font-medium">-</span>
                      <input
                        type="time"
                        value={eventForm.endTime}
                        onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                  </div>
                </div>

                {/* Project Selection */}
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center text-gray-600">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <select
                      value={eventForm.project}
                      onChange={(e) => setEventForm({ ...eventForm, project: e.target.value })}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                    >
                      {Object.keys(PROJECT_COLORS).map((project) => (
                        <option key={project} value={project}>
                          {project}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-gray-200 p-4 bg-gray-50">
              <div className="flex items-center gap-2">
                {selectedEntry && (
                  <button
                    onClick={handleDeleteEvent}
                    className="rounded-full p-2 text-red-600 hover:bg-red-50 transition"
                    title="削除"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                onClick={handleSaveEvent}
                className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Modal */}
      {showSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl animate-in fade-in duration-200">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">
                {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月の工数サマリー
              </h3>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="rounded-full p-1 hover:bg-gray-100 transition"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-6 rounded-lg bg-gradient-to-r from-emerald-50 to-emerald-50 p-4 border border-emerald-200">
              <div className="text-sm text-emerald-700 font-medium">合計作業時間</div>
              <div className="text-3xl font-bold text-emerald-950">
                {totalHours.hours}時間 {totalHours.minutes}分
              </div>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {monthSummary.map((item) => {
                const color = getProjectColor(item.project);
                const percentage = totalHours.hours > 0 
                  ? Math.round((item.totalMinutes / (totalHours.hours * 60 + totalHours.minutes)) * 100)
                  : 0;

                return (
                  <div
                    key={item.project}
                    className="rounded-lg border-2 border-gray-200 bg-white p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`h-4 w-4 rounded-sm ${color.light} border-2 ${color.border}`}></div>
                        <span className="font-semibold text-gray-900">{item.project}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-900">
                          {item.hours}時間 {item.minutes}分
                        </div>
                        <div className="text-sm text-gray-500">{percentage}%</div>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={`h-full transition-all duration-500 ${color.bg}`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>

            {monthSummary.length === 0 && (
              <div className="py-12 text-center text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-lg font-semibold">今月の予定がまだ登録されていません</p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-emerald-900">読み込み中...</div>
        </div>
      }
    >
      <CalendarInner />
    </Suspense>
  );
}
