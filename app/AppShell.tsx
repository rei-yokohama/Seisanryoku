"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { ensureProfile } from "../lib/ensureProfile";

type MenuPermissions = {
  dashboard: boolean;
  members: boolean;
  projects: boolean;
  issues: boolean;
  customers: boolean;
  files: boolean;
  billing: boolean;
  invoicing: boolean;
  settings: boolean;
  wiki: boolean;
  effort: boolean;
  calendar: boolean;
};

const ALL_MENU_PERMISSIONS: MenuPermissions = {
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

const NO_MENU_PERMISSIONS: MenuPermissions = {
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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export type AppShellProps = {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  projectId?: string | null;
  headerRight?: ReactNode;
  sidebarTop?: ReactNode;
  initialSidebarCollapsed?: boolean;
};

/* ── Sidebar menu (4 items only) ── */
const sidebarItems: {
  label: string;
  href: string;
  permissionKey: keyof MenuPermissions;
  icon: ReactNode;
}[] = [
  {
    label: "顧客",
    href: "/customers",
    permissionKey: "customers",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    label: "案件",
    href: "/projects",
    permissionKey: "projects",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  {
    label: "課題",
    href: "/issue",
    permissionKey: "issues",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  {
    label: "Wiki",
    href: "/wiki",
    permissionKey: "wiki",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    label: "カレンダー",
    href: "/calendar",
    permissionKey: "calendar",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
];

export function AppShell({ children, headerRight, initialSidebarCollapsed = false }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [companyDisplayName, setCompanyDisplayName] = useState("会社未設定");
  const [userDisplayName, setUserDisplayName] = useState("ユーザー");
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [menuPermissions, setMenuPermissions] = useState<MenuPermissions | null>(null);

  /* ── Auth & permissions ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setCompanyDisplayName("未ログイン");
        setUserDisplayName("未ログイン");
        setUnreadNotifications(0);
        setIsOwner(false);
        setMenuPermissions(NO_MENU_PERMISSIONS);
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
          setMenuPermissions(ALL_MENU_PERMISSIONS);
          return;
        }

        // companies 読み取りが失敗しても workspaceMemberships の権限読み取りは必ず行う
        let isOwnerUser = false;
        try {
          const compSnap = await getDoc(doc(db, "companies", code));
          if (compSnap.exists()) {
            const c = compSnap.data() as any;
            setCompanyDisplayName((c.companyName as string | undefined) || fallback);
            const ownerUid = c.ownerUid || "";
            isOwnerUser = ownerUid === u.uid;
            setIsOwner(isOwnerUser);
          } else {
            setCompanyDisplayName(fallback);
            setIsOwner(false);
          }
        } catch {
          setCompanyDisplayName(fallback);
          setIsOwner(false);
        }

        if (isOwnerUser) {
          setMenuPermissions(ALL_MENU_PERMISSIONS);
          return;
        }

        // 非オーナー: workspaceMemberships から権限取得
        try {
          const msSnap = await getDoc(doc(db, "workspaceMemberships", `${code}_${u.uid}`));
          if (msSnap.exists()) {
            const msData = msSnap.data() as any;
            const p = (msData.permissions || {}) as Partial<MenuPermissions>;
            setMenuPermissions({
              dashboard: true,
              members: p.members ?? false,
              projects: p.projects ?? false,
              issues: p.issues ?? false,
              customers: p.customers ?? false,
              files: p.files ?? false,
              billing: p.billing ?? false,
              invoicing: p.invoicing ?? false,
              settings: p.settings ?? false,
              wiki: p.wiki ?? false,
              effort: p.effort ?? false,
              calendar: p.calendar ?? false,
            });
          } else {
            setMenuPermissions(NO_MENU_PERMISSIONS);
          }
        } catch {
          setMenuPermissions(NO_MENU_PERMISSIONS);
        }
      } catch {
        setCompanyDisplayName("会社未設定");
        setUserDisplayName("未ログイン");
        setIsOwner(false);
        setMenuPermissions(NO_MENU_PERMISSIONS);
      }
    });
    return () => unsub();
  }, []);

  /* ── Notifications (realtime) ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { setUnreadNotifications(0); return; }
      ensureProfile(u)
        .then((prof) => {
          if (!prof?.companyCode) { setUnreadNotifications(0); return; }
          const q = query(
            collection(db, "notifications"),
            where("companyCode", "==", prof.companyCode),
            where("recipientUid", "==", u.uid),
            where("read", "==", false),
          );
          return onSnapshot(q, (snap) => setUnreadNotifications(snap.size), () => setUnreadNotifications(0));
        })
        .catch(() => setUnreadNotifications(0));
    });
    return () => unsub();
  }, []);

  /* ── Helpers ── */
  const activeHref = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/projects") {
      if (pathname.startsWith("/projects/") && pathname.includes("/issues")) return false;
      return pathname.startsWith("/projects");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  const visibleItems = sidebarItems.filter((it) => {
    if (!menuPermissions) return false;
    return menuPermissions[it.permissionKey];
  });

  /* menuPermissions が null（未取得）でも最低限ダッシュボードは表示するため、
     sidebar / mobile drawer のダッシュボードリンクは常に表示される（後述）。 */

  /* ── Bell icon (shared) ── */
  const bellIcon = (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );

  const notifBadge = unreadNotifications > 0 && (
    <span className="absolute -top-1 -right-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
      {unreadNotifications > 99 ? "99+" : unreadNotifications}
    </span>
  );

  /* ── Dashboard grid icon (shared) ── */
  const gridIcon = (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );

  /* ── Hamburger icon (shared) ── */
  const hamburgerIcon = (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );

  /* ═══════════════════════════════════════════════
     Desktop Sidebar
     ═══════════════════════════════════════════════ */
  const Sidebar = (
    <aside
      className={cn(
        "hidden shrink-0 md:flex md:flex-col",
        "bg-white border-r border-orange-100",
        "transition-all duration-300 ease-in-out",
        sidebarCollapsed ? "w-[68px]" : "w-[220px]",
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-orange-100 overflow-hidden">
        {sidebarCollapsed ? (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-orange-400 hover:text-orange-600 hover:bg-orange-50 transition-all duration-200 flex-shrink-0 mx-auto"
          >
            {hamburgerIcon}
          </button>
        ) : (
          <>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-orange-400 hover:text-orange-600 hover:bg-orange-50 transition-all duration-200 flex-shrink-0 ml-4"
            >
              {hamburgerIcon}
            </button>
            <Link href="/dashboard" className="flex-1 flex items-center justify-center gap-2 pr-12 hover:opacity-80 transition-opacity">
              <svg className="h-5 w-5 text-orange-500 flex-shrink-0" viewBox="0 0 32 32" fill="none">
                <path d="M17.5 4L8 18h7l-1.5 10L24 14h-7l1.5-10z" fill="currentColor" />
              </svg>
              <span className="text-[18px] font-black text-orange-600 tracking-[0.2em]" style={{ fontFamily: "var(--font-shippori), serif" }}>
                生産力
              </span>
            </Link>
          </>
        )}
      </div>

      {/* Dashboard link */}
      <div className="px-2 pt-3 pb-1">
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
            sidebarCollapsed && "justify-center",
            activeHref("/dashboard")
              ? "bg-orange-50 text-orange-700"
              : "text-slate-500 hover:text-orange-600 hover:bg-orange-50/60"
          )}
        >
          <span className="flex-shrink-0">{gridIcon}</span>
          {!sidebarCollapsed && <span>ダッシュボード</span>}
        </Link>
      </div>

      {/* Divider */}
      <div className={cn("my-1", sidebarCollapsed ? "mx-3" : "mx-4")}>
        <div className="border-t border-orange-100" />
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {visibleItems.map((it) => {
          const active = activeHref(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                sidebarCollapsed && "justify-center",
                active
                  ? "bg-orange-50 text-orange-700"
                  : "text-slate-500 hover:text-orange-600 hover:bg-orange-50/60"
              )}
            >
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-orange-500" />
              )}
              <span className="flex-shrink-0">{it.icon}</span>
              {!sidebarCollapsed && <span>{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-orange-100 px-2 py-2 space-y-0.5">
        <Link
          href="/notifications"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
            sidebarCollapsed && "justify-center",
            pathname === "/notifications"
              ? "bg-orange-50 text-orange-700"
              : "text-slate-500 hover:text-orange-600 hover:bg-orange-50/60"
          )}
        >
          <span className="relative flex-shrink-0">
            {bellIcon}
            {notifBadge}
          </span>
          {!sidebarCollapsed && <span>通知</span>}
        </Link>
        <Link
          href="/settings/account"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200",
            sidebarCollapsed && "justify-center",
            "text-slate-500 hover:bg-orange-50/60"
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-[11px] font-bold text-white flex-shrink-0">
            {(userDisplayName || "U").trim().charAt(0)}
          </span>
          {!sidebarCollapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[12px] font-semibold text-slate-700 truncate">{userDisplayName}</span>
              <span className="text-[10px] text-slate-400 truncate">{companyDisplayName}</span>
            </div>
          )}
        </Link>
      </div>
    </aside>
  );

  /* ═══════════════════════════════════════════════
     Mobile Drawer
     ═══════════════════════════════════════════════ */
  const MobileDrawer = mobileOpen ? (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      <div
        className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-orange-100">
          <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <svg className="h-5 w-5 text-orange-500 flex-shrink-0" viewBox="0 0 32 32" fill="none">
              <path d="M17.5 4L8 18h7l-1.5 10L24 14h-7l1.5-10z" fill="currentColor" />
            </svg>
            <span className="text-[18px] font-black text-orange-600 tracking-[0.2em]" style={{ fontFamily: "var(--font-shippori), serif" }}>
              生産力
            </span>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-all"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Dashboard */}
        <div className="px-2 pt-3 pb-1">
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all",
              activeHref("/dashboard") ? "bg-orange-50 text-orange-700" : "text-slate-500"
            )}
          >
            {gridIcon}
            <span>ダッシュボード</span>
          </Link>
        </div>

        <div className="mx-4 my-1"><div className="border-t border-orange-100" /></div>

        {/* Nav */}
        <nav className="px-2 py-1 space-y-0.5">
          {visibleItems.map((it) => {
            const active = activeHref(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all",
                  active ? "bg-orange-50 text-orange-700" : "text-slate-500"
                )}
              >
                {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-orange-500" />}
                {it.icon}
                <span>{it.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-orange-100 px-2 py-2 bg-white space-y-0.5">
          <Link
            href="/notifications"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-500 hover:text-orange-600 hover:bg-orange-50/60 transition-all"
          >
            <span className="relative">{bellIcon}{notifBadge}</span>
            <span>通知</span>
          </Link>
          <Link
            href="/settings/account"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-500 hover:bg-orange-50/60 transition-all"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-[11px] font-bold text-white">
              {(userDisplayName || "U").trim().charAt(0)}
            </span>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[12px] font-semibold text-slate-700 truncate">{userDisplayName}</span>
              <span className="text-[10px] text-slate-400 truncate">{companyDisplayName}</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  ) : null;

  /* ═══════════════════════════════════════════════
     Layout
     ═══════════════════════════════════════════════ */
  return (
    <div className="min-h-dvh bg-slate-50 flex">
      {Sidebar}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex h-14 items-center px-4 bg-white gap-3 flex-shrink-0 border-b border-orange-100">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-orange-400 hover:text-orange-600 hover:bg-orange-50 transition-all"
          >
            {hamburgerIcon}
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <svg className="h-5 w-5 text-orange-500 flex-shrink-0" viewBox="0 0 32 32" fill="none">
              <path d="M17.5 4L8 18h7l-1.5 10L24 14h-7l1.5-10z" fill="currentColor" />
            </svg>
            <span className="text-[18px] font-black text-orange-600 tracking-[0.2em]" style={{ fontFamily: "var(--font-shippori), serif" }}>生産力</span>
          </Link>
          <div className="ml-auto">
            <Link
              href="/notifications"
              className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-all"
            >
              {bellIcon}
              {unreadNotifications > 0 && (
                <span className="absolute top-0.5 right-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-rose-500 px-0.5 text-[8px] font-bold text-white">
                  {unreadNotifications > 99 ? "+" : unreadNotifications}
                </span>
              )}
            </Link>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>
      {MobileDrawer}
    </div>
  );
}
