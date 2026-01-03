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
  const [workspaceId, setWorkspaceId] = useState("");
  const [companyName, setCompanyName] = useState(""); // 社名（ワークスペース名）
  const [phone, setPhone] = useState("");
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
        setWorkspaceId(String(inv.companyCode));
        // セキュリティルール上、未ログイン状態で companies を参照しない（社名は後から反映されます）
        setCompanyName("");
      } catch (e: any) {
        setError(e?.message || "招待リンクの読み込みに失敗しました");
      } finally {
        setInviteLoading(false);
      }
    })();
  }, [token]);

  const normalizeWorkspaceId = (raw: string) => {
    // Backlog風: 半角英数字 + ハイフン、3〜20文字
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/--+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }

    const workspaceName = companyName.trim();
    if (!workspaceName && !inviteCompanyCode) {
      setError("社名（ワークスペース名）を入力してください");
      return;
    }

    const wsId = inviteCompanyCode ? String(inviteCompanyCode) : normalizeWorkspaceId(workspaceId);
    if (!wsId) {
      setError("ワークスペースIDを入力してください（半角英数字・ハイフン）");
      return;
    }
    if (!inviteCompanyCode && (wsId.length < 3 || wsId.length > 20)) {
      setError("ワークスペースIDは3〜20文字で入力してください");
      return;
    }

    if (!phone.trim() && !inviteCompanyCode) {
      setError("電話番号を入力してください");
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
      let companyCode = wsId;
      if (!inviteCompanyCode) {
        // 既存チェック（上書きを防止）
        const existsSnap = await getDoc(doc(db, "companies", companyCode));
        if (existsSnap.exists()) {
          setError("このワークスペースIDは既に使用されています。別のIDを入力してください。");
          setLoading(false);
          return;
        }
        await setDoc(
          doc(db, "companies", companyCode),
          {
            companyName: workspaceName,
            phone: phone.trim(),
            ownerUid: uid,
            updatedAt: Timestamp.now(),
            createdAt: Timestamp.now(),
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
        defaultCompanyCode: companyCode,
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
            <Link href="/login" className="text-sm font-extrabold text-slate-600 hover:text-orange-600">
              ログイン
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-slate-900">無料で始める。お支払い情報不要</h1>
          <p className="mt-2 text-sm text-slate-600">※すべての項目が入力必須です</p>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-2 text-sm font-extrabold">
            <div className="bg-emerald-600 px-4 py-3 text-center text-white">フォームに入力</div>
            <div className="bg-slate-50 px-4 py-3 text-center text-slate-700">すぐに使えます</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-emerald-50/40 p-6 sm:p-10">

            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                {error}
              </div>
            )}

            {inviteToken && (
              <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
                <div className="font-extrabold">ワークスペース招待を受け取り中</div>
                <div className="mt-1">
                  {inviteLoading ? "招待情報を読み込み中..." : `会社コード: ${inviteCompanyCode || "-"}`}{inviteRole ? ` / 権限: ${inviteRole === "admin" ? "管理者" : "メンバー"}` : ""}
                </div>
              </div>
            )}

            <form onSubmit={handleSignup} className="mx-auto max-w-xl space-y-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">ワークスペースID *</div>
                <div className="flex items-stretch gap-2">
                  <input
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(normalizeWorkspaceId(e.target.value))}
                    placeholder="space-id"
                    required
                    disabled={!!inviteToken}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                  />
                  <div className="hidden items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-500 sm:flex">
                    （組織ID）
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-500">個人IDではなく、社名・事業など組織単位のIDです（半角英数字・ハイフン）。</div>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">社名（ワークスペース名） *</div>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="組織名（例：株式会社◯◯）"
                  required={!inviteToken}
                  disabled={!!inviteToken}
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                />
                {inviteToken ? (
                  <div className="mt-1 text-xs font-bold text-orange-700">
                    ※ 招待で参加する場合、社名は後から自動で反映されます
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">電話番号 *</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="電話番号（例：03-300-1234）"
                  required={!inviteToken}
                  disabled={!!inviteToken}
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">あなたの氏名 *</div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="あなたの氏名（例：山田 太郎）"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">メールアドレス *</div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="メールアドレス"
                  required
                  disabled={!!inviteToken}
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">パスワード *</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="パスワード（8文字以上）"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">パスワード（確認） *</div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="もう一度入力"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-lg bg-orange-600 px-6 py-3 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
              >
                {loading ? "作成中..." : "アカウントを作成"}
              </button>
            </form>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm text-orange-700">
                既にアカウントをお持ちですか？{" "}
                <Link
                  href="/login"
                  className="font-extrabold text-orange-700 hover:underline"
                >
                  ログイン
                </Link>
              </p>
            </div>

          </div>
      </main>
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

