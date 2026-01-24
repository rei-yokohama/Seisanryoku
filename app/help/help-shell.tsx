"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const NAV: NavItem[] = [
  { href: "/help/getting-started", label: "はじめに", icon: "🏁" },
  { href: "/help/workspace", label: "ワークスペース", icon: "🧩" },
  { href: "/help/issues", label: "課題", icon: "✅" },
  { href: "/help/wiki", label: "Wiki", icon: "📚" },
  { href: "/help/drive", label: "ドライブ", icon: "🗂️" },
  { href: "/help/projects", label: "案件", icon: "💼" },
  { href: "/help/customers", label: "顧客", icon: "👥" },
  { href: "/help/balance", label: "収支", icon: "💴" },
  { href: "/help/calendar", label: "カレンダー", icon: "📅" },
  { href: "/help/settings", label: "設定", icon: "⚙️" },
];

function HelpNavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  return (
    <Link
      href={item.href}
      className={
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition " +
        (active ? "bg-orange-100 text-orange-900" : "text-slate-700 hover:bg-slate-100")
      }
    >
      <span className="text-base">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

export function HelpShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-white/10 text-white">
              ⚡
            </div>
            <div className="text-sm font-extrabold text-white">生産力</div>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md border border-white/30 bg-transparent px-4 py-2 text-sm font-extrabold text-white hover:bg-white/10"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-100"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <aside className="w-64 flex-shrink-0">
          <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <span className="text-lg">❓</span>
            ヘルプ・使い方
          </div>
          <nav className="space-y-1">
            <HelpNavLink item={{ href: "/help", label: "ヘルプトップ", icon: "🏠" }} />
            <div className="my-3 border-t border-slate-200" />
            {NAV.map((item) => (
              <HelpNavLink key={item.href} item={item} />
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}


