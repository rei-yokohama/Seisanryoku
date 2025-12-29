"use client";

import { useState, useEffect, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../../AppShell";

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

type Employee = {
  id: string;
  name: string;
  uid?: string;
  authUid?: string;
  color?: string; // カレンダー表示用の色
};

type ViewMode = "day" | "week" | "month";

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};

// 色コードから明るい色とボーダー色を生成
const getEmployeeColors = (baseColor: string) => {
  // デフォルトカラー
  if (!baseColor) {
    return { base: "#3B82F6", light: "#DBEAFE", border: "#2563EB" };
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

export default function TeamCalendarPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [showSidebar, setShowSidebar] = useState(true);

  const router = useRouter();

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

    // companyCodeが未設定だった過去データ救済 / companyCode不整合の救済として createdBy も併用
    console.log("チームカレンダー: createdByで社員を検索(フォールバック/併用):", uid);
    const snapByCreator = await getDocs(
      query(collection(db, "employees"), where("createdBy", "==", uid)),
    );
    merged.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));

    // id で重複排除
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    const items = Array.from(byId.values());

    console.log("チームカレンダー: 読み込んだ社員数:", items.length);
    console.log("チームカレンダー: 社員データ:", items);
    setEmployees(items);

    // デフォルトで全員選択（authUidがあるもののみ）
    const allIds = new Set(items.map(e => e.authUid).filter((id): id is string => !!id));
    console.log("チームカレンダー: authUidがある社員のID:", Array.from(allIds));
    setSelectedEmployeeIds(allIds);
    
    return items;
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

        const startMs = start.getTime();
        const endMs = end.getTime();
        const filtered = fetched.filter(e => {
          const t = new Date(e.start).getTime();
          return !Number.isNaN(t) && t >= startMs && t <= endMs;
        });

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
            
            if (companyData.ownerUid !== u.uid) {
              console.log("チームカレンダー: 管理者ではありません。カレンダーへリダイレクト");
              router.push("/calendar");
              return;
            }
            
            console.log("チームカレンダー: 管理者です。社員データを読み込みます");
            const loadedEmployees = await loadEmployees(data.companyCode, u.uid);
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
        console.log("チームカレンダー: プロフィールが見つかりません");
      }
      console.log("チームカレンダー: loading完了");
      setLoading(false);
    });
    return () => unsub();
  }, [router, loadEntries, loadEmployees]);

  // 期間変更時にデータを再ロード
  useEffect(() => {
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

  const renderSidebar = () => {
    console.log("=== renderSidebar呼び出し ===");
    console.log("showSidebar:", showSidebar);
    console.log("employees.length:", employees.length);
    console.log("employees:", employees);
    console.log("selectedEmployeeIds:", Array.from(selectedEmployeeIds));
    
    return (
      <div className={`flex w-64 flex-col border-r border-gray-200 bg-white transition-all duration-300 ${showSidebar ? "" : "-ml-64"}`}>
        <div className="p-4">
          <div className="mb-6">
            <h3 className="mb-2 px-2 text-xs font-semibold text-gray-500">マイカレンダー</h3>
            <div className="space-y-1">
              {/* 管理者自身は表示しない仕様だが、サイドバーの見た目をGoogleカレンダーに合わせるためダミーやその他を表示しても良い */}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between px-2 mb-2">
              <h3 className="text-xs font-semibold text-gray-500">チームメンバー ({employees.length})</h3>
            </div>
            <div className="space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto">
              {employees.length === 0 && (
                <div className="px-2 py-3 text-xs text-gray-400 bg-gray-50 rounded border border-gray-200">
                  <p className="mb-1 font-semibold">メンバーがいません</p>
                  <p className="text-[10px]">社員管理ページで社員を追加してください</p>
                </div>
              )}
              {employees.length > 0 && employees.every(e => !e.authUid) && (
                <div className="px-2 py-3 mb-2 text-xs text-emerald-600 bg-emerald-50 rounded border border-emerald-200">
                  <p className="font-semibold mb-1">⚠️ 社員が表示されません</p>
                  <p className="text-[10px]">社員データに認証情報がありません。社員を再作成してください。</p>
                </div>
              )}
              {employees.map((emp) => {
                console.log("レンダリング中の社員:", emp.name, "authUid:", emp.authUid);
                return (
                <label key={emp.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-emerald-50 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={emp.authUid ? selectedEmployeeIds.has(emp.authUid) : false}
                      onChange={(e) => {
                        if (!emp.authUid) return;
                        const newSet = new Set(selectedEmployeeIds);
                        if (e.target.checked) {
                          newSet.add(emp.authUid);
                        } else {
                          newSet.delete(emp.authUid);
                        }
                        setSelectedEmployeeIds(newSet);
                      }}
                      className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-emerald-300 checked:border-emerald-500 checked:bg-emerald-500 focus:ring-2 focus:ring-emerald-200"
                    />
                    <svg
                      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100"
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M3.5 6L5 7.5L8.5 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white shadow-sm"
                      style={{ backgroundColor: emp.color || "#3B82F6" }}
                    >
                      {emp.name.charAt(0)}
                    </div>
                    <span className="text-sm text-gray-700 truncate">{emp.name}</span>
                  </div>
                </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTeamDayView = () => {
    const getEmployeeEntries = (uid: string) => {
      return entries.filter((entry) => entry.uid === uid);
    };

    const displayEmployees = employees
      .map(emp => ({
        id: emp.id,
        name: emp.name,
        uid: emp.authUid,
        color: emp.color
      }))
      .filter(emp => emp.uid && selectedEmployeeIds.has(emp.uid));

    return (
      <div className="flex h-full overflow-hidden">
        {/* 時間軸 */}
        <div className="w-16 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto custom-scrollbar">
          <div className="h-12 border-b border-gray-200 bg-white sticky top-0 z-10"></div>
          {HOURS.map((hour) => (
            <div key={hour} className="h-20 border-b border-gray-100 pr-2 pt-1 text-right text-xs text-gray-500 relative">
              <span className="-top-2.5 relative">{hour === 0 ? "" : `${hour}:00`}</span>
            </div>
          ))}
        </div>

        {/* メインエリア */}
        <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
          <div className="flex min-w-max">
            {displayEmployees.length === 0 ? (
              <div className="flex h-96 w-full items-center justify-center text-gray-500">
                <div className="text-center">
                  <p className="text-lg font-semibold">表示する社員がいません</p>
                  <p className="text-sm">左のサイドバーから社員を選択してください</p>
                </div>
              </div>
            ) : (
              displayEmployees.map((emp) => {
                const empEntries = emp.uid ? getEmployeeEntries(emp.uid) : [];
                
                return (
                  <div key={emp.id} className="w-64 border-r border-gray-200 bg-white">
                    <div className="sticky top-0 z-10 flex h-12 items-center justify-center border-b border-gray-200 bg-white px-2 shadow-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                          style={{ backgroundColor: emp.color || "#3B82F6" }}
                        >
                          {emp.name.charAt(0)}
                        </div>
                        <div className="truncate text-sm font-medium text-gray-900">
                          {emp.name}
                        </div>
                      </div>
                    </div>

                    <div className="relative">
                      {/* グリッド */}
                      {HOURS.map((hour) => (
                        <div
                          key={hour}
                          className="h-20 border-b border-gray-100"
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
                        
                        const top = (startHour + startMinute / 60) * 80;
                        const height = Math.max(((endHour + endMinute / 60) - (startHour + startMinute / 60)) * 80, 20);
                        
                        const empColors = getEmployeeColors(emp.color || "#3B82F6");

                        return (
                          <div
                            key={entry.id}
                            className="absolute left-1 right-1 overflow-hidden rounded px-2 py-1 shadow-sm transition hover:shadow-md hover:z-10"
                            style={{ 
                              top: `${top}px`, 
                              height: `${height}px`,
                              backgroundColor: empColors.light,
                              borderLeft: `4px solid ${empColors.border}`
                            }}
                          >
                            <div className="text-xs font-bold text-gray-900 truncate">{entry.project}</div>
                            <div className="text-[10px] text-gray-700 truncate">
                              {formatTime(entry.start)} - {formatTime(entry.end)}
                            </div>
                            {entry.summary && (
                              <div className="text-[10px] text-slate-600 truncate">{entry.summary}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
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
        return (
          entryDate.getDate() === date.getDate() &&
          entryDate.getMonth() === date.getMonth() &&
          entryDate.getFullYear() === date.getFullYear() &&
          selectedEmployeeIds.has(entry.uid)
        );
      });
    };

    return (
      <div className="flex h-full overflow-hidden bg-white">
        <div className="w-16 flex-shrink-0 border-r border-gray-200 overflow-y-auto custom-scrollbar">
          <div className="h-16"></div>
          {HOURS.map((hour) => (
            <div key={hour} className="h-20 border-b border-gray-100 pr-2 pt-1 text-right text-xs text-gray-500 relative">
              <span className="-top-2.5 relative">{hour === 0 ? "" : `${hour}:00`}</span>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
          <div className="flex min-w-[800px]">
            {weekDays.map((date, index) => {
              const isToday =
                date.getDate() === new Date().getDate() &&
                date.getMonth() === new Date().getMonth() &&
                date.getFullYear() === new Date().getFullYear();
              const dayEntries = getDayEntries(date);

              return (
                <div key={index} className="flex-1 border-r border-gray-200 last:border-r-0 min-w-[120px]">
                  <div className="sticky top-0 z-10 flex h-16 flex-col items-center justify-center border-b border-gray-200 bg-white">
                    <div className={`text-xs font-medium uppercase mb-1 ${isToday ? "text-blue-600" : "text-gray-500"}`}>
                      {["日", "月", "火", "水", "木", "金", "土"][date.getDay()]}
                    </div>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xl ${isToday ? "bg-blue-600 text-white font-bold" : "text-gray-900"}`}>
                      {date.getDate()}
                    </div>
                  </div>

                  <div className="relative">
                    {HOURS.map((hour) => (
                      <div key={hour} className="h-20 border-b border-gray-100"></div>
                    ))}

                    {dayEntries.map((entry) => {
                      const start = new Date(entry.start);
                      const end = new Date(entry.end);
                      const startHour = start.getHours();
                      const startMinute = start.getMinutes();
                      const endHour = end.getHours();
                      const endMinute = end.getMinutes();
                      
                      const top = (startHour + startMinute / 60) * 80;
                      const height = Math.max(((endHour + endMinute / 60) - (startHour + startMinute / 60)) * 80, 20);
                      
                      const emp = employees.find(e => e.authUid === entry.uid);
                      const empColors = getEmployeeColors(emp?.color || "#3B82F6");

                      return (
                        <div
                          key={entry.id}
                          className="absolute left-1 right-1 overflow-hidden rounded px-2 py-1 shadow-sm transition hover:shadow-md hover:z-10"
                          style={{ 
                            top: `${top}px`, 
                            height: `${height}px`,
                            backgroundColor: empColors.light,
                            borderLeft: `4px solid ${empColors.border}`
                          }}
                          title={`${emp?.name || "不明"} - ${entry.project}: ${entry.summary}`}
                        >
                          <div className="flex items-center gap-1 text-xs font-bold text-gray-900">
                            <div
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: empColors.base }}
                            ></div>
                            <span className="truncate">{emp?.name || "不明"}</span>
                          </div>
                          <div className="text-xs font-semibold truncate mt-0.5">{entry.project}</div>
                          <div className="text-[10px] text-gray-700 truncate">
                            {formatTime(entry.start)} - {formatTime(entry.end)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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
        return (
          entryDate.getDate() === date.getDate() &&
          entryDate.getMonth() === date.getMonth() &&
          entryDate.getFullYear() === date.getFullYear() &&
          selectedEmployeeIds.has(entry.uid)
        );
      });
    };

    return (
      <div className="flex h-full flex-col bg-white">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-white">
          {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
            <div key={day} className={`py-2 text-center text-xs font-medium ${index === 0 ? "text-red-500" : index === 6 ? "text-blue-500" : "text-gray-500"}`}>
              {day}
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
          {days.map((day, index) => {
            if (!day) return <div key={index} className="border-b border-r border-gray-100 bg-gray-50/30" />;
            
            const isToday =
              day.getDate() === new Date().getDate() &&
              day.getMonth() === new Date().getMonth() &&
              day.getFullYear() === new Date().getFullYear();
            const dayEntries = getDayEntries(day);

            return (
              <div key={index} className="min-h-[100px] border-b border-r border-gray-100 p-1 transition hover:bg-gray-50">
                <div className="flex justify-center mb-1">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-blue-600 text-white font-bold" : "text-gray-700 font-medium"}`}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEntries.slice(0, 4).map(entry => {
                    const emp = employees.find(e => e.authUid === entry.uid);
                    const empColors = getEmployeeColors(emp?.color || "#3B82F6");
                    return (
                      <div
                        key={entry.id}
                        className="truncate rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-gray-800"
                        style={{
                          backgroundColor: empColors.light,
                          borderLeft: `2px solid ${empColors.border}`
                        }}
                      >
                        <div
                          className="inline-block h-2 w-2 rounded-full mr-1"
                          style={{ backgroundColor: empColors.base }}
                        ></div>
                        <span className="font-bold">{emp?.name?.charAt(0) || "?"}</span> {entry.project}
                      </div>
                    );
                  })}
                  {dayEntries.length > 4 && (
                    <div className="text-[10px] text-gray-500 text-center font-medium cursor-pointer hover:text-gray-700">
                      他 {dayEntries.length - 4} 件
                    </div>
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
      <AppShell title="チームカレンダー">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
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
    <AppShell title="チームカレンダー" subtitle={getDateRangeText()}>
      <div className="bg-white flex h-full min-h-0 flex-col -mx-3 -my-4 sm:-mx-6 sm:-my-6">
      {/* Header */}
      <div className="border-b border-emerald-200 bg-white px-4 py-2 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="rounded-full p-2 hover:bg-emerald-50 text-emerald-900"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-lg shadow">
              B
            </div>
            <span className="text-xl font-normal text-slate-700">チームカレンダー</span>
          </Link>
          <button
            onClick={goToToday}
            className="ml-4 rounded border border-emerald-200 bg-white px-4 py-1.5 text-sm font-bold text-emerald-900 hover:bg-emerald-50 transition"
          >
            今日
          </button>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={goToPrevious} className="rounded-full p-2 hover:bg-emerald-50">
              <svg className="h-5 w-5 text-emerald-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button onClick={goToNext} className="rounded-full p-2 hover:bg-emerald-50">
              <svg className="h-5 w-5 text-emerald-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <h2 className="ml-4 text-xl font-normal text-gray-800">
            {getDateRangeText()}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-emerald-200 bg-white shadow-sm">
            <button
              onClick={() => setViewMode("day")}
              className={`px-4 py-1.5 text-sm font-medium transition first:rounded-l-md last:rounded-r-md ${
                viewMode === "day" ? "bg-emerald-100 text-emerald-900 z-10 border-emerald-200 font-extrabold" : "text-slate-700 hover:bg-emerald-50 border-l border-transparent first:border-0"
              }`}
            >
              日
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-4 py-1.5 text-sm font-medium transition border-l border-emerald-200 ${
                viewMode === "week" ? "bg-emerald-100 text-emerald-900 z-10 border-emerald-200 font-extrabold" : "text-slate-700 hover:bg-emerald-50"
              }`}
            >
              週
            </button>
            <button
              onClick={() => setViewMode("month")}
              className={`px-4 py-1.5 text-sm font-medium transition border-l border-emerald-200 first:rounded-l-md last:rounded-r-md ${
                viewMode === "month" ? "bg-emerald-100 text-emerald-900 z-10 border-emerald-200 font-extrabold" : "text-slate-700 hover:bg-emerald-50"
              }`}
            >
              月
            </button>
          </div>
          
          <Link
            href="/calendar"
            className="ml-2 rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50 transition"
            title="個人カレンダー"
          >
            個人カレンダー
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {renderSidebar()}
        <main className="flex-1 min-h-0 overflow-hidden relative">
          {viewMode === "day" && renderTeamDayView()}
          {viewMode === "week" && renderWeekView()}
          {viewMode === "month" && renderMonthView()}
        </main>
      </div>
      </div>
    </AppShell>
  );
}
