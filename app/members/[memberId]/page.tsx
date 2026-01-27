"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Employee = {
  id: string;
  name: string;
  email: string;
  employmentType?: string;
  joinDate?: string;
  color?: string;
  authUid?: string;
  companyCode?: string;
  createdBy?: string;
  isActive?: boolean | null;
};

type Company = {
  ownerUid: string;
  companyName?: string;
};

type Permissions = {
  dashboard: boolean;
  members: boolean;
  projects: boolean;
  issues: boolean;
  customers: boolean;
  files: boolean;
  billing: boolean;
  settings: boolean;
  wiki: boolean;
  effort: boolean;
  calendar: boolean;
};

const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  dashboard: "ホーム",
  issues: "課題",
  wiki: "Wiki",
  customers: "顧客",
  projects: "案件",
  billing: "収支",
  effort: "工数",
  files: "ドライブ",
  calendar: "カレンダー",
  members: "メンバー",
  settings: "設定",
};

type WorkspaceMembership = {
  uid: string;
  companyCode: string;
  role: "owner" | "admin" | "member";
  permissions?: Permissions;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function MemberDetailPage() {
  const router = useRouter();
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (!profSnap.exists()) {
          setLoading(false);
          router.push("/login");
          return;
        }
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        const empSnap = await getDoc(doc(db, "employees", memberId));
        if (!empSnap.exists()) {
          setEmployee(null);
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...(empSnap.data() as any) } as Employee;
        setEmployee(emp);

        if (prof.companyCode) {
          try {
            const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
            const comp = compSnap.exists() ? (compSnap.data() as Company) : null;
            setCompany(comp);
            setIsOwner(!!comp && comp.ownerUid === u.uid);
          } catch {
            setCompany(null);
            setIsOwner(false);
          }
        }

        if (prof.companyCode && emp.authUid) {
          try {
            const mSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${emp.authUid}`));
            setMembership(mSnap.exists() ? (mSnap.data() as WorkspaceMembership) : null);
          } catch (e: any) {
            console.warn(e);
            setMembership(null);
          }
        } else {
          setMembership(null);
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, memberId]);

  if (loading) {
    return (
      <AppShell title="メンバー詳細" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  if (!employee) {
    return (
      <AppShell
        title="メンバー詳細"
        subtitle="見つかりません"
        headerRight={
          <Link href="/members" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            ← 一覧に戻る
          </Link>
        }
      >
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-700">
          このメンバーは見つかりませんでした。
        </div>
      </AppShell>
    );
  }

  const roleLabel = membership?.role === "owner" ? "オーナー" : (membership?.role === "admin" || membership?.role === "member") ? "メンバー" : "未設定";
  const canEdit = isOwner || employee.authUid === user.uid;

  return (
    <AppShell
      title="メンバー詳細"
      subtitle={employee.name || employee.email}
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/members" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            ← 一覧に戻る
          </Link>
          {canEdit && (
            <Link href={`/settings/members/${encodeURIComponent(employee.id)}/edit`} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700">
              編集
            </Link>
          )}
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
      )}

      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* プロフィールカード */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-start gap-5">
            <div
              className="h-20 w-20 flex-shrink-0 rounded-full border-4 border-white shadow-lg flex items-center justify-center text-3xl font-extrabold text-white"
              style={{ backgroundColor: employee.color || "#3B82F6" }}
            >
              {(employee.name || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-extrabold text-slate-900">{employee.name || "（未入力）"}</h1>
                {employee.isActive === false && (
                  <span className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-extrabold text-rose-700">
                    停止中
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm text-slate-600">{employee.email}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={clsx(
                  "inline-flex rounded-full px-3 py-1 text-xs font-extrabold",
                  membership?.role === "owner" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-700"
                )}>
                  {roleLabel}
                </span>
                {employee.employmentType && (
                  <span className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-extrabold text-sky-700">
                    {employee.employmentType}
                  </span>
                )}
                {employee.authUid ? (
                  <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-extrabold text-green-700">
                    認証済み
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-700">
                    未認証
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 基本情報 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-4">基本情報</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-bold text-slate-500">入社日</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{employee.joinDate || "-"}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500">ワークスペース</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{profile.companyCode || "-"}</div>
              {company?.companyName && <div className="text-xs text-slate-500">{company.companyName}</div>}
            </div>
          </div>
        </div>

        {/* メニュー表示権限 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-4">メニュー表示権限</div>
          {membership?.role === "owner" ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <div className="text-sm font-bold text-orange-700">オーナー権限: 全てのメニューが表示されます</div>
            </div>
          ) : membership?.permissions ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]).map((key) => (
                <div
                  key={key}
                  className={clsx(
                    "rounded-lg border p-3 text-center",
                    membership.permissions?.[key]
                      ? "border-green-200 bg-green-50"
                      : "border-slate-200 bg-slate-50"
                  )}
                >
                  <div className="text-xs font-bold text-slate-700">{PERMISSION_LABELS[key]}</div>
                  <div
                    className={clsx(
                      "mt-1 text-lg",
                      membership.permissions?.[key] ? "text-green-600" : "text-slate-300"
                    )}
                  >
                    {membership.permissions?.[key] ? "✓" : "−"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">権限情報がありません</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
