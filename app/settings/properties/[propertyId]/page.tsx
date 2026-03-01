"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { deleteDoc, doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { ensureProfile } from "../../../../lib/ensureProfile";
import type { Property } from "../../../../lib/properties";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

export default function PropertyDetailPage() {
  const router = useRouter();
  const params = useParams<{ propertyId: string }>();
  const propertyId = params.propertyId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as MemberProfile | null;
        if (!prof?.companyCode) {
          setLoading(false);
          router.push("/login");
          return;
        }
        setProfile(prof);

        const snap = await getDoc(doc(db, "properties", propertyId));
        if (!snap.exists()) {
          setProperty(null);
          setLoading(false);
          return;
        }
        setProperty({ id: snap.id, ...(snap.data() as Omit<Property, "id">) });
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, propertyId]);

  const handleDelete = async () => {
    if (!property || property.isSystem) return;
    if (!confirm(`プロパティ「${property.name}」を削除しますか？`)) return;
    try {
      await deleteDoc(doc(db, "properties", property.id));
      router.push("/settings/properties");
    } catch (e: any) {
      setError(e?.message || "削除に失敗しました");
    }
  };

  if (loading) {
    return (
      <AppShell title="プロパティ詳細" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  if (!property) {
    return (
      <AppShell title="プロパティ詳細" subtitle="見つかりません">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-extrabold text-slate-900">プロパティ詳細</h1>
            <Link
              href="/settings/properties"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              ← 一覧に戻る
            </Link>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm font-bold text-slate-700">
            このプロパティは見つかりませんでした。
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="プロパティ詳細"
      subtitle={
        <div className="flex items-center gap-2 text-xs">
          <Link href="/settings" className="hover:underline text-slate-500">
            設定
          </Link>
          <span className="text-slate-400">/</span>
          <Link href="/settings/properties" className="hover:underline text-slate-500">
            プロパティ
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">{property.name}</span>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-900">プロパティ詳細</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/settings/properties"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              ← 一覧に戻る
            </Link>
            <Link
              href={`/settings/properties/${property.id}/edit`}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
            >
              編集
            </Link>
          </div>
        </div>

        {/* 基本情報 */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-4">基本情報</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">名前</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{property.name}</div>
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">キー</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{property.key}</div>
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">タイプ</div>
              <div className="mt-1">
                <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-600">
                  {property.type}
                </span>
              </div>
            </div>
            <div className="md:col-span-3">
              <div className="text-xs font-extrabold text-slate-500">システム</div>
              <div className="mt-1 text-sm font-bold text-slate-900">
                {property.isSystem ? "はい" : "いいえ"}
              </div>
            </div>
            <div className="md:col-span-3">
              <div className="text-xs font-extrabold text-slate-500">並び順</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{property.sortOrder}</div>
            </div>
          </div>
        </div>

        {/* 選択肢一覧 */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-3">選択肢</div>
          {property.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {property.options.map((opt) => (
                <span
                  key={opt}
                  className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700"
                >
                  {opt}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400">選択肢がありません</div>
          )}
        </div>

        {/* 削除ゾーン（カスタムプロパティのみ） */}
        {!property.isSystem && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5">
            <div className="text-sm font-extrabold text-red-700 mb-2">危険な操作</div>
            <div className="text-xs font-bold text-red-600 mb-3">
              このプロパティを削除すると、関連するデータも影響を受ける可能性があります。
            </div>
            <button
              onClick={handleDelete}
              className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-extrabold text-red-600 hover:bg-red-100"
            >
              プロパティを削除
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
