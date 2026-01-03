"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  companyCode: string;
};

type EmploymentType = "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託";

type Employee = {
  name: string;
  email: string;
  employmentType: EmploymentType;
  joinDate: string;
  color?: string;
  allowCalendarSync?: boolean;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const EMPLOYEE_COLORS = [
  { name: "ブルー", value: "#3B82F6" },
  { name: "グリーン", value: "#10B981" },
  { name: "パープル", value: "#8B5CF6" },
  { name: "ピンク", value: "#EC4899" },
  { name: "オレンジ", value: "#F97316" },
  { name: "レッド", value: "#EF4444" },
  { name: "イエロー", value: "#EAB308" },
  { name: "シアン", value: "#06B6D4" },
  { name: "インディゴ", value: "#6366F1" },
  { name: "ティール", value: "#14B8A6" },
];

const generateRandomPassword = (length = 12) => {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i++) out += charset.charAt(Math.floor(Math.random() * charset.length));
  return out;
};

export default function MemberCreatePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<null | { email: string; password: string }>(null);

  const [form, setForm] = useState<Employee>({
    name: "",
    email: "",
    employmentType: "正社員",
    joinDate: new Date().toISOString().slice(0, 10),
    color: EMPLOYEE_COLORS[0].value,
    allowCalendarSync: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "profiles", u.uid));
        if (snap.exists()) setProfile(snap.data() as MemberProfile);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const canSubmit = useMemo(() => {
    return !!form.name.trim() && !!form.email.trim();
  }, [form.email, form.name]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("コピーしました");
    } catch {
      alert("コピーに失敗しました");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError("");

    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name) return setError("名前を入力してください");
    if (!email) return setError("メールアドレスを入力してください");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("メールアドレスの形式が正しくありません");

    setSaving(true);
    try {
      const password = generateRandomPassword(12);

      // Firebase Authenticationにユーザーを作成
      const authResponse = await fetch("/api/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName: name }),
      });
      const authData = await authResponse.json();
      if (!authResponse.ok) throw new Error(authData.error || "認証アカウントの作成に失敗しました");

      await addDoc(collection(db, "employees"), {
        name,
        email,
        employmentType: form.employmentType,
        joinDate: form.joinDate,
        color: form.color,
        allowCalendarSync: form.allowCalendarSync,
        authUid: authData.uid,
        password,
        companyCode: profile?.companyCode || "",
        createdBy: user.uid,
        createdAt: Timestamp.now(),
      });

      setCreated({ email, password });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "作成に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="メンバー作成" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="メンバー作成"
      subtitle="新しいメンバーを追加"
      headerRight={
        <Link
          href="/settings/members"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← 一覧に戻る
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>
        ) : null}

        {created ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-6">
            <div className="text-lg font-extrabold text-orange-900">作成しました</div>
            <div className="mt-3 space-y-3 text-sm font-bold text-orange-900">
              <div className="rounded-xl bg-white p-4 border border-orange-200">
                <div className="text-xs text-orange-700">メールアドレス</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="font-mono">{created.email}</div>
                  <button onClick={() => void copyToClipboard(created.email)} className="rounded bg-orange-200 px-3 py-1 text-xs" type="button">
                    コピー
                  </button>
                </div>
              </div>
              <div className="rounded-xl bg-white p-4 border border-orange-200">
                <div className="text-xs text-orange-700">初期パスワード</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="font-mono break-all">{created.password}</div>
                  <button onClick={() => void copyToClipboard(created.password)} className="rounded bg-orange-200 px-3 py-1 text-xs" type="button">
                    コピー
                  </button>
                </div>
              </div>
              <button
                onClick={() => void copyToClipboard(`メール: ${created.email}\nパスワード: ${created.password}`)}
                className="w-full rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm font-extrabold text-orange-900 hover:bg-orange-100"
                type="button"
              >
                📋 両方をコピー
              </button>
            </div>
            <div className="mt-3 text-xs font-bold text-orange-700">
              社員は <Link className="underline" href="/login">ログイン</Link> からログインできます。
            </div>
            <div className="mt-4">
              <Link href="/settings/members" className="inline-flex rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700">
                一覧へ戻る
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">名前 *</div>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="山田 太郎"
                  required
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">メールアドレス *</div>
                <input
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="yamada@example.com"
                  required
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">雇用形態 *</div>
                <select
                  value={form.employmentType}
                  onChange={(e) => setForm((p) => ({ ...p, employmentType: e.target.value as EmploymentType }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  {(["正社員", "契約社員", "パート", "アルバイト", "業務委託"] as const).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">入社日 *</div>
                <input
                  type="date"
                  value={form.joinDate}
                  onChange={(e) => setForm((p) => ({ ...p, joinDate: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-bold text-slate-700">カレンダー表示色</div>
              <div className="grid grid-cols-5 gap-3">
                {EMPLOYEE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, color: c.value }))}
                    className={clsx(
                      "rounded-lg border p-3 transition hover:shadow-sm",
                      form.color === c.value ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-white",
                    )}
                    title={c.name}
                  >
                    <div className="mx-auto h-6 w-6 rounded-full" style={{ backgroundColor: c.value }} />
                    <div className="mt-1 text-center text-[10px] font-bold text-slate-600">{c.name}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={form.allowCalendarSync !== false}
                onChange={(e) => setForm((p) => ({ ...p, allowCalendarSync: e.target.checked }))}
                className="h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-extrabold text-slate-900">Googleカレンダー連携を許可</div>
                <div className="text-xs font-bold text-slate-600">この社員がカレンダー同期できるようにします</div>
              </div>
            </label>

            <div className="flex items-center justify-end gap-3">
              <Link href="/settings/members" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                キャンセル
              </Link>
              <button
                disabled={saving || !canSubmit}
                className="rounded-xl bg-orange-600 px-6 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
                type="submit"
              >
                {saving ? "作成中..." : "作成"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}


