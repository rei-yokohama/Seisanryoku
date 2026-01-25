"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { type Activity } from "../../../../lib/activity";
import { ensureProfile } from "../../../../lib/ensureProfile";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Deal = {
  id: string;
  companyCode: string;
  createdBy: string;
  customerId: string;
  title: string;
  genre?: string;
  description?: string;
  status: string;
  revenue?: number | null;
  createdAt?: any;
  updatedAt?: any;
  // status tracking (LTV)
  firstActivatedAt?: any | null;
  activeStartedAt?: any | null;
  lastInactivatedAt?: any | null;
  activePeriods?: Array<{ startedAt: any; endedAt: any }> | null;
};

type Customer = {
  id: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
};

type Issue = {
  id: string;
  issueKey: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
};

type DealStatus = "ACTIVE" | "CONFIRMED" | "PLANNED" | "STOPPING" | "INACTIVE";

const DEAL_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "稼働中", color: "bg-green-100 text-green-700" },
  { value: "CONFIRMED", label: "稼働確定", color: "bg-blue-100 text-blue-700" },
  { value: "PLANNED", label: "稼働予定", color: "bg-sky-100 text-sky-700" },
  { value: "STOPPING", label: "停止予定", color: "bg-amber-100 text-amber-700" },
  { value: "INACTIVE", label: "停止中", color: "bg-slate-100 text-slate-700" },
] as const;

type WikiDoc = {
  id: string;
  title: string;
  dealId?: string | null;
  customerId?: string | null;
  updatedAt?: any;
};

