"use client";

import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  updateEmail,
  updateProfile,
  User,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
        if (snap.exists()) {
          const p = snap.data() as MemberProfile;
          setProfile(p);
          setDisplayName(p.displayName || u.displayName || "");
          setNewEmail(u.email || p.email || "");
        } else {
          setDisplayName(u.displayName || "");
          setNewEmail(u.email || "");
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const currentEmail = useMemo(() => user?.email || "", [user?.email]);

  const saveDisplayName = async () => {
    if (!user) return;
    setError("");
    setSuccess("");
    const name = displayName.trim();
    if (!name) {
      setError("表示名を入力してください");
      return;
    }
    setSavingName(true);
    try {
      // auth displayName
      await updateProfile(user, { displayName: name });
      // profiles displayName
      await updateDoc(doc(db, "profiles", user.uid), { displayName: name });
      setSuccess("表示名を更新しました");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSavingName(false);
    }
  };

  const saveEmail = async () => {
    if (!user) return;
    setError("");
    setSuccess("");
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setError("メールアドレスを入力してください");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("メールアドレスの形式が正しくありません");
      return;
    }
    if (email === (user.email || "").toLowerCase()) {
      setSuccess("メールアドレスは変更されていません");
      return;
    }

    setSavingEmail(true);
    try {
      await updateEmail(user, email);
      await updateDoc(doc(db, "profiles", user.uid), { email });
      setSuccess("メールアドレスを更新しました");
    } catch (e: any) {
      const code = String(e?.code || "");
      if (code.includes("requires-recent-login")) {
        setError("安全のため、再ログインが必要です。いったんログアウト→ログインし直してから再実行してください。");
      } else if (code.includes("email-already-in-use")) {
        setError("このメールアドレスは既に使用されています");
      } else if (code.includes("invalid-email")) {
        setError("メールアドレスの形式が正しくありません");
      } else {
        setError(e?.message || "更新に失敗しました");
      }
    } finally {
      setSavingEmail(false);
    }
  };

  const sendReset = async () => {
    if (!user?.email) return;
    setError("");
    setSuccess("");
    setSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setSuccess("パスワードリセットメールを送信しました。メールをご確認ください。");
    } catch (e: any) {
      setError(e?.message || "送信に失敗しました");
    } finally {
      setSendingReset(false);
    }
  };

  const doLogout = async () => {
    setError("");
    setSuccess("");
    try {
      await signOut(auth);
      router.push("/login");
    } catch (e: any) {
      setError(e?.message || "ログアウトに失敗しました");
    }
  };

  if (loading) {
    return (
      <AppShell title="ユーザー設定" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="ユーザー設定"
      subtitle="ユーザー情報 / メール / パスワード"
      headerRight={
        <Link
          href="/settings"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← 設定トップ
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
        {success ? (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-700">{success}</div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">ユーザー情報</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">表示名 *</div>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
              <div className="mt-2">
                <button
                  onClick={saveDisplayName}
                  disabled={savingName}
                  className={clsx(
                    "rounded-xl px-4 py-2 text-sm font-extrabold",
                    savingName ? "bg-orange-300 text-white" : "bg-orange-600 text-white hover:bg-orange-700",
                  )}
                  type="button"
                >
                  {savingName ? "保存中..." : "表示名を保存"}
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">ユーザーID</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-800">
                {user.uid}
              </div>
              <div className="mt-2 text-xs font-bold text-slate-500">（内部識別子）</div>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">会社コード</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-800">
                {profile?.companyCode || "-"}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">メールアドレス</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">現在のメール</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-800">
                {currentEmail || "-"}
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">新しいメール</div>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="new@example.com"
              />
              <div className="mt-2">
                <button
                  onClick={saveEmail}
                  disabled={savingEmail}
                  className={clsx(
                    "rounded-xl px-4 py-2 text-sm font-extrabold",
                    savingEmail ? "bg-orange-300 text-white" : "bg-orange-600 text-white hover:bg-orange-700",
                  )}
                  type="button"
                >
                  {savingEmail ? "更新中..." : "メールを更新"}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs font-bold text-slate-500">
            メール変更はセキュリティ上、再ログインが必要になる場合があります。
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">パスワード</div>
          <div className="text-sm font-bold text-slate-600">
            パスワードは、登録メール宛にリセットリンクを送って変更します。
          </div>
          <div className="mt-3">
            <button
              onClick={sendReset}
              disabled={sendingReset || !user.email}
              className={clsx(
                "rounded-xl px-4 py-2 text-sm font-extrabold",
                sendingReset ? "bg-slate-300 text-white" : "bg-slate-800 text-white hover:bg-slate-900",
              )}
              type="button"
            >
              {sendingReset ? "送信中..." : "パスワードリセットメールを送信"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">ログアウト</div>
          <div className="text-sm font-bold text-slate-600">
            共有端末を利用している場合は、ログアウトをおすすめします。
          </div>
          <div className="mt-3">
            <button
              onClick={doLogout}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-950"
              type="button"
            >
              ログアウト
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


