import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "リリースノート | 生産力",
  description: "生産力（Seisanryoku）の最新の機能追加・改善内容をまとめたリリースノートです。",
  alternates: {
    canonical: "https://www.seisanryoku.jp/releases",
  },
  robots: {
    index: true,
    follow: true,
  },
};

type ReleaseEntry = {
  date: string; // YYYY-MM-DD
  title: string;
  summary?: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
};

function formatDateJa(iso: string) {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  return `${y}年${m}月${d}日`;
}

function Group({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-extrabold text-slate-500">{label}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

const RELEASES: ReleaseEntry[] = [
  {
    date: "2026-01-03",
    title: "ワークスペース作成/切替・権限強化 / ヘルプセンター刷新 / リリースノート時系列化",
    summary:
      "ワークスペースを追加作成・切替できるようにし、データ分離をFirestoreルール側でも厳密化。ヘルプは非ログイン向けの専用UIに刷新し、リリースノートは時系列ログに変更しました。",
    added: [
      "ワークスペースの新規作成（/settings/workspace）",
      "ワークスペース切替（/settings/workspace）※所属しているワークスペースのみ",
      "ヘルプセンター（非ログイン向け）の上部ナビ（ログイン / 無料で始める）",
      "リリースノートを「日付降順の更新ログ（Added/Changed/Fixed）」として表示",
      "ドライブ：フォルダURLコピー（共有用）",
    ],
    changed: [
      "サインアップ時に「ワークスペース名」を入力（例：採用代行事業、広告代理事業...etc）",
      "ワークスペースごとにデータを分離（companyCodeベース）し、切替で表示対象が切り替わる",
      "Firestoreルールでワークスペース分離を厳密化（companyCodeが一致するデータのみ読み書き）",
      "ドライブの見た目を課題（/issue）に合わせて統一（検索条件カード/テーブル/余白）",
      "請求管理/売上利益は一旦ナビから非表示",
    ],
    fixed: [
      "ヘルプでログイン用の左メニューが出てしまう問題を改善（AppShellを使わない専用レイアウトへ）",
      "データ取得で createdBy の救済が混ざり、別ワークスペースのデータが出る可能性を抑止",
      "ワークスペース設定での権限エラー（Missing or insufficient permissions）に対処（ルール追加）",
      "共有URL（/share）はログイン必須に変更（データ分離の前提に合わせる）",
    ],
  },
  {
    date: "2026-01-02",
    title: "カレンダー（工数）の操作感を大幅改善",
    summary: "スクロール/表示/編集の体験を底上げし、社員でも登録できる運用を整えました。",
    added: [
      "予定クリックで編集/削除（モーダル）",
      "繰り返し予定（シリーズ）",
      "ドラッグ&ドロップで移動（プレビュー表示付き）",
      "ゲスト招待（チームメンバー）",
    ],
    changed: [
      "8:00〜19:00が初期表示に入りやすい表示密度へ調整",
      "1人だけ選択時は横幅最大で表示",
      "スクロール時にブラウザがジャンプする挙動を改善（表示領域/スクロール管理を見直し）",
    ],
    fixed: [
      "初期表示が深夜から始まってしまう問題を改善（DOM描画後に8時へ自動スクロール）",
    ],
  },
  {
    date: "2026-01-01",
    title: "運用改善まとめ：課題/Wiki/ドライブ/顧客案件/ログイン/請求/ヘルプ/SEO/UI",
    summary:
      "日々の運用で迷子になりやすい点を一気に改善。顧客×案件への紐づけ強制、一覧UI改善、用語統一、ログイン導線統一、編集機能追加、ヘルプ/SEO整備などをまとめて反映しました。",
    added: [
      "課題詳細からアーカイブ（archivedAt）",
      "Wiki一覧に「顧客/案件」「作成者」を表示",
      "案件/顧客詳細に紐づくWiki表示 + アクティビティ更新の改善",
      "ドライブ：/drive/new を新規フォルダ作成の専用画面に整理（顧客×案件に紐づけ）",
      "案件/顧客の編集ページ（/customers/[id]/edit, /projects/[id]/edit）",
      "ヘルプ：/help をハブ化し、配下にテーマ別ページを追加",
      "SEO：robots.txt と sitemap.xml を追加（/help, /releases をインデックス対象に）",
      "リリースノート（/releases）ページを追加し、LPフッターから導線追加",
    ],
    changed: [
      "/issue は完了・アーカイブをデフォルト非表示、フィルタ状態は保存",
      "検索条件カードは折りたたみを初期状態に（一覧が見やすい）",
      "課題一覧のラベル変更：「アーカイブ非表示」→「アーカイブ」",
      "左メニュー活性の誤りを修正（課題表示中に案件が活性化しない）",
      "アップロードはフォルダ選択必須に（/drive）",
      "用語統一：「プロジェクトホーム（PPC）」→「ワークスペース」",
      "ログイン導線を社員/管理者で統一（LPボタン一本化、ログインページ文言を中立に）",
      "社員ログイン時の黒画面を改善（employeesコレクションのフォールバック）",
      "ダッシュボードを社員/管理者で統一し、右上の表示も社員情報に対応",
      "請求管理（/billing）：年（12ヶ月）表示をデフォルトに、枠線を見直し、担当者表示を追加",
      "顧客/案件一覧をHubSpot風に情報量を増やして読みやすく（左端チェックボックス削除）",
      "ブランドカラーをオレンジへ移行（文字の視認性を確保）",
      "顧客のランク概念を削除（/customers/new, 一覧, 詳細, 編集）",
      "Wiki/ドライブのデザインを課題（/issue）に合わせて統一（検索条件カード/テーブル）",
      "マイルストーン概念をサービスから削除",
    ],
    fixed: [
      "案件に紐づくWikiが表示されない/アクティビティが更新されない問題を修正",
      "ドライブ新規フォルダで既存顧客が出ない問題を改善（companyCodeベースに統一）",
      "案件詳細で紐づくドライブが出ない問題を改善",
    ],
  },
];

export default function ReleasesPage() {
  const sorted = RELEASES.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const lastUpdated = sorted[0]?.date ? formatDateJa(sorted[0].date) : "";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">リリースノート</h1>
              <p className="mt-1 text-sm text-slate-600">
                新しく追加された機能や改善点を、時系列のログとしてまとめています{lastUpdated ? `（最終更新: ${lastUpdated}）` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
              >
                トップへ
              </Link>
              <Link
                href="/help"
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
              >
                ヘルプを見る
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <span className="font-extrabold text-slate-900">更新ログ</span>{" "}
          / 新機能（Added）・改善（Changed）・修正（Fixed）を日付順に掲載しています。
        </div>

        <div className="mt-6 space-y-6">
          {sorted.map((r) => (
            <article key={`${r.date}_${r.title}`} className="relative rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold text-slate-500">{formatDateJa(r.date)}</div>
                  <h2 className="mt-1 text-lg font-extrabold text-slate-900">{r.title}</h2>
                  {r.summary ? <p className="mt-2 text-sm text-slate-700">{r.summary}</p> : null}
                </div>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-3">
                <Group label="Added" items={r.added} />
                <Group label="Changed" items={r.changed} />
                <Group label="Fixed" items={r.fixed} />
              </div>
            </article>
          ))}
        </div>

        <section className="mt-8 space-y-2">
          <div className="text-sm font-extrabold text-slate-900">関連リンク</div>
          <div className="flex flex-wrap gap-2">
            <Link href="/help" className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50">
              ヘルプ
            </Link>
            <Link href="/sitemap.xml" className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50">
              sitemap.xml
            </Link>
            <Link href="/robots.txt" className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50">
              robots.txt
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}


