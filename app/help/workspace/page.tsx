import Link from "next/link";

export const metadata = {
  title: "ワークスペース | ヘルプ",
  description: "ワークスペース設定とメンバー招待についてのヘルプです。",
};

export default function HelpWorkspacePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">ワークスペース</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">ワークスペース</h1>
        <p className="mt-2 text-slate-700">会社（company）情報はワークスペースとして扱います。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">設定</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            ワークスペース名/コードは{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/settings/workspace">
              /settings/workspace
            </Link>{" "}
            で変更できます。
          </li>
          <li>切り替えは同じ画面の「ワークスペースの切り替え」から行えます。</li>
        </ul>
      </section>
    </div>
  );
}


