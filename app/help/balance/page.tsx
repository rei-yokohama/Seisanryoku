import Link from "next/link";

export const metadata = {
  title: "収支 | ヘルプ",
  description: "収支（担当者×月）の見方と、コスト/売上の入力についてのヘルプです。",
};

export default function HelpBalancePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">収支</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">収支</h1>
        <p className="mt-2 text-slate-700">担当者ごとに、月ごとのコスト/売上/収支を管理します。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">画面</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            収支は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/balance">
              /balance
            </Link>{" "}
            です。
          </li>
          <li>担当者（メンバー）一覧を縦軸に、案件（稼働中）を横軸に表示します。</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">編集（コスト/売上）</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>「編集」ボタンから、コストと売上を手動で入力できます。</li>
          <li>案件に売上が登録されている場合は、売上欄に自動反映されます（手動修正も可能）。</li>
          <li>収支は自動計算（売上 − コスト）です。</li>
        </ul>
      </section>
    </div>
  );
}

