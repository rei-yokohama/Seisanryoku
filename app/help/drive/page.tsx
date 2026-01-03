import Link from "next/link";

export const metadata = {
  title: "ドライブ | ヘルプ",
  description: "ドライブ（フォルダ作成/アップロード/顧客・案件との紐づけ）のヘルプです。",
};

export default function HelpDrivePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-xs font-bold text-slate-500 hover:text-slate-700">
          ヘルプ
        </Link>
        <span className="px-2 text-xs text-slate-400">/</span>
        <span className="text-xs font-bold text-slate-700">ドライブ</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-extrabold text-slate-900">ドライブ</h1>
        <p className="mt-2 text-slate-700">ファイルは必ずフォルダ配下にアップロードします。</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">フォルダ作成</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>
            新規フォルダは{" "}
            <Link className="font-bold text-orange-700 hover:underline" href="/drive/new">
              /drive/new
            </Link>{" "}
            から作成します。
          </li>
          <li>
            フォルダは <span className="font-bold">顧客</span> と <span className="font-bold">案件</span> の両方に紐づけます。
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold text-slate-900">アップロード</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-700">
          <li>アップロードは、ドライブでフォルダを開いた状態でのみ可能です（マイドライブ直下へは不可）。</li>
        </ul>
      </section>
    </div>
  );
}


