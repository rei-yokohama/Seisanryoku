"use client";

import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut, User, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  companyName?: string | null;
  companyCode: string;
  calendarLinked?: boolean;
};

type Company = {
  code: string;
  name: string;
  ownerUid: string;
};

type Employee = {
  id: string;
  name: string;
  email: string;
  allowCalendarSync?: boolean;
  authUid?: string;
};

export default function EmployeeDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarStatus, setCalendarStatus] = useState("");
  const router = useRouter();

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
        
        // 会社情報を取得して管理者かどうかを判定
        if (data.companyCode && data.companyCode.trim() !== "") {
          const compSnap = await getDoc(doc(db, "companies", data.companyCode));
          if (compSnap.exists()) {
            const companyData = compSnap.data() as Company;
            
            // 会社のオーナーの場合は管理者用ダッシュボードにリダイレクト
            if (companyData.ownerUid === u.uid) {
              router.push("/dashboard");
              return;
            }
          }
        }
      }
      
      // 社員データを取得（authUidで検索）
      try {
        const employeesQuery = query(
          collection(db, "employees"),
          where("authUid", "==", u.uid)
        );
        const employeesSnap = await getDocs(employeesQuery);
        if (!employeesSnap.empty) {
          const employeeData = employeesSnap.docs[0].data() as Employee;
          setEmployee({ ...employeeData, id: employeesSnap.docs[0].id });
          console.log("社員データを取得:", employeeData);
        } else {
          console.log("社員データが見つかりません");
        }
      } catch (error) {
        console.error("社員データの取得に失敗:", error);
      }
      
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/");
  };

  const linkCalendar = async () => {
    if (!user) {
      alert("ログインしてください");
      return;
    }
    try {
      setCalendarStatus("連携処理中...");
      
      // Googleプロバイダーの設定
      const provider = new GoogleAuthProvider();
      // カレンダーのスコープを追加
      provider.addScope("https://www.googleapis.com/auth/calendar.events");
      provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
      // 常に承認画面を表示し、アカウント選択も表示
      provider.setCustomParameters({
        prompt: "consent",
      });

      console.log("Google OAuth認証を開始します...");
      
      // ポップアップでGoogle認証
      const result = await signInWithPopup(auth, provider);
      console.log("認証結果:", result);
      
      // 認証情報とアクセストークンを取得
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      
      console.log("アクセストークンを取得:", token ? "成功" : "失敗");

      if (token) {
        // トークンとカレンダー連携フラグをプロファイルに保存
        await setDoc(
          doc(db, "profiles", user.uid),
          { 
            calendarLinked: true,
            googleAccessToken: token,
          },
          { merge: true }
        );
        setProfile((prev) => (prev ? { ...prev, calendarLinked: true } : prev));
        setCalendarStatus("✅ カレンダー連携に成功しました！");
        setTimeout(() => setCalendarStatus(""), 3000);
      } else {
        console.error("アクセストークンが取得できませんでした");
        setCalendarStatus("❌ 連携に失敗しました。もう一度お試しください。");
        setTimeout(() => setCalendarStatus(""), 3000);
      }
    } catch (error) {
      console.error("Calendar link error:", error);
      
      const firebaseError = error as { code?: string; message?: string };
      console.error("エラーコード:", firebaseError.code);
      console.error("エラーメッセージ:", firebaseError.message);
      
      let errorMessage = "エラーが発生しました。";
      
      if (firebaseError.code === "auth/popup-closed-by-user") {
        errorMessage = "連携がキャンセルされました。";
      } else if (firebaseError.code === "auth/popup-blocked") {
        errorMessage = "ポップアップがブロックされました。ブラウザの設定を確認してください。";
      } else if (firebaseError.code === "auth/unauthorized-domain") {
        errorMessage = "このドメインは許可されていません。管理者に連絡してください。";
      } else if (firebaseError.message) {
        errorMessage = `エラー: ${firebaseError.message}`;
      }
      
      setCalendarStatus("❌ " + errorMessage);
      setTimeout(() => setCalendarStatus(""), 5000);
    }
  };

  if (loading) {
    return (
      <AppShell title="社員ダッシュボード" subtitle="Employee">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-50">
      {/* Header */}
      <header className="border-b border-emerald-200 bg-white/80 backdrop-blur sticky top-0 z-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-2xl shadow-lg">
              🐝
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-900">生産力</p>
              <p className="text-xs text-emerald-700">社員ダッシュボード</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/calendar"
              className="hidden rounded-full bg-blue-600 px-6 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-blue-700 hover:shadow-xl md:block"
            >
              📅 カレンダーを見る
            </Link>
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold text-emerald-950">
                {profile?.displayName || user.email?.split("@")[0] || "社員"}
              </p>
              {profile?.companyName && (
                <p className="text-xs font-medium text-emerald-600">{profile.companyName}</p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-full border-2 border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-12">
        {/* Welcome Section */}
        <div className="mb-12 text-center">
          <h1 className="mb-3 text-4xl font-bold text-emerald-950">
            ようこそ、{profile?.displayName || "社員"}さん！
          </h1>
          <p className="text-lg text-emerald-700">
            今日も効率的に工数を管理しましょう
          </p>
        </div>

        {/* Menu Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Tasks Card */}
          <Link
            href="/my/tasks"
            className="group relative overflow-hidden rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:scale-[1.02] hover:border-emerald-400 hover:shadow-2xl"
          >
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-purple-100 opacity-50 blur-xl"></div>
            <div className="relative z-10">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-400 to-indigo-600 text-3xl shadow-lg text-white">
                  🧩
                </div>
                <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
                  New
                </span>
              </div>
              <h2 className="mb-3 text-2xl font-bold text-emerald-950">自分のタスク</h2>
              <p className="mb-6 text-emerald-800">
                管理者が割り当てたタスクを一覧で確認。<br/>
                課題からそのまま工数をカレンダーに追加できます。
              </p>
              <div className="flex items-center font-bold text-purple-700 group-hover:underline">
                タスクを見る
                <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </div>
          </Link>

          {/* Calendar Card */}
          <Link
            href="/calendar"
            className="group relative overflow-hidden rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg transition hover:scale-[1.02] hover:border-emerald-400 hover:shadow-2xl"
          >
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-emerald-100 opacity-50 blur-xl"></div>
            <div className="relative z-10">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 text-3xl shadow-lg text-white">
                  📅
                </div>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-600">
                  メイン機能
                </span>
              </div>
              <h2 className="mb-3 text-2xl font-bold text-emerald-950">カレンダー</h2>
              <p className="mb-6 text-emerald-800">
                日々の作業工数を記録・確認します。<br/>
                Googleカレンダーのような操作感で、直感的に入力できます。
              </p>
              <div className="flex items-center font-bold text-blue-600 group-hover:underline">
                カレンダーを開く
                <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </div>
          </Link>

          {/* Profile Card */}
          <div className="group relative overflow-hidden rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-lg">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-green-100 opacity-50 blur-xl"></div>
            <div className="relative z-10">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 text-3xl shadow-lg text-white">
                  👤
                </div>
              </div>
              <h2 className="mb-3 text-2xl font-bold text-emerald-950">プロフィール</h2>
              
              <div className="space-y-4">
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                    <span className="font-bold text-gray-600">名前</span>
                    <span className="font-medium text-gray-900">{profile?.displayName || "未設定"}</span>
                    
                    <span className="font-bold text-gray-600">メール</span>
                    <span className="font-medium text-gray-900 break-all">{user.email}</span>
                    
                    {profile?.companyName && (
                      <>
                        <span className="font-bold text-gray-600">所属</span>
                        <span className="font-medium text-gray-900">{profile.companyName}</span>
                      </>
                    )}

                    {profile?.companyCode && (
                      <>
                        <span className="font-bold text-gray-600">会社コード</span>
                        <span className="font-medium text-gray-900">{profile.companyCode}</span>
                      </>
                    )}
                  </div>
                </div>

                {employee?.allowCalendarSync !== false ? (
                  <div className="rounded-xl border border-green-100 bg-green-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-bold text-green-800">Googleカレンダー連携</div>
                        <div className="text-xs text-green-700">
                          {profile?.calendarLinked ? "連携済みです" : "未連携"}
                        </div>
                      </div>
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${profile?.calendarLinked ? "bg-green-500 text-white" : "bg-gray-200 text-gray-400"}`}>
                        {profile?.calendarLinked ? "✓" : "-"}
                      </div>
                    </div>
                    
                    <button
                      onClick={linkCalendar}
                      className={`w-full rounded-lg px-4 py-2 text-sm font-bold shadow transition ${
                        profile?.calendarLinked 
                          ? "bg-white text-green-600 border border-green-200 hover:bg-green-50"
                          : "bg-green-500 text-white hover:bg-green-600"
                      }`}
                    >
                      {profile?.calendarLinked ? "再連携する" : "Googleカレンダーと連携"}
                    </button>
                    
                    {calendarStatus && (
                      <div className="mt-2 text-xs font-medium text-green-800 text-center animate-pulse">
                        {calendarStatus}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300 text-gray-600">
                        🔒
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-700">Googleカレンダー連携</div>
                        <div className="text-xs text-gray-600">管理者により無効化されています</div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Googleカレンダー連携を使用するには、管理者に許可を依頼してください。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
