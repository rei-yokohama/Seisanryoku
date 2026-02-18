"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { ensureProfile } from "../lib/ensureProfile";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  permissionKey?: string; // 権限キー（undefinedなら常に表示）
};

type MenuPermissions = {
  dashboard: boolean;
  members: boolean;
  projects: boolean;
  issues: boolean;
  customers: boolean;
  files: boolean;
  billing: boolean;
  settings: boolean;
  wiki: boolean;
  effort: boolean;
  calendar: boolean;
};

const DEFAULT_MENU_PERMISSIONS: MenuPermissions = {
  dashboard: true,
  members: false,
  projects: true,
  issues: true,
  customers: false,
  files: true,
  billing: false,
  settings: false,
  wiki: true,
  effort: true,
  calendar: true,
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export type AppShellProps = {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  projectId?: string | null;
  headerRight?: ReactNode;
  sidebarTop?: ReactNode;
};

function HeaderSearchForm({
  pathname,
  projectId,
}: {
  pathname: string;
  projectId?: string | null;
}) {
  const searchParams = useSearchParams();
  const isProjectsPage = pathname === "/projects" || pathname === "/crm/deals";
  return (
    <form
      className="flex items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const query = (formData.get("projectSearch") as string)?.trim();
        if (!query) return;
        if (projectId) {
          window.location.href = `/projects/${projectId}/issues?q=${encodeURIComponent(query)}`;
        } else if (isProjectsPage) {
          window.location.href = `/projects?q=${encodeURIComponent(query)}`;
        }
      }}
    >
      <div className="relative">
        <input
          type="text"
          name="projectSearch"
          defaultValue={isProjectsPage ? (searchParams.get("q") ?? "") : ""}
          placeholder={isProjectsPage ? "案件名・顧客名で検索" : "ワークスペース内を検索"}
          className="w-48 rounded-full border border-slate-300 bg-white px-4 py-1.5 pl-10 pr-4 text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-orange-600">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>
    </form>
  );
}

function HeaderSearchFormFallback({
  pathname,
  projectId,
}: {
  pathname: string;
  projectId?: string | null;
}) {
  const isProjectsPage = pathname === "/projects" || pathname === "/crm/deals";
  return (
    <form
      className="flex items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const query = (formData.get("projectSearch") as string)?.trim();
        if (!query) return;
        if (projectId) {
          window.location.href = `/projects/${projectId}/issues?q=${encodeURIComponent(query)}`;
        } else if (isProjectsPage) {
          window.location.href = `/projects?q=${encodeURIComponent(query)}`;
        }
      }}
    >
      <div className="relative">
        <input
          type="text"
          name="projectSearch"
          placeholder={isProjectsPage ? "案件名・顧客名で検索" : "ワークスペース内を検索"}
          className="w-48 rounded-full border border-slate-300 bg-white px-4 py-1.5 pl-10 pr-4 text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-orange-600">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>
    </form>
  );
}

