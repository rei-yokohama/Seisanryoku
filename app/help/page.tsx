import Link from "next/link";

type HelpCard = {
  href: string;
  title: string;
  desc: string;
  icon: string;
};

const CATEGORIES: HelpCard[] = [
  { href: "/help/getting-started", title: "はじめに", desc: "ログイン/基本導線/最初にやること", icon: "🏁" },
  { href: "/help/workspace", title: "ワークスペース", desc: "ワークスペース作成・切替・運用の考え方", icon: "🧩" },
  { href: "/help/issues", title: "課題", desc: "作成/検索/フィルタ/アーカイブ", icon: "✅" },
  { href: "/help/wiki", title: "Wiki", desc: "顧客×案件に紐づくドキュメント管理", icon: "📚" },
  { href: "/help/drive", title: "ドライブ", desc: "フォルダ作成/アップロード/共有", icon: "🗂️" },
  { href: "/help/projects", title: "案件", desc: "稼働ステータス/売上/担当（リーダー）", icon: "💼" },
  { href: "/help/customers", title: "顧客", desc: "稼働/停止、顧客から案件へ繋ぐ", icon: "👥" },
  { href: "/help/balance", title: "収支", desc: "担当者×月のコスト/売上/収支", icon: "💴" },
  { href: "/help/calendar", title: "カレンダー", desc: "工数入力/編集/繰り返し/移動", icon: "📅" },
  { href: "/help/settings", title: "設定", desc: "メンバー/権限/アカウント", icon: "⚙️" },
];

export default function HelpPage() {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-3">
          <div className="text-5xl">📖</div>
          <h1 className="text-4xl font-extrabold text-slate-900">生産力ヘルプセンター</h1>
        </div>
        <p className="mt-4 text-slate-700">
          生産力の使い方を、機能ごとにまとめて解説します。
          左のメニュー、または下のカテゴリから選んでください。
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-sky-50 p-6">
        <div className="flex items-start gap-4">
          <div className="text-2xl">💡</div>
          <div>
            <div className="text-sm font-extrabold text-slate-900">初めての方へ</div>
            <div className="mt-1 text-sm text-slate-700">
              まずは <Link className="font-bold text-orange-700 hover:underline" href="/help/getting-started">はじめに</Link> を見るのがおすすめです。
              実際に操作しながら学ぶのが一番の近道です。
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="text-lg font-extrabold text-slate-900">カテゴリ</div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {CATEGORIES.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:bg-white hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl leading-none">{c.icon}</div>
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-slate-900">{c.title}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{c.desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="text-center md:text-left">
            <div className="text-lg font-extrabold text-slate-900">生産力を使ってみませんか？</div>
            <div className="mt-1 text-sm text-slate-600">登録は30秒。クレジットカード不要で、今すぐ無料で始められます。</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/signup"
              className="rounded-md bg-orange-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
            >
              無料で始める
            </Link>
            <Link
              href="/"
              className="rounded-md border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              トップページに戻る
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

