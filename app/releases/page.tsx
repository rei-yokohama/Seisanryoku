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

function ReleaseSection({ label, items, type }: { label: string; items?: string[]; type: "added" | "changed" | "fixed" }) {
  if (!items || items.length === 0) return null;

  const config = {
    added: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-600/20", labelJa: "追加機能" },
    changed: { bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-600/20", labelJa: "改善・変更" },
    fixed: { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-600/20", labelJa: "不具合修正" },
  }[type];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${config.bg} ${config.text} ${config.ring}`}>
          {label}
        </span>
        <h3 className="text-base font-bold text-slate-800">{config.labelJa}</h3>
      </div>
      <ul className="space-y-3 pl-1">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-3 text-[15px] leading-relaxed text-slate-600">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RELEASES: ReleaseEntry[] = [
  {
    date: "2026-01-24",
    title: "LP改善（できることの可視化）/ ヘルプセンター拡充",
    summary:
      "ログイン前トップ（LP）に「グローバルメニューで何ができるか」を追加し、ヘルプセンターは機能ごとのページを増やして探しやすくしました。",
    changed: [
      "トップページ（/）：グローバルメニューをベースに「できること」セクションを追加し、導線（アンカー）を整理",
      "ヘルプセンター（/help）：カテゴリを増やし、機能別に探しやすい構成へ",
    ],
  },
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
      "SEO：重複URL対策として www.seisanryoku.jp に統一（web.app / firebaseapp.com / seisanryoku.jp → www へリダイレクト）",
      "SEO：トップページ（/）をサイトマップに追加し、ヘルプ/リリースのみインデックス対象に調整（robots/sitemap/canonical）",
      "課題一覧（/issue）：顧客名の列を追加（顧客名でも検索可能）",
      "メンバー一覧（/settings/members）：管理者（オーナー）も表示し、権限（ロール）列を追加",
      "メンバー作成（/settings/members/new）：作成時に権限（admin/member）を設定可能（オーナーのみ）",
    ],
    changed: [
      "サインアップ時に「ワークスペース名」を入力（例：採用代行事業、広告代理事業...etc）",
      "ワークスペースごとにデータを分離（companyCodeベース）し、切替で表示対象が切り替わる",
      "Firestoreルールでワークスペース分離を厳密化（companyCodeが一致するデータのみ読み書き）",
      "ドライブの見た目を課題（/issue）に合わせて統一（検索条件カード/テーブル/余白）",
      "請求管理/売上利益は一旦ナビから非表示",
      "案件（/projects）・顧客（/customers）・Wiki（/wiki）の一覧UIを課題（/issue）の雛形に統一（検索条件カード＝デフォルト閉 + テーブル）",
      "メンバー一覧（/settings/members）の見やすさを改善（横幅拡張、名前の折返し/崩れを抑止）",
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
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-4xl px-6 py-12 md:py-20 text-center">
          <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-5xl">
            リリースノート
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-500 max-w-2xl mx-auto">
            生産力（Seisanryoku）をより使いやすく、より強力にするための最新のアップデート情報をお届けします。
          </p>
          {lastUpdated && (
            <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-bold text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              最終更新: {lastUpdated}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-6 py-12 md:py-20">
        <div className="space-y-20">
          {sorted.map((r) => (
            <article key={`${r.date}_${r.title}`} className="group relative">
              {/* Date Badge */}
              <div className="mb-6 flex items-center gap-4">
                <time className="text-sm font-black tracking-widest text-slate-400 uppercase">
                  {r.date.replace(/-/g, ".")}
                </time>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Content Card */}
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md">
                {/* Card Header */}
                <div className="border-b border-slate-100 bg-slate-50/50 px-8 py-8 md:px-12">
                  <h2 className="text-2xl font-black leading-tight text-slate-900 md:text-3xl">
                    {r.title}
                  </h2>
                </div>

                {/* Card Body */}
                <div className="px-8 py-10 md:px-12">
                  {/* Summary Section */}
                  {r.summary && (
                    <section className="mb-12">
                      <h3 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">概要</h3>
                      <p className="text-[17px] leading-loose text-slate-600">
                        {r.summary}
                      </p>
                    </section>
                  )}

                  {r.summary && <div className="h-px w-full bg-slate-100 mb-12" />}

                  {/* Details Section */}
                  <section>
                    <h3 className="mb-8 text-xs font-black uppercase tracking-[0.2em] text-slate-400">アップデート詳細</h3>
                    <div className="grid gap-12">
                      <ReleaseSection label="Added" type="added" items={r.added} />
                      <ReleaseSection label="Changed" type="changed" items={r.changed} />
                      <ReleaseSection label="Fixed" type="fixed" items={r.fixed} />
                    </div>
                  </section>
                </div>

                {/* Card Footer */}
                <div className="bg-slate-50 px-8 py-4 md:px-12 flex justify-end">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    Seisanryoku Update Archive
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Global Footer */}
        <footer className="mt-32 border-t border-slate-200 pt-16 pb-24 text-center">
          <div className="flex flex-col items-center gap-10">
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/" className="group flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-sm font-black text-slate-700 shadow-sm ring-1 ring-slate-200 hover:ring-orange-500 hover:text-orange-600 transition-all">
                <span>トップページに戻る</span>
                <span className="text-slate-300 group-hover:text-orange-400 transition-transform group-hover:translate-x-1">→</span>
              </Link>
              <Link href="/help" className="group flex items-center gap-2 rounded-2xl bg-orange-600 px-8 py-4 text-sm font-black text-white shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all">
                <span>ヘルプセンター</span>
                <span className="text-orange-200 group-hover:translate-x-1 transition-transform">→</span>
              </Link>
            </div>
            
            <div className="flex gap-8 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <Link href="/sitemap.xml" className="hover:text-slate-600 transition-colors">sitemap</Link>
              <Link href="/robots.txt" className="hover:text-slate-600 transition-colors">robots</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
