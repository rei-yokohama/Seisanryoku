"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { AppShell } from "../../AppShell";

export default function CompanySettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [companyCode, setCompanyCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const generateCompanyCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

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
        if (profSnap.exists()) {
          const prof = profSnap.data() as any;
          const code = String(prof.companyCode || "");
          const name = String(prof.companyName || "");
          setCompanyCode(code);
          setCompanyName(name);

          if (code) {
            const compSnap = await getDoc(doc(db, "companies", code));
            if (compSnap.exists()) {
              const c = compSnap.data() as any;
              if (c.companyName) setCompanyName(String(c.companyName));
            }
          }
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const handleSave = async () => {
    if (!user) return;
    const name = companyName.trim();
    if (!name) {
      setError("会社名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      let code = companyCode.trim();
      if (!code) {
        code = generateCompanyCode();
        setCompanyCode(code);
      }

      // companies/{companyCode}
      await setDoc(
        doc(db, "companies", code),
        {
          companyName: name,
          ownerUid: user.uid,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      // profiles/{uid}
      await updateDoc(doc(db, "profiles", user.uid), {
        companyName: name,
        companyCode: code,
      });

      setSuccess("会社情報を保存しました（ヘッダーの社名に反映されます）");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="会社設定"
      subtitle="会社情報・会社コード"
      headerRight={
        <Link
          href="/settings"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← 設定トップ
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">会社情報</div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? (
            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-700">
              {success}
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm font-bold text-slate-600">読み込み中...</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">会社名 *</div>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：株式会社サンプル"
                />
                <div className="mt-1 text-xs text-slate-500">右上の社名表示に使われます。</div>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">会社コード</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={companyCode}
                    onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                    className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    placeholder="未設定（保存時に自動生成）"
                    disabled={!!companyCode}
                  />
                  {!companyCode ? (
                    <button
                      onClick={() => setCompanyCode(generateCompanyCode())}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      type="button"
                    >
                      生成
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-slate-500">チーム招待・チーム機能の識別に使います。作成後は変更不可。</div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !user}
                  className="rounded-xl bg-orange-500 px-6 py-3 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
                  type="button"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}


