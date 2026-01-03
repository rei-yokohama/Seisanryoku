import Link from "next/link";

export const metadata = {
  title: "はじめに | ヘルプ",
  description: "生産力の基本導線（ログイン/ワークスペース/社員の使い方）をまとめたヘルプです。",
};

export default function HelpGettingStartedPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">はじめに</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">はじめに</h1>
        <p className="mt-2 text-slate-700">ログイン後にどこを見ればいいか、最短でわかるガイドです。</p>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">ログイン</h2>
        <ul className="list-disc pl-5 text-slate-700">
          <li>
            社員・管理者どちらも同じログイン画面（
            <Link className="font-bold text-orange-700 hover:underline" href="/login">/login</Link>
            ）です。
          </li>
          <li>ログイン後はダッシュボード（<span className="font-bold">/dashboard</span>）へ移動します。</li>
        </ul>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">ワークスペース</h2>
        <ul className="list-disc pl-5 text-slate-700">
          <li>会社（companies/profiles）は、UI上「ワークスペース」として扱います。</li>
          <li>
            設定は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/settings/workspace">
              /settings/workspace
            </Link>{" "}
            から変更できます。
          </li>
        </ul>
      </section>
    </div>
  );
}


