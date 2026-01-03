import Link from "next/link";

export default function HelpPage() {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-3">
          <div className="text-5xl">📖</div>
          <h1 className="text-4xl font-extrabold text-slate-900">生産力ヘルプセンター</h1>
        </div>
        <p className="mt-4 text-slate-700">
          生産力の使い方を機能ごとに詳しく解説します。
          左側のメニューから、知りたい機能を選択してください。
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
        <div className="text-lg font-extrabold text-slate-900">よく見られるヘルプ</div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Link href="/help/getting-started" className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:bg-white hover:shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">はじめに</div>
            <div className="mt-1 text-xs font-bold text-slate-500">ログイン/基本導線/最初の設定</div>
          </Link>
          <Link href="/help/issues" className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:bg-white hover:shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">課題</div>
            <div className="mt-1 text-xs font-bold text-slate-500">作成/フィルタ/アーカイブ</div>
          </Link>
          <Link href="/help/wiki" className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:bg-white hover:shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Wiki</div>
            <div className="mt-1 text-xs font-bold text-slate-500">顧客×案件に紐づくドキュメント</div>
          </Link>
          <Link href="/help/drive" className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:bg-white hover:shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">ドライブ</div>
            <div className="mt-1 text-xs font-bold text-slate-500">フォルダ/アップロード</div>
          </Link>
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

