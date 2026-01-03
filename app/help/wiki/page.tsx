import Link from "next/link";

export const metadata = {
  title: "Wiki | ヘルプ",
  description: "Wikiの作成・顧客/案件への紐づけ・更新ログについてのヘルプです。",
};

export default function HelpWikiPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">Wiki</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">Wiki</h1>
        <p className="mt-2 text-slate-700">Wikiは、顧客と案件に紐づくナレッジです。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">紐づけ</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            Wikiは <span className="font-bold">顧客</span> と <span className="font-bold">案件</span> の両方に紐づけて管理します。
          </li>
          <li>編集画面（<span className="font-bold">/wiki/[docId]</span>）で紐づけを設定してください。</li>
        </ul>
      </section>
    </div>
  );
}


