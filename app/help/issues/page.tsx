import Link from "next/link";

export const metadata = {
  title: "課題 | ヘルプ",
  description: "課題（Issue）の作成・フィルタ・アーカイブの使い方をまとめたヘルプです。",
};

export default function HelpIssuesPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">課題</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">課題</h1>
        <p className="mt-2 text-slate-700">課題の作り方・探し方・アーカイブの考え方です。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">作成</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            課題は <span className="font-bold">顧客</span> と <span className="font-bold">案件</span> の両方に紐づけて作成します。
          </li>
          <li>
            作成画面は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/issue/new">
              /issue/new
            </Link>{" "}
            です。
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">一覧とフィルタ</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            一覧は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/issue">
              /issue
            </Link>{" "}
            です。
          </li>
          <li>完了とアーカイブはデフォルトで非表示です（必要に応じて表示を切り替えできます）。</li>
        </ul>
      </section>
    </div>
  );
}


