import Link from "next/link";

export const metadata = {
  title: "設定 | ヘルプ",
  description: "設定（メンバー/権限/アカウント/ワークスペース）についてのヘルプです。",
};

export default function HelpSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">設定</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">設定</h1>
        <p className="mt-2 text-slate-700">ワークスペース運用・メンバー・権限などの設定を行います。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">入口</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            設定トップは{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/settings">
              /settings
            </Link>{" "}
            です。
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">メンバーと権限</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            メンバー一覧は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/settings/members">
              /settings/members
            </Link>{" "}
            です。
          </li>
          <li>オーナー（管理者）のみ、権限の変更やメンバー管理を行えます。</li>
        </ul>
      </section>
    </div>
  );
}