export function AppShell({ title, subtitle, children, projectId, headerRight, sidebarTop }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [companyDisplayName, setCompanyDisplayName] = useState("会社未設定");
  const [userDisplayName, setUserDisplayName] = useState("ユーザー");
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [menuPermissions, setMenuPermissions] = useState<MenuPermissions | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setCompanyDisplayName("未ログイン");
        setUserDisplayName("未ログイン");
        setUnreadNotifications(0);
        setIsOwner(false);
        setMenuPermissions(null);
        return;
      }
      try {
        const prof = await ensureProfile(u);
        const displayName = (prof?.displayName as string | undefined) || u.email?.split("@")[0] || "ユーザー";
        setUserDisplayName(displayName);

        const code = (prof?.companyCode || "").trim();
        const fallback = (prof?.companyName as string | undefined) || "会社未設定";
        if (!code) {
          setCompanyDisplayName(fallback);
          setIsOwner(false);
          setMenuPermissions(null);
          return;
        }

        const compSnap = await getDoc(doc(db, "companies", code));
        if (compSnap.exists()) {
          const c = compSnap.data() as any;
          setCompanyDisplayName((c.companyName as string | undefined) || fallback);
          // オーナー判定
          const ownerUid = c.ownerUid || "";
          setIsOwner(ownerUid === u.uid);
          // オーナーなら全権限
          if (ownerUid === u.uid) {
            setMenuPermissions({
              dashboard: true, members: true, projects: true, issues: true, customers: true,
              files: true, billing: true, settings: true, wiki: true, effort: true, calendar: true,
            });
          } else {
            // メンバーの権限を取得
            const membershipId = `${code}_${u.uid}`;
            const msSnap = await getDoc(doc(db, "workspaceMemberships", membershipId));
            if (msSnap.exists()) {
              const ms = msSnap.data() as any;
              const p = ms.permissions || {};
              setMenuPermissions({
                dashboard: p.dashboard ?? DEFAULT_MENU_PERMISSIONS.dashboard,
                members: p.members ?? DEFAULT_MENU_PERMISSIONS.members,
                projects: p.projects ?? DEFAULT_MENU_PERMISSIONS.projects,
                issues: p.issues ?? DEFAULT_MENU_PERMISSIONS.issues,
                customers: p.customers ?? DEFAULT_MENU_PERMISSIONS.customers,
                files: p.files ?? DEFAULT_MENU_PERMISSIONS.files,
                billing: p.billing ?? DEFAULT_MENU_PERMISSIONS.billing,
                settings: p.settings ?? DEFAULT_MENU_PERMISSIONS.settings,
                wiki: p.wiki ?? DEFAULT_MENU_PERMISSIONS.wiki,
                effort: p.effort ?? DEFAULT_MENU_PERMISSIONS.effort,
                calendar: p.calendar ?? DEFAULT_MENU_PERMISSIONS.calendar,
              });
            } else {
              setMenuPermissions(DEFAULT_MENU_PERMISSIONS);
            }
          }
        } else {
          setCompanyDisplayName(fallback);
          setIsOwner(false);
          setMenuPermissions(DEFAULT_MENU_PERMISSIONS);
        }
      } catch {
        setCompanyDisplayName("会社未設定");
        setUserDisplayName(u.email?.split("@")[0] || "ユーザー");
        setIsOwner(false);
        setMenuPermissions(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // 未読数をリアルタイム表示（課題割当などで通知が追加されたら即反映）
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUnreadNotifications(0);
        return;
      }
      // Ensure profile exists before starting notifications listener (rules depend on companyCode)
      ensureProfile(u)
        .then((prof) => {
          if (!prof?.companyCode) {
            setUnreadNotifications(0);
            return;
          }
          const q = query(
            collection(db, "notifications"),
            where("companyCode", "==", prof.companyCode),
            where("recipientUid", "==", u.uid),
            where("read", "==", false),
          );
          return onSnapshot(
            q,
            (snap) => setUnreadNotifications(snap.size),
            () => setUnreadNotifications(0),
          );
        })
        .catch(() => setUnreadNotifications(0));
    });
    return () => unsub();
  }, []);

  const projectLinks = useMemo<NavItem[]>(() => {
    if (!projectId) return [];
    return [
      { icon: "H", label: "ホーム", href: `/dashboard?projectId=${encodeURIComponent(projectId)}` },
      { icon: "I", label: "課題", href: `/projects/${encodeURIComponent(projectId)}/issues` },
    ];
  }, [projectId]);

  const globalLinks = useMemo<NavItem[]>(
    () => [
      { icon: "D", label: "ダッシュボード", href: "/dashboard" },
      { icon: "I", label: "課題", href: "/issue" },
      { icon: "💼", label: "案件", href: "/projects" },
      { icon: "C", label: "顧客", href: "/customers" },
      { icon: "¥", label: "収支", href: "/balance" },
      { icon: "⏱", label: "工数", href: "/effort" },
      { icon: "T", label: "タスク", href: "/my/tasks" },
      { icon: "Cal", label: "カレンダー", href: "/calendar" },
      { icon: "E", label: "社員", href: "/employees" },
    ],
    [projectId],
  );

  const activeHref = (href: string) => {
    // preserve basic "selected" feel across query routes
    if (href === "/dashboard") return pathname === "/dashboard";

    // 課題（/issue 配下全て）を同一カテゴリとして扱う
    if (href === "/issue") {
      return pathname.startsWith("/issue") || (pathname.startsWith("/projects/") && pathname.includes("/issues"));
    }
    
    // /projects 系のパスは /projects で始まる全てのパスで活性化
    if (href === "/projects") {
      // 課題表示中は「課題」を活性にしたいので /issues 配下は除外
      if (pathname.startsWith("/projects/") && pathname.includes("/issues")) return false;
      return pathname.startsWith("/projects");
    }
    
    return pathname === href || pathname.startsWith(href + "/");
  };

  const Header = (
    <div className="flex flex-col border-b border-slate-200">
      {/* 1段目: グローバルナビ */}
      <div className="flex h-12 w-full items-center gap-4 bg-white px-4 text-sm font-medium text-slate-700">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex h-8 w-8 items-center justify-center rounded bg-orange-500 font-extrabold text-white">B</Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="hover:text-orange-600">ダッシュボード</Link>
            <Link href="/projects" className="hover:text-orange-600">案件</Link>
            <Link href="/issue" className="hover:text-orange-600">課題</Link>
            <Link href="/customers" className="hover:text-orange-600">顧客</Link>
            <Link href="/issue/new" className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-white font-bold hover:bg-orange-600">＋</Link>
          </div>
        </div>

        <form 
          className="flex flex-1 items-center justify-center"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const query = formData.get("search") as string;
            if (query?.trim()) {
              window.location.href = `/search?q=${encodeURIComponent(query.trim())}`;
            }
          }}
        >
          <div className="relative w-full max-w-md">
            <input
              type="text"
              name="search"
              placeholder="全体からキーワード検索"
              className="w-full rounded-full border border-slate-300 bg-slate-50 px-4 py-1.5 pl-10 text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </form>

        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
              className="text-slate-400 hover:text-slate-600"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
            {headerMenuOpen && (
              <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-slate-200 bg-white shadow-lg">
                <div className="py-1">
                  <Link
                    href="/recent"
                    onClick={() => setHeaderMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    最近見た項目
                  </Link>
                  <Link
                    href="/filters"
                    onClick={() => setHeaderMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    フィルタ
                  </Link>
                  <div className="border-t border-slate-200 my-1"></div>
                  <Link
                    href="/settings"
                    onClick={() => setHeaderMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    設定
                  </Link>
                </div>
              </div>
            )}
          </div>
          <Link href="/notifications" className="relative text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadNotifications > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            ) : null}
          </Link>
          <Link href="/help" className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </Link>
          <Link href="/settings/account" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-600 text-xs font-extrabold text-white">
              {(userDisplayName || "U").trim().charAt(0)}
            </div>
            <div className="flex flex-col leading-tight">
              <div className="text-xs font-extrabold text-slate-700">{userDisplayName}</div>
              <div className="text-[10px] font-bold text-slate-500">{companyDisplayName}</div>
            </div>
          </Link>
        </div>
      </div>

      {/* 2段目: ワークスペースヘッダー */}
      <div className="flex h-12 w-full items-center justify-between bg-[#f8f9f8] px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="md:hidden text-orange-600">
             <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
             </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-lg">💡</div>
            <div className="flex flex-col">
              <div className="text-sm font-bold text-slate-800">
                {title || "ワークスペース"}{" "}
                {projectId ? <span className="text-xs font-normal text-slate-500">({projectId})</span> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {headerRight}
          <Suspense fallback={<HeaderSearchFormFallback pathname={pathname} projectId={projectId} />}>
            <HeaderSearchForm pathname={pathname} projectId={projectId} />
          </Suspense>
        </div>
      </div>
    </div>
  );

  const Sidebar = (
    <aside
      className={classNames(
        "hidden shrink-0 bg-[#ea580c] text-white transition-all duration-300 md:flex md:flex-col border-r border-orange-700/30 min-h-screen",
        sidebarCollapsed ? "w-16" : "w-56",
      )}
    >
      <div className="flex h-12 items-center px-4 border-b border-white/10">
         <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-white/80 hover:text-white transition">
           <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
           </svg>
         </button>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2">
        {([
          { icon: "🏠", label: "ホーム", href: "/dashboard", permissionKey: "dashboard" },
          { icon: "📋", label: "課題", href: "/issue", permissionKey: "issues" },
          { icon: "📚", label: "Wiki", href: "/wiki", permissionKey: "wiki" },
          { icon: "👥", label: "顧客", href: "/customers", permissionKey: "customers" },
          { icon: "💼", label: "案件", href: "/projects", permissionKey: "projects" },
          { icon: "💴", label: "収支", href: "/balance", permissionKey: "billing" },
          { icon: "🧾", label: "請求", href: "/billing", permissionKey: "billing" },
          { icon: "⏱", label: "工数", href: "/effort", permissionKey: "effort" },
          { icon: "💾", label: "ドライブ", href: "/drive", permissionKey: "files" },
          { icon: "📅", label: "カレンダー", href: "/calendar", permissionKey: "calendar" },
          { icon: "🧑‍💼", label: "メンバー", href: "/members", permissionKey: "members" },
          { icon: "⚙️", label: "設定", href: "/settings", permissionKey: "settings" }
        ] as NavItem[]).filter((it) => {
          // 権限キーがない項目は常に表示
          if (!it.permissionKey) return true;
          // 権限データがまだロードされていない場合は表示しない
          if (!menuPermissions) return false;
          // 権限があれば表示
          return menuPermissions[it.permissionKey as keyof MenuPermissions];
        }).map((it, idx) => (
          <Link
            key={`${it.label}-${idx}`}
            href={it.href}
            className={classNames(
              "group relative flex items-center gap-3 px-4 py-3 text-[13px] font-bold transition-all",
              activeHref(it.href)
                ? "bg-white text-[#ea580c]"
                : "text-white hover:bg-white/10",
              sidebarCollapsed && "justify-center"
            )}
          >
            <span className="text-lg leading-none">{it.icon}</span>
            {!sidebarCollapsed && <span className="truncate">{it.label}</span>}
          </Link>
        ))}
      </div>
      <div className="p-4 border-t border-white/10">
         <div className="h-6 w-6 rounded-full bg-white/20"></div>
      </div>
    </aside>
  );

  const MobileDrawer = mobileOpen ? (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
      <div
        className="absolute left-0 top-0 h-full w-80 max-w-[85vw] overflow-y-auto border-r border-orange-700 bg-gradient-to-b from-orange-600 to-orange-500 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/20 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">メニュー</div>
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-2 hover:bg-white/15"
              aria-label="閉じる"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {sidebarTop ? <div className="mt-4">{sidebarTop}</div> : null}
        </div>
        
        <div className="py-3">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-white/70">
            メインメニュー
          </div>
          
          {globalLinks.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setMobileOpen(false)}
              className={classNames(
                "mx-2 mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                activeHref(it.href)
                  ? "bg-white/20 text-white font-semibold"
                  : "text-white/90 hover:bg-white/15 hover:text-white"
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-orange-700/60 text-xs font-bold">
                {it.icon}
              </span>
              <span className="truncate">{it.label}</span>
            </Link>
          ))}
          
          {projectLinks.length > 0 && (
            <>
              <div className="mx-3 mb-2 mt-5 text-[10px] font-bold uppercase tracking-wider text-white/70">
                案件
              </div>
              {projectLinks.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setMobileOpen(false)}
                  className={classNames(
                    "mx-2 mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    activeHref(it.href)
                      ? "bg-white/20 text-white font-semibold"
                      : "text-white/90 hover:bg-white/15 hover:text-white"
                  )}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-orange-700/60 text-xs font-bold">
                    {it.icon}
                  </span>
                  <span className="truncate">{it.label}</span>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col">
      {Header}
      {MobileDrawer}
      {headerMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setHeaderMenuOpen(false)}
        />
      )}
      <div className="flex w-full flex-1">
        {Sidebar}
        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}


