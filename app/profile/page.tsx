"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { AppShell } from "../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profSnap.exists()) {
        setLoading(false);
        router.push("/login");
        return;
      }
      const prof = profSnap.data() as MemberProfile;
      setProfile(prof);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <AppShell title="プロファイル" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell title="プロファイル" subtitle="ユーザー情報">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">表示名</div>
            <div className="text-sm font-extrabold text-slate-900">
              {profile.displayName || user.email?.split("@")[0] || "未設定"}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">メールアドレス</div>
            <div className="text-sm font-extrabold text-slate-900">{user.email || "未設定"}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">会社コード</div>
            <div className="text-sm font-extrabold text-slate-900">{profile.companyCode || "未設定"}</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

