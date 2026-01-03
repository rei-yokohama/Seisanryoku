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
    <div className="flex min-h-screen bg-gradient-to-br from-orange-50 via-orange-50 to-orange-50">
      {/* Left Side - Branding */}
      <div className="hidden w-1/2 flex-col justify-center bg-gradient-to-br from-orange-400 to-orange-500 p-12 lg:flex">
        <Link href="/" className="mb-12 flex items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-4xl shadow-xl">
            🐝
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-950">生産力</p>
            <p className="text-sm text-orange-900">Seisanryoku</p>
          </div>
        </Link>
        <div className="mb-8">
          <h1 className="mb-4 text-5xl font-bold text-orange-950">
            おかえりなさい！
          </h1>
          <p className="text-xl text-orange-900">
            蜂のように効率的な工数管理を、今日も始めましょう
          </p>
        </div>
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              ✓
            </div>
            <div>
              <p className="font-semibold text-orange-950">即座にアクセス</p>
              <p className="text-sm text-orange-900">
                すべての工数データにすぐにアクセスできます
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              ✓
            </div>
            <div>
              <p className="font-semibold text-orange-950">セキュア</p>
              <p className="text-sm text-orange-900">
                データは暗号化され、安全に保護されています
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              ✓
            </div>
            <div>
              <p className="font-semibold text-orange-950">どこからでも</p>
              <p className="text-sm text-orange-900">
                マルチデバイス対応で、場所を選びません
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-500 text-2xl shadow-lg">
                🐝
              </div>
              <span className="text-2xl font-bold text-orange-950">生産力</span>
            </Link>
          </div>

          <div className="rounded-3xl border-2 border-orange-200 bg-white p-8 shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">🔐</span>
              <h2 className="text-3xl font-bold text-orange-950">ログイン</h2>
            </div>
            <p className="mb-6 text-orange-700">
              社員・管理者どちらも同じ画面からログインできます
            </p>

            {error && (
              <div className="mb-6 rounded-xl border-2 border-red-500/50 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-semibold text-orange-900">
                  メールアドレス
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-orange-900">
                  パスワード
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 py-3 font-bold text-orange-950 shadow-lg transition hover:scale-105 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
            </form>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm text-orange-700">
                アカウントをお持ちでないですか？{" "}
                <Link
                  href="/signup"
                  className="font-semibold text-orange-900 hover:text-orange-700"
                >
                  新規登録
                </Link>
              </p>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-sm text-orange-700 hover:text-orange-900"
            >
              ← ホームに戻る
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

