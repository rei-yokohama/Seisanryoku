import Link from "next/link";

export const metadata = {
  title: "カレンダー | ヘルプ",
  description: "工数カレンダーの使い方（入力/編集/繰り返し/移動）についてのヘルプです。",
};

export default function HelpCalendarPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">カレンダー</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">カレンダー</h1>
        <p className="mt-2 text-slate-700">予定を工数として記録し、チームの実績を見える化します。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">画面</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            カレンダーは{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/calendar">
              /calendar
            </Link>{" "}
            です。
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">よく使う操作</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>クリックで作成/編集</li>
          <li>ドラッグ&ドロップで移動</li>
          <li>繰り返し予定（シリーズ）</li>
        </ul>
      </section>
    </div>
  );
}