type DriveItem = {
  id: string;
  kind: "folder" | "file";
  name: string;
  url?: string | null;
  parentId?: string | null;
  dealId?: string | null;
  customerId?: string | null;
  updatedAt?: any;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function relativeFromNow(date: Date) {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `約 ${min} 分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `約 ${hr} 時間前`;
  const day = Math.floor(hr / 24);
  return `約 ${day} 日前`;
}

function fmtJp(ts: any) {
  try {
    const d = ts?.toDate?.() ? (ts.toDate() as Date) : null;
    return d ? d.toLocaleString("ja-JP") : "-";
  } catch {
    return "-";
  }
}

function toMillis(ts: any) {
  if (!ts) return null;
  if (typeof ts?.toMillis === "function") return ts.toMillis() as number;
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return null;
}

export default function DealDetailPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [wikis, setWikis] = useState<WikiDoc[]>([]);
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);

  const [activeTab, setActiveTab] = useState<"overview" | "activity">("overview");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);

        // 案件情報取得
        const dealSnap = await getDoc(doc(db, "deals", projectId));
        if (!dealSnap.exists()) {
          setDeal(null);
          setLoading(false);
          return;
        }
        const d = { id: dealSnap.id, ...dealSnap.data() } as Deal;
        setDeal(d);

        // 顧客情報取得
        if (d.customerId) {
          const custSnap = await getDoc(doc(db, "customers", d.customerId));
          if (custSnap.exists()) {
            setCustomer({ id: custSnap.id, ...custSnap.data() } as Customer);
          }
        }

        // この案件に紐づく課題を取得
        if (prof.companyCode) {
          const issuesSnap = await getDocs(
            query(collection(db, "issues"), where("companyCode", "==", prof.companyCode), where("projectId", "==", projectId))
          );
          const issueItems = issuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Issue));
          setIssues(issueItems);

          // この案件に紐づくWiki
          const wikiSnap = await getDocs(
            query(
              collection(db, "wikiDocs"),
              where("companyCode", "==", prof.companyCode),
              where("dealId", "==", projectId),
            ),
          );
          const wikiItems = wikiSnap.docs.map(d => ({ id: d.id, ...d.data() } as WikiDoc));
          wikiItems.sort((a, b) => ((b.updatedAt as any)?.toMillis?.() || 0) - ((a.updatedAt as any)?.toMillis?.() || 0));
          setWikis(wikiItems);

          // この案件に紐づくドライブ（index回避：companyCodeのみ→dealIdでフィルタ）
          const driveSnap = await getDocs(query(collection(db, "driveItems"), where("companyCode", "==", prof.companyCode)));
          const driveAll = driveSnap.docs.map(d => ({ id: d.id, ...d.data() } as DriveItem));
          const related = driveAll.filter((it) => (it.dealId || "") === projectId);
          related.sort((a, b) => {
            const ak = a.kind === "folder" ? 0 : 1;
            const bk = b.kind === "folder" ? 0 : 1;
            if (ak !== bk) return ak - bk;
            return (a.name || "").localeCompare(b.name || "");
          });
          setDriveItems(related);

          // アクティビティログ取得
          const actSnap = await getDocs(query(collection(db, "activity"), where("companyCode", "==", prof.companyCode)));
          const actItems = actSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter((a: any) => a.projectId === projectId || (a.link && a.link.includes(projectId))) as Activity[];
          actItems.sort((a, b) => {
            const am = (a.createdAt as any)?.toMillis?.() || 0;
            const bm = (b.createdAt as any)?.toMillis?.() || 0;
            return bm - am;
          });
          setActivities(actItems);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (loading) {
    return (
      <AppShell title="案件詳細" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !deal) {
    return (
      <AppShell title="案件が見つかりません">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">案件が見つかりません</div>
          <div className="mt-3">
            <Link href="/projects" className="text-sm font-bold text-orange-700 hover:underline">
              ← 案件一覧に戻る
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const periods = Array.isArray(deal.activePeriods) ? deal.activePeriods : [];
  const baseStartTs = deal.firstActivatedAt || deal.createdAt || null;
  const currentStartTs = deal.activeStartedAt || baseStartTs;
  const lastStopTs =
    deal.lastInactivatedAt ||
    (periods.length > 0 ? periods[periods.length - 1]?.endedAt : null);

  let activeMs = 0;
  for (const p of periods) {
    const st = toMillis(p?.startedAt);
    const en = toMillis(p?.endedAt);
    if (!st || !en) continue;
    activeMs += Math.max(0, en - st);
  }
  if (deal.status === "ACTIVE") {
    const st = toMillis(currentStartTs);
    if (st) activeMs += Math.max(0, Date.now() - st);
  }
  const activeDays = activeMs / (1000 * 60 * 60 * 24);
  const revenue = Number(deal.revenue) || 0;
  const yen = (n: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
  const revPerDay = activeDays > 0 ? revenue / activeDays : 0;

  return (
    <AppShell
      title={deal.title}
      subtitle="案件詳細"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${projectId}/edit`}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            編集
          </Link>
          <Link href="/projects" className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 hover:bg-orange-50">
            ← 案件一覧
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側：基本情報 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 案件名とステータス */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h1 className="text-lg font-extrabold text-slate-900 leading-tight mb-3">{deal.title}</h1>
            {(() => {
              const statusOpt = DEAL_STATUS_OPTIONS.find(o => o.value === deal.status);
              return (
                <span
                  className={clsx(
                    "inline-flex rounded-full px-3 py-1 text-xs font-extrabold",
                    statusOpt?.color || "bg-slate-100 text-slate-700"
                  )}
                >
                  {statusOpt?.label || deal.status}
                </span>
              );
            })()}
          </div>

          {/* 案件の概要 */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">この案件の概要</div>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-extrabold text-slate-600">稼働/LTV</div>
                <div className="mt-2 space-y-2 text-xs font-bold text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">稼働開始</span>
                    <span className="text-slate-900">{fmtJp(baseStartTs)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">稼働停止</span>
                    <span className="text-slate-900">{(deal.status === "INACTIVE" || deal.status === "PLANNED") ? fmtJp(lastStopTs) : "-"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">稼働累計</span>
                    <span className="text-slate-900">{activeDays.toFixed(1)}日</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">売上（登録値）</span>
                    <span className="text-slate-900">{yen(revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">LTV目安（売上/稼働日）</span>
                    <span className="text-slate-900">{activeDays > 0 ? yen(revPerDay) : "-"}</span>
                  </div>
                </div>
              </div>
              {deal.createdAt && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">作成日</div>
                    <div className="text-sm text-slate-900">
                      {new Date((deal.createdAt as any).toMillis()).toLocaleDateString("ja-JP")}
                    </div>
                  </div>
                </div>
              )}
              {deal.genre && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">ジャンル</div>
                    <div className="text-sm text-slate-900">{deal.genre}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 中央：タブコンテンツ */}
        <div className="lg:col-span-6 space-y-4">
          {/* タブナビゲーション */}
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 flex items-center px-2">
              <button
                onClick={() => setActiveTab("overview")}
                className={clsx(
                  "px-4 py-3 text-sm font-bold border-b-2 transition",
                  activeTab === "overview"
                    ? "border-orange-600 text-orange-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                概要
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={clsx(
                  "px-4 py-3 text-sm font-bold border-b-2 transition",
                  activeTab === "activity"
                    ? "border-orange-600 text-orange-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                アクティビティー
              </button>
            </div>

            <div className="p-5">
              {/* 概要タブ */}
              {activeTab === "overview" && (
                <div className="space-y-5">
                  {deal.description ? (
                    <div>
                      <div className="text-xs font-extrabold text-slate-500 mb-2">詳細</div>
                      <div className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 rounded-lg p-4">
                        {deal.description}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600">詳細はまだ記入されていません。</div>
                  )}
                </div>
              )}

              {/* アクティビティタブ */}
              {activeTab === "activity" && (
                <div className="space-y-3">
                  {activities.length === 0 ? (
                    <div className="text-sm text-slate-600">アクティビティはまだありません。</div>
                  ) : (
                    activities.map((act, idx) => {
                      const dt = (act.createdAt as any)?.toDate?.() ? (act.createdAt as any).toDate() as Date : null;
                      return (
                        <div key={idx} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-xs font-extrabold text-sky-700 flex-shrink-0">
                            A
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-xs text-slate-500">{dt ? relativeFromNow(dt) : ""}</span>
                            </div>
                            <div className="text-sm text-slate-700">{act.message}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右側：サイドバー */}
        <div className="lg:col-span-3 space-y-4">
          {/* 顧客情報 */}
          {customer && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="text-xs font-extrabold text-slate-500 mb-3">顧客</div>
              <Link href={`/customers/${customer.id}`} className="block group">
                <div className="text-sm font-bold text-slate-900 group-hover:text-orange-700 transition">
                  {customer.name}
                </div>
                {customer.contactName && (
                  <div className="mt-1 text-xs text-slate-600">担当: {customer.contactName}</div>
                )}
                {customer.contactEmail && (
                  <div className="mt-1 text-xs text-slate-600">{customer.contactEmail}</div>
                )}
              </Link>
            </div>
          )}

          {/* 課題 */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-extrabold text-slate-500">課題 ({issues.length}件)</div>
              <Link href={`/projects/${projectId}/issues`} className="text-xs font-bold text-orange-700 hover:underline">
                すべて表示
              </Link>
            </div>
            {issues.length === 0 ? (
              <div className="text-sm text-slate-600">課題はまだありません。</div>
            ) : (
              <div className="space-y-2">
                {issues.slice(0, 5).map((issue) => (
                  <Link
                    key={issue.id}
                    href={`/issue/${issue.id}`}
                    className="block rounded-lg border border-slate-200 p-2 hover:bg-slate-50 transition"
                  >
                    <div className="text-xs font-bold text-orange-700">{issue.issueKey}</div>
                    <div className="text-sm text-slate-900 line-clamp-1">{issue.title}</div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Wiki */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-extrabold text-slate-500">Wiki ({wikis.length}件)</div>
              <Link href="/wiki" className="text-xs font-bold text-orange-700 hover:underline">
                開く
              </Link>
            </div>
            {wikis.length === 0 ? (
              <div className="text-sm text-slate-600">案件に紐づくWikiはまだありません。</div>
            ) : (
              <div className="space-y-2">
                {wikis.slice(0, 5).map((w) => (
                  <Link
                    key={w.id}
                    href={`/wiki/${w.id}`}
                    className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50 transition"
                  >
                    <div className="text-sm font-bold text-slate-900 line-clamp-1">{w.title || "無題"}</div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Drive */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-extrabold text-slate-500">ドライブ ({driveItems.length}件)</div>
              <Link
                href={driveItems.find((x) => x.kind === "folder") ? `/drive?folderId=${encodeURIComponent(driveItems.find((x) => x.kind === "folder")!.id)}` : "/drive"}
                className="text-xs font-bold text-orange-700 hover:underline"
              >
                開く
              </Link>
            </div>
            {driveItems.length === 0 ? (
              <div className="text-sm text-slate-600">この案件に紐づくドライブはまだありません。</div>
            ) : (
              <div className="space-y-2">
                {driveItems.slice(0, 6).map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span>{it.kind === "folder" ? "📁" : "📄"}</span>
                        <div className="truncate text-sm font-bold text-slate-900">{it.name}</div>
                      </div>
                    </div>
                    {it.kind === "folder" ? (
                      <Link
                        href={`/drive?folderId=${encodeURIComponent(it.id)}`}
                        className="shrink-0 text-xs font-bold text-orange-700 hover:underline"
                      >
                        開く →
                      </Link>
                    ) : it.url ? (
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs font-bold text-orange-700 hover:underline"
                      >
                        開く →
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs font-bold text-slate-400">-</span>
                    )}
                  </div>
                ))}
                <Link
                  href={`/drive/new?parentId=${encodeURIComponent(driveItems.find((x) => x.kind === "folder")?.id || "")}`}
                  className="block text-xs font-bold text-orange-700 hover:underline"
                >
                  ＋ この案件のフォルダを追加
                </Link>
              </div>
            )}
          </div>

          {/* アクション */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
            <Link
              href={`/projects/${projectId}/issues`}
              className="block w-full rounded-lg bg-orange-600 px-4 py-2 text-center text-sm font-extrabold text-white hover:bg-orange-700 transition"
            >
              課題一覧を見る
            </Link>
            <Link
              href={`/issue/new?projectId=${projectId}`}
              className="block w-full rounded-lg border border-orange-200 px-4 py-2 text-center text-sm font-bold text-orange-700 hover:bg-orange-50 transition"
            >
              ＋ 課題を追加
            </Link>
            <Link
              href={`/projects/${projectId}/settings`}
              className="block w-full rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              案件設定
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

