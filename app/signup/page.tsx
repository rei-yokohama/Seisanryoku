"use client";

import { useState, useEffect } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }

    if (!companyName.trim()) {
      setError("社名を入力してください");
      return;
    }

    if (password !== confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }

    if (password.length < 6) {
      setError("パスワードは6文字以上で設定してください");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // プロフィール初期化
      await setDoc(doc(db, "profiles", userCredential.user.uid), {
        uid: userCredential.user.uid,
        displayName: name.trim(),
        companyName: companyName.trim(),
        email: email,
        companyCode: "",
        calendarLinked: false,
      });

      router.push("/dashboard");
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === "auth/email-already-in-use") {
        setError("このメールアドレスは既に使用されています");
      } else if (err.code === "auth/invalid-email") {
        setError("メールアドレスの形式が正しくありません");
      } else if (err.code === "auth/weak-password") {
        setError("パスワードは6文字以上で設定してください");
      } else {
        setError(err.message || "アカウント作成に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-50 to-emerald-50">
      {/* Left Side - Branding */}
      <div className="hidden w-1/2 flex-col justify-center bg-gradient-to-br from-emerald-400 to-emerald-500 p-12 lg:flex">
        <Link href="/" className="mb-12 flex items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-4xl shadow-xl">
            🐝
          </div>
          <div>
            <p className="text-3xl font-bold text-emerald-950">生産力</p>
            <p className="text-sm text-emerald-900">Seisanryoku</p>
          </div>
        </Link>
        <div className="mb-8">
          <h1 className="mb-4 text-5xl font-bold text-emerald-950">
            今すぐ始めよう！
          </h1>
          <p className="text-xl text-emerald-900">
            30秒でアカウント作成。蜂のような効率的な工数管理を体験
          </p>
        </div>
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              🆓
            </div>
            <div>
              <p className="font-semibold text-emerald-950">完全無料</p>
              <p className="text-sm text-emerald-900">
                クレジットカード不要で今すぐ始められます
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              ⚡
            </div>
            <div>
              <p className="font-semibold text-emerald-950">即日利用開始</p>
              <p className="text-sm text-emerald-900">
                面倒な設定なし。登録後すぐに使えます
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              🔒
            </div>
            <div>
              <p className="font-semibold text-emerald-950">安全・安心</p>
              <p className="text-sm text-emerald-900">
                Firebaseで暗号化。セキュリティは万全です
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Signup Form */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-2xl shadow-lg">
                🐝
              </div>
              <span className="text-2xl font-bold text-emerald-950">生産力</span>
            </Link>
          </div>

          <div className="rounded-3xl border-2 border-emerald-200 bg-white p-8 shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">👔</span>
              <h2 className="text-3xl font-bold text-emerald-950">管理者登録</h2>
            </div>
            <p className="mb-6 text-emerald-700">
              無料でアカウントを作成して今すぐ始める
            </p>
            <div className="mb-6 rounded-xl bg-blue-50 p-4 text-xs text-blue-800">
              <p className="mb-1 font-semibold">👤 社員として参加される方へ</p>
              <p>
                管理者から受け取ったメールアドレスとパスワードを使って、
                こちらでアカウントを作成してください。
              </p>
            </div>

            {error && (
              <div className="mb-6 rounded-xl border-2 border-red-500/50 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-5">
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-semibold text-emerald-900">
                  お名前 <span className="text-red-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="山田 太郎"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <div>
                <label htmlFor="companyName" className="mb-2 block text-sm font-semibold text-emerald-900">
                  社名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="株式会社サンプル"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-semibold text-emerald-900">
                  メールアドレス <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-emerald-900">
                  パスワード <span className="text-red-500">*</span>
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6文字以上"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-emerald-900">
                  パスワード（確認） <span className="text-red-500">*</span>
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="もう一度入力"
                  required
                  className="w-full rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-500 py-3 font-bold text-emerald-950 shadow-lg transition hover:scale-105 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "作成中..." : "アカウントを作成"}
              </button>
            </form>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm text-emerald-700">
                既にアカウントをお持ちですか？{" "}
                <Link
                  href="/login"
                  className="font-semibold text-emerald-900 hover:text-emerald-700"
                >
                  ログイン
                </Link>
              </p>
              <div className="border-t border-emerald-200 pt-3">
                <p className="text-xs text-blue-700">
                  👤 社員の方は{" "}
                  <Link
                    href="/employee-login"
                    className="font-semibold text-blue-600 underline hover:text-blue-800"
                  >
                    社員用ログインページ
                  </Link>
                  へ
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-xs text-emerald-700">
              <p>
                アカウント作成により、
                <Link href="#" className="underline">利用規約</Link>
                および
                <Link href="#" className="underline">プライバシーポリシー</Link>
                に同意したものとみなされます。
              </p>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-sm text-emerald-700 hover:text-emerald-900"
            >
              ← ホームに戻る
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

