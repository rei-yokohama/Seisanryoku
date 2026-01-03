"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { type Activity } from "../../../lib/activity";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Customer = {
  id: string;
  companyCode: string;
  createdBy: string;
  name: string;
  type?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactAddress?: string;
  industry?: string;
  notes?: string;
  assigneeUid?: string;
  transactionStartDate?: string;
  contractAmount?: string;
  tags?: string[];
  createdAt?: any;
  updatedAt?: any;
};

type Deal = {
  id: string;
  title: string;
  status: string;
  customerId: string;
  genre?: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type WikiDoc = {
  id: string;
  title: string;
  customerId?: string | null;
  dealId?: string | null;
  updatedAt?: any;
};

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

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [wikis, setWikis] = useState<WikiDoc[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

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
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (!profSnap.exists()) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        // 顧客情報取得
        const custSnap = await getDoc(doc(db, "customers", customerId));
        if (!custSnap.exists()) {
          setCustomer(null);
          setLoading(false);
          return;
        }
        const cust = { id: custSnap.id, ...custSnap.data() } as Customer;
        setCustomer(cust);

        // この顧客に紐づく案件を取得
        const dealsSnap = await getDocs(query(collection(db, "deals"), where("customerId", "==", customerId)));
        const dealItems = dealsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Deal));
        setDeals(dealItems);

        // 顧客に紐づくWiki & アクティビティ
        if (prof.companyCode) {
          const wikiSnap = await getDocs(
            query(
              collection(db, "wikiDocs"),
              where("companyCode", "==", prof.companyCode),
              where("customerId", "==", customerId),
            ),
          );
          const wikiItems = wikiSnap.docs.map(d => ({ id: d.id, ...d.data() } as WikiDoc));
          wikiItems.sort((a, b) => ((b.updatedAt as any)?.toMillis?.() || 0) - ((a.updatedAt as any)?.toMillis?.() || 0));
          setWikis(wikiItems);

          const actSnap = await getDocs(query(collection(db, "activity"), where("companyCode", "==", prof.companyCode)));
          const actItems = actSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter((a: any) => a.entityId === customerId || (a.link && a.link.includes(customerId))) as Activity[];
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
  }, [customerId]);

  if (loading) {
    return (
      <AppShell title="顧客詳細" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !customer) {
    return (
      <AppShell title="顧客が見つかりません">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">顧客が見つかりません</div>
          <div className="mt-3">
            <Link href="/customers" className="text-sm font-bold text-orange-700 hover:underline">
              ← 顧客一覧に戻る
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={customer.name}
      subtitle="顧客詳細"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={`/customers/${customerId}/edit`}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            編集
          </Link>
          <Link href="/customers" className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 hover:bg-orange-50">
            ← 顧客一覧
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側：基本情報 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 顧客名 */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h1 className="text-lg font-extrabold text-slate-900 leading-tight mb-3">{customer.name}</h1>
          </div>

          {/* 顧客の概要 */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-xs font-extrabold text-slate-500 mb-3">この顧客の概要</div>
            <div className="space-y-3 text-sm text-slate-700">
              {customer.createdAt && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">登録日</div>
                    <div className="text-sm text-slate-900">
                      {new Date((customer.createdAt as any).toMillis()).toLocaleDateString("ja-JP")}
                    </div>
                  </div>
                </div>
              )}
              {customer.type && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">種別</div>
                    <div className="text-sm text-slate-900">{customer.type}</div>
                  </div>
                </div>
              )}
              {customer.industry && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-2"></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-500">業種</div>
                    <div className="text-sm text-slate-900">{customer.industry}</div>
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
                  {/* 連絡先情報 */}
                  {(customer.contactName || customer.contactEmail || customer.contactPhone || customer.contactAddress) && (
                    <div>
                      <div className="text-xs font-extrabold text-slate-500 mb-3">連絡先情報</div>
                      <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                        {customer.contactName && (
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-slate-500 w-20">担当者:</span>
                            <span className="text-sm text-slate-900">{customer.contactName}</span>
                          </div>
                        )}
                        {customer.contactEmail && (
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-slate-500 w-20">メール:</span>
                            <span className="text-sm text-slate-900">{customer.contactEmail}</span>
                          </div>
                        )}
                        {customer.contactPhone && (
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-slate-500 w-20">電話:</span>
                            <span className="text-sm text-slate-900">{customer.contactPhone}</span>
                          </div>
                        )}
                        {customer.contactAddress && (
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-slate-500 w-20">住所:</span>
                            <span className="text-sm text-slate-900">{customer.contactAddress}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 取引情報 */}
                  {(customer.transactionStartDate || customer.contractAmount) && (
                    <div>
                      <div className="text-xs font-extrabold text-slate-500 mb-3">取引情報</div>
                      <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                        {customer.transactionStartDate && (
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-slate-500 w-24">取引開始日:</span>
                            <span className="text-sm text-slate-900">{customer.transactionStartDate}</span>
                          </div>
                        )}
                        {customer.contractAmount && (
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-slate-500 w-24">契約金額:</span>
                            <span className="text-sm font-bold text-slate-900">{customer.contractAmount}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 備考 */}
                  {customer.notes && (
                    <div>
                      <div className="text-xs font-extrabold text-slate-500 mb-2">備考</div>
                      <div className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 rounded-lg p-4">
                        {customer.notes}
                      </div>
                    </div>
                  )}

                  {/* タグ */}
                  {customer.tags && customer.tags.length > 0 && (
                    <div>
                      <div className="text-xs font-extrabold text-slate-500 mb-2">タグ</div>
                      <div className="flex flex-wrap gap-2">
                        {customer.tags.map((tag, idx) => (
                          <span key={idx} className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* アクティビティタブ */}
              {activeTab === "activity" && (
                <div className="space-y-3">
                  {activities.length === 0 ? (
                    <div className="text-sm text-slate-600">アクティビティはまだありません。</div>
                  ) : (
                    <div className="space-y-3">
                      {activities.slice(0, 30).map((act, idx) => {
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
                              {act.link ? (
                                <Link href={act.link} className="inline-flex mt-2 text-xs font-bold text-orange-700 hover:underline">
                                  詳細 →
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右側：サイドバー */}
        <div className="lg:col-span-3 space-y-4">
          {/* 案件 */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-extrabold text-slate-500">案件 ({deals.length}件)</div>
              <Link href={`/projects/new?customerId=${customerId}`} className="text-xs font-bold text-orange-700 hover:underline">
                ＋ 追加
              </Link>
            </div>
            {deals.length === 0 ? (
              <div className="text-sm text-slate-600">案件はまだありません。</div>
            ) : (
              <div className="space-y-2">
                {deals.map((deal) => (
                  <Link
                    key={deal.id}
                    href={`/projects/${deal.id}/detail`}
                    className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-bold text-slate-900">{deal.title}</div>
                      <span
                        className={clsx(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-extrabold",
                          deal.status === "ACTIVE" ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-700"
                        )}
                      >
                        {deal.status === "ACTIVE" ? "稼働中" : "停止"}
                      </span>
                    </div>
                    {deal.genre && (
                      <div className="text-xs text-slate-600">{deal.genre}</div>
                    )}
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
              <div className="text-sm text-slate-600">顧客に紐づくWikiはまだありません。</div>
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

          {/* アクション */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
            <Link
              href={`/projects/new?customerId=${customerId}`}
              className="block w-full rounded-lg bg-orange-600 px-4 py-2 text-center text-sm font-extrabold text-white hover:bg-orange-700 transition"
            >
              ＋ 案件を追加
            </Link>
            <Link
              href={`/customers`}
              className="block w-full rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              顧客一覧へ戻る
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
