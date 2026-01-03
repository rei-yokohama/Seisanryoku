"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type TeamSettings = {
  id?: string;
  companyCode: string;
  teamName: string;
  timezone: string;
  language: string;
  notifications: boolean;
  updatedAt?: Timestamp;
};

type TeamInvite = {
  id: string; // token
  companyCode: string;
  email: string;
  role: "member" | "admin";
  createdBy: string;
  createdAt?: Timestamp;
  usedAt?: Timestamp;
  acceptedBy?: string;
};

function generateToken(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  // base64url
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default function TeamSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [teamName, setTeamName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tokyo");
  const [language, setLanguage] = useState("ja");
  const [notifications, setNotifications] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [invites, setInvites] = useState<TeamInvite[]>([]);

  const loadSettings = async (prof: MemberProfile) => {
    if (!prof.companyCode) return;
    const snap = await getDocs(query(collection(db, "teamSettings"), where("companyCode", "==", prof.companyCode)));
    if (snap.empty) {
      setTeamName(prof.companyCode);
      return;
    }
    const settings = { id: snap.docs[0].id, ...snap.docs[0].data() } as TeamSettings;
    setSettingsId(settings.id || null);
    setTeamName(settings.teamName || prof.companyCode);
    setTimezone(settings.timezone || "Asia/Tokyo");
    setLanguage(settings.language || "ja");
    setNotifications(settings.notifications !== false);
  };

  const loadInvites = async (prof: MemberProfile) => {
    if (!prof.companyCode) return;
    const snap = await getDocs(query(collection(db, "teamInvites"), where("companyCode", "==", prof.companyCode)));
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TeamInvite))
      .sort((a, b) => ((b.createdAt as any)?.toMillis?.() || 0) - ((a.createdAt as any)?.toMillis?.() || 0));
    setInvites(items);
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
        const snap = await getDoc(doc(db, "profiles", u.uid));
        if (!snap.exists()) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const prof = snap.data() as MemberProfile;
        setProfile(prof);
        await loadSettings(prof);
        await loadInvites(prof);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!user || !profile) return;
    const name = teamName.trim();
    if (!name) {
      setError("チーム名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const data = {
        companyCode: profile.companyCode,
        teamName: name,
        timezone,
        language,
        notifications,
        updatedAt: Timestamp.now(),
      };

      if (settingsId) {
        await updateDoc(doc(db, "teamSettings", settingsId), data);
      } else {
        const newDoc = doc(collection(db, "teamSettings"));
        await setDoc(newDoc, data);
        setSettingsId(newDoc.id);
      }

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "PROJECT_UPDATED",
        message: `チーム設定を更新しました`,
        link: "/settings/members/invite",
      });
      setSuccess("設定を保存しました");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!user || !profile) return;
    if (!profile.companyCode) {
      setError("会社コードが未設定です。先に会社情報を設定してください。");
      return;
    }
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setError("招待するメールアドレスを入力してください");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("メールアドレスの形式が正しくありません");
      return;
    }

    setInviting(true);
    setError("");
    setSuccess("");
    try {
      const token = generateToken(18);
      await setDoc(doc(db, "teamInvites", token), {
        companyCode: profile.companyCode,
        email,
        role: inviteRole,
        createdBy: user.uid,
        createdAt: Timestamp.now(),
      });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "PROJECT_UPDATED",
        message: `チーム招待を発行しました: ${email}`,
        link: "/settings/members/invite",
      });

      await loadInvites(profile);
      setInviteEmail("");
      setSuccess("招待リンクを作成しました（下の一覧からコピーできます）");
    } catch (e: any) {
      setError(e?.message || "招待の作成に失敗しました");
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="招待リンク" subtitle="チーム招待・チーム設定">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="招待リンク"
      subtitle="チーム招待・チーム設定"
      headerRight={
        <Link
          href="/settings/members"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← メンバー一覧
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-6">
            <h2 className="text-xl font-extrabold text-slate-900">招待リンク</h2>
            <p className="text-sm text-slate-600">チームメンバー招待（URL発行）とチーム全体の設定を管理します</p>
          </div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-700">{success}</div> : null}

          <div className="grid grid-cols-1 gap-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="mb-3 text-sm font-extrabold text-slate-900">チーム招待</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-7">
                  <div className="mb-1 text-sm font-bold text-slate-700">メールアドレス *</div>
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="example@company.com"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="sm:col-span-3">
                  <div className="mb-1 text-sm font-bold text-slate-700">権限</div>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                  >
                    <option value="member">メンバー</option>
                    <option value="admin">管理者</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <button
                    onClick={handleInvite}
                    disabled={inviting}
                    className="w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
                  >
                    {inviting ? "作成中..." : "招待"}
                  </button>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-600">
                  <div className="col-span-6">メール</div>
                  <div className="col-span-2">権限</div>
                  <div className="col-span-2">状態</div>
                  <div className="col-span-2 text-right">リンク</div>
                </div>
                {invites.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-slate-600">まだ招待はありません。</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {invites.map((inv) => {
                      const url = `/signup?invite=${encodeURIComponent(inv.id)}`;
                      const used = !!inv.usedAt;
                      return (
                        <div key={inv.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                          <div className="col-span-6 truncate font-bold text-slate-900">{inv.email}</div>
                          <div className="col-span-2 text-slate-700">{inv.role === "admin" ? "管理者" : "メンバー"}</div>
                          <div className="col-span-2">
                            <span className={"inline-flex rounded-full px-2 py-1 text-xs font-bold " + (used ? "bg-slate-100 text-slate-700" : "bg-orange-100 text-orange-800")}>
                              {used ? "使用済み" : "有効"}
                            </span>
                          </div>
                          <div className="col-span-2 text-right">
                            <button
                              className="rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(window.location.origin + url);
                                  setSuccess("招待リンクをコピーしました");
                                } catch {
                                  setError("コピーに失敗しました（ブラウザの権限を確認してください）");
                                }
                              }}
                            >
                              コピー
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">チーム名 *</div>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="例：株式会社〇〇"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">タイムゾーン</div>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                <option value="Asia/Tokyo">日本（東京）</option>
                <option value="America/New_York">アメリカ（ニューヨーク）</option>
                <option value="Europe/London">イギリス（ロンドン）</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">言語</div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                <option value="ja">日本語</option>
                <option value="en">English</option>
              </select>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={(e) => setNotifications(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                />
                <div>
                  <div className="text-sm font-bold text-slate-900">通知を有効化</div>
                  <div className="text-xs text-slate-600">チーム全体に関する重要な通知を受け取ります</div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs text-slate-500">
                会社コード: <span className="font-mono font-bold text-slate-700">{profile?.companyCode || "-"}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-orange-500 px-6 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

