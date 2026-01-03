"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { AppShell } from "../../../AppShell";

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
  password?: string;
};

type Company = {
  ownerUid: string;
  companyName?: string;
};

type WorkspaceMembership = {
  uid: string;
  companyCode: string;
  role: "owner" | "admin" | "member";
};

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

        // membership（ownerのみ他人も読めるようルール拡張済み）
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

  const canEdit = useMemo(() => {
    if (!user || !employee) return false;
    return isOwner || employee.authUid === user.uid;
  }, [employee, isOwner, user]);

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
          <Link href="/settings/members" className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
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

  const roleLabel = membership?.role === "owner" ? "オーナー" : membership?.role === "admin" ? "管理者" : membership?.role === "member" ? "メンバー" : "未設定";

  return (
    <AppShell
      title="メンバー詳細"
      subtitle={employee.name || employee.email}
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/settings/members" className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            ← 一覧に戻る
          </Link>
          {canEdit ? (
            <Link href={`/settings/members/${encodeURIComponent(employee.id)}/edit`} className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700">
              編集
            </Link>
          ) : null}
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
      ) : null}

      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full border border-white shadow-sm" style={{ backgroundColor: employee.color || "#3B82F6" }} />
              <div>
                <div className="text-lg font-extrabold text-slate-900">{employee.name || "（未入力）"}</div>
                <div className="text-sm font-bold text-slate-600">{employee.email}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-slate-500">権限</div>
              <div className="mt-1 inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold text-orange-700">{roleLabel}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">雇用形態</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{employee.employmentType || "-"}</div>
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">入社日</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{employee.joinDate || "-"}</div>
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">認証</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{employee.authUid ? "認証済み" : "未認証"}</div>
            </div>
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">ワークスペース</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{profile.companyCode || "-"}</div>
              {company?.companyName ? <div className="text-xs font-bold text-slate-500">{company.companyName}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


