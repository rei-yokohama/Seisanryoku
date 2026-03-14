"use client";

import { ReactNode, Suspense, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { AppShell } from "../AppShell";

const ALL_PERMISSIONS = {
  dashboard: true,
  members: true,
  projects: true,
  issues: true,
  customers: true,
  files: true,
  billing: true,
  invoicing: true,
  settings: true,
  wiki: true,
  effort: true,
  calendar: true,
};

const NO_PERMISSIONS: Permissions = {
  dashboard: true,
  members: false,
  projects: false,
  issues: false,
  customers: false,
  files: false,
  billing: false,
  invoicing: false,
  settings: false,
  wiki: false,
  effort: false,
  calendar: false,
};

type Permissions = typeof ALL_PERMISSIONS;

/* SVG icon helper (Heroicons outline, strokeWidth 1.8 — same style as sidebar) */
const I = (d: string) => (
  <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const services: {
  icon: ReactNode;
  label: string;
  href: string;
  description: string;
  permissionKey?: keyof Permissions;
  accent: string;
}[] = [
  { icon: I("M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"), label: "課題", href: "/issue", description: "課題の管理・追跡", permissionKey: "issues", accent: "hover:border-orange-400" },
  { icon: I("M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"), label: "案件", href: "/projects", description: "プロジェクトの管理", permissionKey: "projects", accent: "hover:border-blue-400" },
  { icon: I("M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"), label: "顧客", href: "/customers", description: "顧客情報の管理", permissionKey: "customers", accent: "hover:border-green-400" },
  { icon: I("M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"), label: "Wiki", href: "/wiki", description: "ナレッジベース", permissionKey: "wiki", accent: "hover:border-purple-400" },
  { icon: I("M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"), label: "収支", href: "/balance", description: "収支の記録・管理", permissionKey: "billing", accent: "hover:border-emerald-400" },
  { icon: I("M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"), label: "請求", href: "/billing", description: "請求書の作成・管理", permissionKey: "invoicing", accent: "hover:border-amber-400" },
  { icon: I("M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"), label: "工数", href: "/effort", description: "工数の記録・管理", permissionKey: "effort", accent: "hover:border-cyan-400" },
  { icon: I("M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"), label: "ドライブ", href: "/drive", description: "ファイルの管理・共有", permissionKey: "files", accent: "hover:border-indigo-400" },
  { icon: I("M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"), label: "カレンダー", href: "/calendar", description: "スケジュール管理", permissionKey: "calendar", accent: "hover:border-rose-400" },
  { icon: I("M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"), label: "メンバー", href: "/members", description: "チームメンバーの管理", permissionKey: "members", accent: "hover:border-teal-400" },
  { icon: I("M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-6.364-6.364L4.5 8.25l4.5 4.5a4.5 4.5 0 006.364 0l1.757-1.757"), label: "アプリ連携", href: "/integrations", description: "Discord・Slack・Chatwork", permissionKey: "settings", accent: "hover:border-violet-400" },
  { icon: I("M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"), label: "プロパティ", href: "/settings/properties", description: "カテゴリ・種別の管理", permissionKey: "settings", accent: "hover:border-lime-400" },
  { icon: I("M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281zM15 12a3 3 0 11-6 0 3 3 0 016 0z"), label: "設定", href: "/settings", description: "ワークスペース設定", permissionKey: "settings", accent: "hover:border-slate-400" },
];

function DashboardInner() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { router.push("/login"); return; }
      try {
        const p = await ensureProfile(u);
        const companyCode = (p?.companyCode || "").trim();
        if (!companyCode) { setPermissions(ALL_PERMISSIONS); setLoading(false); return; }

        // companies 読み取りが失敗しても workspaceMemberships の権限読み取りは必ず行う
        let isOwnerUser = false;
        try {
          const compSnap = await getDoc(doc(db, "companies", companyCode));
          if (compSnap.exists()) {
            const c = compSnap.data() as any;
            setCompanyName(c.companyName || "");
            if (c.ownerUid === u.uid) {
              isOwnerUser = true;
            }
          }
        } catch {
          // companies 読み取り失敗は無視して権限取得へ進む
        }

        if (isOwnerUser) {
          setPermissions(ALL_PERMISSIONS);
          setLoading(false);
          return;
        }

        // workspaceMemberships からメニュー権限を取得
        try {
          const msSnap = await getDoc(doc(db, "workspaceMemberships", `${companyCode}_${u.uid}`));
          if (msSnap.exists()) {
            const msData = msSnap.data() as any;
            const p2 = (msData.permissions || {}) as Partial<Permissions>;
            setPermissions({
              dashboard: true,
              members: p2.members ?? false,
              projects: p2.projects ?? false,
              issues: p2.issues ?? false,
              customers: p2.customers ?? false,
              files: p2.files ?? false,
              billing: p2.billing ?? false,
              invoicing: p2.invoicing ?? false,
              settings: p2.settings ?? false,
              wiki: p2.wiki ?? false,
              effort: p2.effort ?? false,
              calendar: p2.calendar ?? false,
            });
          } else {
            setPermissions(NO_PERMISSIONS);
          }
        } catch {
          setPermissions(NO_PERMISSIONS);
        }
      } catch { setPermissions(NO_PERMISSIONS); } finally { setLoading(false); }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-orange-500" />
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  if (!permissions) {
    return (
      <AppShell>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900 space-y-3">
          <div>ワークスペース情報を確認中です。数秒後に自動で反映されます。</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-orange-700"
          >
            再読み込み
          </button>
        </div>
      </AppShell>
    );
  }

  const visibleServices = services.filter((s) => {
    if (!s.permissionKey) return true;
    return permissions[s.permissionKey];
  });

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-lg font-black text-white shadow-sm">
              {(companyName || "W").charAt(0)}
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {companyName || "ダッシュボード"}
            </h1>
          </div>
        </div>

        {visibleServices.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <p className="font-bold mb-1">利用可能な機能がありません</p>
            <p className="text-amber-600">管理者にメニュー権限の付与をご依頼ください。</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleServices.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className={`group rounded-xl border border-slate-200 bg-white p-5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${s.accent}`}
              >
                <div className="mb-3 text-slate-400 group-hover:text-orange-500 transition-colors">{s.icon}</div>
                <div className="text-sm font-bold text-slate-900 group-hover:text-orange-600 transition-colors">
                  {s.label}
                </div>
                <div className="text-[12px] text-slate-400 mt-1 leading-relaxed">{s.description}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-orange-500" />
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
