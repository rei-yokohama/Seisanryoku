"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function EmployeeLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push("/employee-dashboard");
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
      router.push("/employee-dashboard");
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === "auth/invalid-credential") {
        setError("メールアドレスまたはパスワードが間違っています");
      } else if (err.code === "auth/user-not-found") {
        setError("このメールアドレスは登録されていません。管理者に確認してください。");
      } else {
        setError(err.message || "ログインに失敗しました");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-50 to-emerald-50">
      {/* Left Side - Branding */}
      <div className="hidden items-center justify-center bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-500 p-12 lg:flex lg:w-1/2">
        <div className="text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
              <span className="text-6xl">🐝</span>
            </div>
          </div>
          <h1 className="mb-4 text-5xl font-bold text-white drop-shadow-lg">
            生産力
          </h1>
          <p className="mb-8 text-xl text-white/90">
            蜂のように効率的な工数管理SaaS
          </p>
          <div className="rounded-2xl bg-white/10 p-6 backdrop-blur-sm">
            <p className="text-lg font-semibold text-white">👤 社員用ログイン</p>
            <p className="mt-2 text-sm text-white/80">
              管理者から受け取ったメールアドレスとパスワードでログインしてください
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="mb-8 text-center lg:hidden">
            <div className="mb-3 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-3xl shadow-lg">
                🐝
              </div>
            </div>
            <h1 className="text-3xl font-bold text-emerald-950">生産力</h1>
            <p className="text-emerald-700">社員用ログイン</p>
          </div>

          <div className="rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">👤</span>
              <h2 className="text-3xl font-bold text-emerald-950">社員ログイン</h2>
            </div>
            <p className="mb-6 text-emerald-700">
              管理者から受け取った情報でログイン
            </p>

            {error && (
              <div className="mb-6 rounded-xl border-2 border-red-500/50 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-emerald-900"
                >
                  メールアドレス
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="employee@example.com"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-semibold text-emerald-900"
                >
                  パスワード
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="管理者から受け取ったパスワード"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-500 py-3 font-bold text-emerald-950 shadow-lg transition hover:scale-105 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
            </form>

            <div className="mt-6 space-y-3">
              <div className="rounded-xl bg-emerald-50 p-4 text-xs text-emerald-800">
                <p className="mb-1 font-semibold">👔 管理者の方はこちら</p>
                <p>
                  <Link href="/login" className="font-bold text-emerald-900 underline">
                    管理者用ログインページ
                  </Link>
                  からログインしてください。
                </p>
              </div>
            </div>

            <div className="mt-6 text-center text-xs text-emerald-600">
              <Link
                href="/"
                className="font-semibold underline transition hover:text-emerald-900"
              >
                ← ホームに戻る
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

