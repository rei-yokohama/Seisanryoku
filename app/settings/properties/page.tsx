"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  addDoc,
  collection,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import { ensureProperties } from "../../../lib/properties";
import type { Property } from "../../../lib/properties";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

const PROPERTY_DESCRIPTIONS: Record<string, string> = {
  category: "課題（イシュー）の分類に使用",
  dealCategory: "案件（プロジェクト）の分類に使用",
  issueStatus: "課題（イシュー）の進捗状態",
};

export default function PropertiesSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);

  // 新規プロパティ追加
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }
      const prof = (await ensureProfile(u)) as MemberProfile | null;
      if (!prof?.companyCode) {
        setLoading(false);
        return;
      }
      setProfile(prof);
      const props = await ensureProperties(prof.companyCode);
      setProperties(props);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const handleAddProperty = async () => {
    if (!profile?.companyCode || !newName.trim()) return;
    setAdding(true);
    try {
      const key = newName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 30);
      const ref = await addDoc(collection(db, "properties"), {
        companyCode: profile.companyCode,
        name: newName.trim(),
        key,
        type: "select",
        options: [],
        isSystem: false,
        sortOrder: properties.length,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      setNewName("");
      setShowAdd(false);
      router.push(`/settings/properties/${ref.id}`);
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="プロパティ設定" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title="プロパティ設定"
      subtitle={
        <div className="flex items-center gap-2 text-xs">
          <Link href="/settings" className="hover:underline text-slate-500">
            設定
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-700 font-bold">プロパティ</span>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-900">
            プロパティ設定
          </h1>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
          >
            + プロパティを追加
          </button>
        </div>

        {showAdd && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
            <div className="text-sm font-bold text-slate-700 mb-2">
              新しいプロパティ
            </div>
            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="プロパティ名（例：種別）"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddProperty();
                }}
              />
              <button
                onClick={handleAddProperty}
                disabled={adding || !newName.trim()}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {adding ? "追加中..." : "追加"}
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setNewName("");
                }}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {properties.map((prop) => (
            <div
              key={prop.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  {prop.isSystem && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 border border-amber-200">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      システム
                    </span>
                  )}
                  <span className="text-sm font-extrabold text-slate-900">
                    {prop.name}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                    {prop.key}
                  </span>
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-600">
                    {prop.type}
                  </span>
                </div>
                <Link
                  href={`/settings/properties/${prop.id}`}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex-shrink-0"
                >
                  詳細
                </Link>
              </div>
              {PROPERTY_DESCRIPTIONS[prop.key] && (
                <div className="mt-2 text-[11px] font-bold text-slate-400">
                  {PROPERTY_DESCRIPTIONS[prop.key]}
                </div>
              )}
              {prop.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {prop.options.map((opt) => (
                    <span
                      key={opt}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                    >
                      {opt}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/settings"
            className="text-sm font-bold text-orange-700 hover:underline"
          >
            設定に戻る
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
