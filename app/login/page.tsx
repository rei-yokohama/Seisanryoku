"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push("/dashboard");
      }
    });
    return () => unsub();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        setError("メールアドレスまたはパスワードが正しくありません");
      } else if (err.code === "auth/invalid-email") {
        setError("メールアドレスの形式が正しくありません");
      } else if (err.code === "auth/too-many-requests") {
        setError("ログイン試行回数が多すぎます。しばらく待ってから再度お試しください");
      } else {
        setError(err.message || "ログインに失敗しました");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">
              P
            </div>
            <div className="font-extrabold text-slate-900">生産力</div>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/signup" className="text-sm font-extrabold text-slate-600 hover:text-orange-600">
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-slate-900">ログイン</h1>
          <p className="mt-2 text-sm text-slate-600">メールアドレスとパスワードでログインしてください。</p>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-emerald-50/40 p-6 sm:p-10">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleLogin} className="mx-auto max-w-xl space-y-4">
            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">メールアドレス *</div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">パスワード *</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8文字以上"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-orange-600 px-6 py-3 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
            </div>

            <div className="pt-2 text-center text-sm text-slate-600">
              アカウントがない方は{" "}
              <Link href="/signup" className="font-extrabold text-orange-700 hover:underline">
                新規登録
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

