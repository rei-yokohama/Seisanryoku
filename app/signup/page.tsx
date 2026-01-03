"use client";

import { Suspense, useEffect, useState } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function generateWorkspaceCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function SignupInner() {
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState(""); // workspace name
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("invite");

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteCompanyCode, setInviteCompanyCode] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"member" | "admin" | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push("/dashboard");
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!token) return;
    setInviteToken(token);
    setInviteLoading(true);
    (async () => {
      try {
        const invSnap = await getDoc(doc(db, "teamInvites", token));
        if (!invSnap.exists()) {
          setError("招待リンクが無効です");
          return;
        }
        const inv = invSnap.data() as any;
        if (inv.usedAt) {
          setError("この招待リンクは既に使用されています");
          return;
        }
        if (!inv.companyCode || !inv.email) {
          setError("招待データが不正です");
          return;
        }
        setInviteCompanyCode(inv.companyCode);
        setInviteRole(inv.role === "admin" ? "admin" : "member");
        setEmail(String(inv.email));
        // セキュリティルール上、未ログイン状態で companies を参照しない（ワークスペース名は後から反映されます）
        setCompanyName("");
      } catch (e: any) {
        setError(e?.message || "招待リンクの読み込みに失敗しました");
      } finally {
        setInviteLoading(false);
      }
    })();
  }, [token]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }

    if (!companyName.trim() && !inviteCompanyCode) {
      setError("ワークスペース名を入力してください");
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
      const uid = userCredential.user.uid;
      
      // 1) ワークスペース（招待なしの場合は新規作成）
      let companyCode = (inviteCompanyCode || "").trim();
      const workspaceName = companyName.trim() || companyCode || "ワークスペース";
      if (!companyCode) {
        companyCode = generateWorkspaceCode();
        await setDoc(
          doc(db, "companies", companyCode),
          {
            companyName: workspaceName,
            ownerUid: uid,
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );
      }

      // 2) 所属（ワークスペースごとのデータ分離のキー）
      //    ドキュメントIDを安定させて重複を防ぐ
      await setDoc(
        doc(db, "workspaceMemberships", `${companyCode}_${uid}`),
        {
          uid,
          companyCode,
          role: inviteRole || "owner",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      // 3) プロフィール初期化（現在選択中のワークスペース）
      await setDoc(doc(db, "profiles", uid), {
        uid,
        displayName: name.trim(),
        companyName: workspaceName,
        email: email,
        companyCode,
        calendarLinked: false,
      });

      // 招待がある場合は使用済みにする
      if (inviteToken && inviteCompanyCode) {
        try {
          await updateDoc(doc(db, "teamInvites", inviteToken), {
            usedAt: Timestamp.now(),
            acceptedBy: uid,
          });
        } catch {
          // 招待の更新は失敗しても登録を止めない
        }
      }

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
            今すぐ始めよう！
          </h1>
          <p className="text-xl text-orange-900">
            30秒でアカウント作成。蜂のような効率的な工数管理を体験
          </p>
        </div>
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              🆓
            </div>
            <div>
              <p className="font-semibold text-orange-950">完全無料</p>
              <p className="text-sm text-orange-900">
                クレジットカード不要で今すぐ始められます
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              ⚡
            </div>
            <div>
              <p className="font-semibold text-orange-950">即日利用開始</p>
              <p className="text-sm text-orange-900">
                面倒な設定なし。登録後すぐに使えます
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
              🔒
            </div>
            <div>
              <p className="font-semibold text-orange-950">安全・安心</p>
              <p className="text-sm text-orange-900">
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
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-500 text-2xl shadow-lg">
                🐝
              </div>
              <span className="text-2xl font-bold text-orange-950">生産力</span>
            </Link>
          </div>

          <div className="rounded-3xl border-2 border-orange-200 bg-white p-8 shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">👔</span>
              <h2 className="text-3xl font-bold text-orange-950">{inviteToken ? "招待で参加" : "管理者登録"}</h2>
            </div>
            <p className="mb-6 text-orange-700">
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

            {inviteToken && (
              <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-xs text-orange-800">
                <div className="font-extrabold">ワークスペース招待を受け取り中</div>
                <div className="mt-1">
                  {inviteLoading ? "招待情報を読み込み中..." : `会社コード: ${inviteCompanyCode || "-"}`}{inviteRole ? ` / 権限: ${inviteRole === "admin" ? "管理者" : "メンバー"}` : ""}
                </div>
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-5">
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-semibold text-orange-900">
                  お名前 <span className="text-red-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="山田 太郎"
                  required
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <label htmlFor="companyName" className="mb-2 block text-sm font-semibold text-orange-900">
                  ワークスペース名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="例：採用代行事業、広告代理事業...etc"
                  required={!inviteToken}
                  disabled={!!inviteToken}
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
                {inviteToken ? (
                  <div className="mt-1 text-xs font-bold text-orange-700">
                    ※ 招待で参加する場合、ワークスペース名は後から自動で反映されます（コード: {inviteCompanyCode || "-"}）
                  </div>
                ) : null}
              </div>

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-semibold text-orange-900">
                  メールアドレス <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  disabled={!!inviteToken}
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-orange-900">
                  パスワード <span className="text-red-500">*</span>
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6文字以上"
                  required
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-orange-900">
                  パスワード（確認） <span className="text-red-500">*</span>
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="もう一度入力"
                  required
                  className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-orange-950 placeholder:text-orange-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 py-3 font-bold text-orange-950 shadow-lg transition hover:scale-105 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "作成中..." : "アカウントを作成"}
              </button>
            </form>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm text-orange-700">
                既にアカウントをお持ちですか？{" "}
                <Link
                  href="/login"
                  className="font-semibold text-orange-900 hover:text-orange-700"
                >
                  ログイン
                </Link>
              </p>
              <div className="border-t border-orange-200 pt-3">
                <p className="text-xs text-blue-700">
                  👤 社員の方は{" "}
                  <Link
                    href="/login"
                    className="font-semibold text-blue-600 underline hover:text-blue-800"
                  >
                    社員用ログインページ
                  </Link>
                  へ
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-orange-50 p-4 text-xs text-orange-700">
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

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
        </div>
      }
    >
      <SignupInner />
    </Suspense>
  );
}

