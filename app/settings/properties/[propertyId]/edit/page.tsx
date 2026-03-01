"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, Timestamp, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../../lib/firebase";
import { ensureProfile } from "../../../../../lib/ensureProfile";
import type { Property } from "../../../../../lib/properties";
import { AppShell } from "../../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

export default function PropertyEditPage() {
  const router = useRouter();
  const params = useParams<{ propertyId: string }>();
  const propertyId = params.propertyId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 編集用ローカルstate
  const [name, setName] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState("");

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
        const prop = { id: snap.id, ...(snap.data() as Omit<Property, "id">) };
        setProperty(prop);
        setName(prop.name);
        setOptions([...prop.options]);
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, propertyId]);

  const handleAddOption = () => {
    const opt = newOption.trim();
    if (!opt || options.includes(opt)) return;
    setOptions((prev) => [...prev, opt]);
    setNewOption("");
  };

  const handleRemoveOption = (opt: string) => {
    setOptions((prev) => prev.filter((o) => o !== opt));
  };

  const handleSave = async () => {
    if (!property) return;
    const n = name.trim();
    if (!n) {
      setError("名前を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "properties", property.id), {
        ...(!property.isSystem ? { name: n } : {}),
        options,
        updatedAt: Timestamp.now(),
      });
      router.push(`/settings/properties/${property.id}`);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="プロパティ編集" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  if (!property) {
    return (
      <AppShell title="プロパティ編集" subtitle="見つかりません">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-extrabold text-slate-900">プロパティ編集</h1>
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
      title="プロパティ編集"
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
          <Link
            href={`/settings/properties/${property.id}`}
            className="hover:underline text-slate-500"
          >
            {property.name}
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">編集</span>
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
          <h1 className="text-lg font-extrabold text-slate-900">プロパティ編集</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/settings/properties/${property.id}`}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              ← 詳細へ
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`rounded-md px-4 py-2 text-sm font-extrabold text-white ${saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700"}`}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {/* 基本情報 */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-4">基本情報</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-500">名前</div>
              {property.isSystem ? (
                <>
                  <input
                    value={name}
                    readOnly
                    className="mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"
                  />
                  <div className="mt-1 text-[11px] font-bold text-slate-500">
                    ※ システムプロパティの名前は変更できません
                  </div>
                </>
              ) : (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                />
              )}
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">キー</div>
              <input
                value={property.key}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"
              />
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">タイプ</div>
              <input
                value={property.type}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"
              />
            </div>
          </div>
        </div>

        {/* 選択肢管理 */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-3">選択肢</div>

          <div className="flex flex-wrap gap-2 mb-4">
            {options.map((opt) => (
              <span
                key={opt}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700"
              >
                {opt}
                <button
                  onClick={() => handleRemoveOption(opt)}
                  className="text-slate-400 hover:text-red-500"
                  title="削除"
                >
                  &times;
                </button>
              </span>
            ))}
            {options.length === 0 && (
              <span className="text-xs text-slate-400">選択肢がありません</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              placeholder="新しい選択肢"
              className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddOption();
              }}
            />
            <button
              onClick={handleAddOption}
              disabled={!newOption.trim()}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-orange-700 disabled:opacity-50"
            >
              追加
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
