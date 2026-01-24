import Link from "next/link";

export const metadata = {
  title: "案件 | ヘルプ",
  description: "案件（プロジェクト）の作成・編集・稼働ステータス・売上などの使い方をまとめたヘルプです。",
};

export default function HelpProjectsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">案件</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">案件</h1>
        <p className="mt-2 text-slate-700">顧客に紐づく「案件」を運用の軸として管理します。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">一覧</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            一覧は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/projects">
              /projects
            </Link>{" "}
            です。
          </li>
          <li>稼働中/停止中などのステータスで絞り込みできます。</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">作成・編集</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            新規作成は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/projects/new">
              /projects/new
            </Link>{" "}
            から行います。
          </li>
          <li>編集は案件詳細から「編集」ボタンで開きます。</li>
          <li>担当（リーダー/サブリーダー）や売上など、運用に必要な情報を更新できます。</li>
        </ul>
      </section>
    </div>
  );
}

