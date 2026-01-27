"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../../../lib/firebase";
import { AppShell } from "../../../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Employee = {
  id: string;
  name: string;
  email: string;
  authUid?: string;
};

type Company = {
  ownerUid: string;
  companyName?: string;
};

type CalendarPermissions = {
  viewOthersCalendar: boolean;    // 他メンバーのカレンダーを閲覧できる
  editOthersEvents: boolean;      // 他メンバーの予定を編集できる
  createEvents: boolean;          // 予定を作成できる
  deleteOthersEvents: boolean;    // 他メンバーの予定を削除できる
};

const DEFAULT_CALENDAR_PERMISSIONS: CalendarPermissions = {
  viewOthersCalendar: false, // デフォルトは他メンバーのカレンダーを見れない
  editOthersEvents: false,
  createEvents: true,
  deleteOthersEvents: false,
};

const CALENDAR_PERMISSION_LABELS: Record<keyof CalendarPermissions, { label: string; description: string }> = {
  viewOthersCalendar: {
    label: "他メンバーのカレンダーを閲覧",
    description: "他のメンバーの予定を見ることができます",
  },
  createEvents: {
    label: "予定を作成",
    description: "新しい予定を作成できます",
  },
  editOthersEvents: {
    label: "他メンバーの予定を編集",
    description: "他のメンバーが作成した予定を編集できます",
  },
  deleteOthersEvents: {
    label: "他メンバーの予定を削除",
    description: "他のメンバーが作成した予定を削除できます",
  },
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function CalendarPermissionsPage() {
  const router = useRouter();
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [calendarPermissions, setCalendarPermissions] = useState<CalendarPermissions>(DEFAULT_CALENDAR_PERMISSIONS);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }

      try {
        // プロフィール取得
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (!profSnap.exists()) {
          router.push("/login");
          return;
        }
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        // 会社オーナー確認
        if (prof.companyCode) {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          if (compSnap.exists()) {
            const compData = compSnap.data() as Company;
            const ownerFlag = compData.ownerUid === u.uid;
            setIsOwner(ownerFlag);
            if (!ownerFlag) {
              setError("この操作はオーナーのみ可能です");
              setLoading(false);
              return;
            }
          }
        }

        // 対象メンバー取得
        const empSnap = await getDoc(doc(db, "employees", memberId));
        if (!empSnap.exists()) {
          setError("メンバーが見つかりません");
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...empSnap.data() } as Employee;
        setEmployee(emp);

        // メンバーシップから詳細権限を取得
        if (prof.companyCode && emp.authUid) {
          const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${emp.authUid}`));
          if (msSnap.exists()) {
            const msData = msSnap.data() as any;
            const cp = msData.calendarPermissions || {};
            setCalendarPermissions({
              viewOthersCalendar: cp.viewOthersCalendar ?? DEFAULT_CALENDAR_PERMISSIONS.viewOthersCalendar,
              editOthersEvents: cp.editOthersEvents ?? DEFAULT_CALENDAR_PERMISSIONS.editOthersEvents,
              createEvents: cp.createEvents ?? DEFAULT_CALENDAR_PERMISSIONS.createEvents,
              deleteOthersEvents: cp.deleteOthersEvents ?? DEFAULT_CALENDAR_PERMISSIONS.deleteOthersEvents,
            });
          }
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router, memberId]);

  const handleSave = async () => {
    if (!user || !profile || !employee?.authUid) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const membershipId = `${profile.companyCode}_${employee.authUid}`;
      await updateDoc(doc(db, "workspaceMemberships", membershipId), {
        calendarPermissions,
        updatedAt: Timestamp.now(),
      });
      setSuccess("保存しました");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="カレンダー権限" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title="カレンダー権限"
      subtitle={employee?.name || "メンバー"}
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={`/settings/members/${memberId}/edit`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            ← 戻る
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || !isOwner}
            className={clsx(
              "rounded-lg px-4 py-2 text-sm font-extrabold text-white transition",
              saving || !isOwner ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700"
            )}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
            {success}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-lg">
              📅
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-900">
                {employee?.name || "メンバー"} のカレンダー権限
              </div>
              <div className="text-xs text-slate-500">{employee?.email}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            {(Object.keys(CALENDAR_PERMISSION_LABELS) as (keyof CalendarPermissions)[]).map((key) => {
              const { label, description } = CALENDAR_PERMISSION_LABELS[key];
              return (
                <label
                  key={key}
                  className={clsx(
                    "flex items-start gap-3 rounded-lg border p-4 transition cursor-pointer",
                    calendarPermissions[key] ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white hover:bg-slate-50",
                    !isOwner && "cursor-not-allowed opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={calendarPermissions[key]}
                    onChange={(e) =>
                      isOwner && setCalendarPermissions((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    disabled={!isOwner}
                    className="mt-1 h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-bold text-slate-800">{label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-extrabold text-slate-500 mb-2">権限の説明</div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>「他メンバーのカレンダーを閲覧」がオフの場合、チームカレンダーで自分の予定のみ表示されます</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>「予定を作成」がオフの場合、新しい予定を作成できません</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>「他メンバーの予定を編集/削除」は、他のメンバーが作成した予定に対する操作を制御します</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
