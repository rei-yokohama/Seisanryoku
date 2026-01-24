import Link from "next/link";

export const metadata = {
  title: "顧客 | ヘルプ",
  description: "顧客の作成・編集・稼働/停止の運用についてのヘルプです。",
};

export default function HelpCustomersPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">顧客</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">顧客</h1>
        <p className="mt-2 text-slate-700">顧客を登録し、顧客に紐づく案件・課題・Wiki・ドライブを整理します。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">一覧</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            一覧は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/customers">
              /customers
            </Link>{" "}
            です。
          </li>
          <li>デフォルトでは稼働中のみが表示されます（フィルタで停止中も確認できます）。</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">作成・編集</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            新規作成は{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/customers/new">
              /customers/new
            </Link>{" "}
            から行います。
          </li>
          <li>顧客の編集は詳細画面の「編集」ボタンから開きます。</li>
        </ul>
      </section>
    </div>
  );
}

