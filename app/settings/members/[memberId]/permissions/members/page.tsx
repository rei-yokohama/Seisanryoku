"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../../../lib/firebase";
import { AppShell } from "../../../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type EmployeeItem = {
  id: string;
  name: string;
  email: string;
  authUid?: string;
  isActive?: boolean | null;
};

type Company = {
  ownerUid: string;
  companyName?: string;
};

type EmploymentType = "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託";
const EMPLOYMENT_TYPES: EmploymentType[] = ["正社員", "契約社員", "パート", "アルバイト", "業務委託"];

type MemberPermissions = {
  canViewMembers: boolean;
  allowedViewEmploymentTypes: string[];
  canCreateMembers: boolean;
  allowedCreateEmploymentTypes: string[];
  canEditMembers: boolean;
  allowedEditEmploymentTypes: string[];
  canDeleteMembers: boolean;
  allowedDeleteEmploymentTypes: string[];
};

const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  canViewMembers: true,
  allowedViewEmploymentTypes: [],
  canCreateMembers: true,
  allowedCreateEmploymentTypes: [],
  canEditMembers: true,
  allowedEditEmploymentTypes: [],
  canDeleteMembers: false,
  allowedDeleteEmploymentTypes: [],
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function MemberPermissionsPage() {
  const router = useRouter();
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<EmployeeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [memberPermissions, setMemberPermissions] = useState<MemberPermissions>(DEFAULT_MEMBER_PERMISSIONS);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }

      try {
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (!profSnap.exists()) {
          router.push("/login");
          return;
        }
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        if (prof.companyCode) {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          if (compSnap.exists()) {
            setIsOwner((compSnap.data() as Company).ownerUid === u.uid);
          }
        }

        const empSnap = await getDoc(doc(db, "employees", memberId));
        if (!empSnap.exists()) {
          setError("メンバーが見つかりません");
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...empSnap.data() } as EmployeeItem;
        setEmployee(emp);

        if (prof.companyCode && emp.authUid) {
          try {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${emp.authUid}`));
            if (msSnap.exists()) {
              const msData = msSnap.data() as any;
              const mp = msData.memberPermissions || {};
              setMemberPermissions({
                canViewMembers: mp.canViewMembers ?? DEFAULT_MEMBER_PERMISSIONS.canViewMembers,
                allowedViewEmploymentTypes: Array.isArray(mp.allowedViewEmploymentTypes) ? mp.allowedViewEmploymentTypes : [],
                canCreateMembers: mp.canCreateMembers ?? DEFAULT_MEMBER_PERMISSIONS.canCreateMembers,
                allowedCreateEmploymentTypes: Array.isArray(mp.allowedCreateEmploymentTypes) ? mp.allowedCreateEmploymentTypes : [],
                canEditMembers: mp.canEditMembers ?? DEFAULT_MEMBER_PERMISSIONS.canEditMembers,
                allowedEditEmploymentTypes: Array.isArray(mp.allowedEditEmploymentTypes) ? mp.allowedEditEmploymentTypes : [],
                canDeleteMembers: mp.canDeleteMembers ?? DEFAULT_MEMBER_PERMISSIONS.canDeleteMembers,
                allowedDeleteEmploymentTypes: Array.isArray(mp.allowedDeleteEmploymentTypes) ? mp.allowedDeleteEmploymentTypes : [],
              });
            }
          } catch {
            // デフォルト値のまま
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
      await setDoc(doc(db, "workspaceMemberships", membershipId), {
        uid: employee.authUid,
        companyCode: profile.companyCode,
        memberPermissions,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      setSuccess("保存しました");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const toggleEmploymentType = (field: keyof Pick<MemberPermissions, "allowedViewEmploymentTypes" | "allowedCreateEmploymentTypes" | "allowedEditEmploymentTypes" | "allowedDeleteEmploymentTypes">, type: string) => {
    setMemberPermissions((prev) => ({
      ...prev,
      [field]: prev[field].includes(type)
        ? prev[field].filter((t: string) => t !== type)
        : [...prev[field], type],
    }));
  };

  if (loading) {
    return (
      <AppShell title="メンバー権限" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  const PERM_ITEMS: {
    key: "canViewMembers" | "canCreateMembers" | "canEditMembers" | "canDeleteMembers";
    label: string;
    description: string;
    empTypeField: "allowedViewEmploymentTypes" | "allowedCreateEmploymentTypes" | "allowedEditEmploymentTypes" | "allowedDeleteEmploymentTypes";
    empTypeLabel: string;
  }[] = [
    {
      key: "canViewMembers",
      label: "メンバーを閲覧",
      description: "他のメンバーの情報を閲覧できます",
      empTypeField: "allowedViewEmploymentTypes",
      empTypeLabel: "閲覧可能な雇用形態",
    },
    {
      key: "canCreateMembers",
      label: "メンバーを作成",
      description: "新しいメンバーを追加できます",
      empTypeField: "allowedCreateEmploymentTypes",
      empTypeLabel: "作成可能な雇用形態",
    },
    {
      key: "canEditMembers",
      label: "メンバーを編集",
      description: "メンバーの情報を編集できます",
      empTypeField: "allowedEditEmploymentTypes",
      empTypeLabel: "編集可能な雇用形態",
    },
    {
      key: "canDeleteMembers",
      label: "メンバーを削除",
      description: "メンバーを削除できます",
      empTypeField: "allowedDeleteEmploymentTypes",
      empTypeLabel: "削除可能な雇用形態",
    },
  ];

  return (
    <AppShell
      title="メンバー権限"
      subtitle={employee?.name || "メンバー"}
    >
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-900">メンバー権限</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/settings/members/${memberId}/edit`}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              ← 戻る
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className={clsx(
                "rounded-lg px-4 py-2 text-sm font-extrabold text-white transition",
                saving ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700"
              )}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
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

        {/* メンバー権限 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-lg">
              👥
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-900">
                {employee?.name || "メンバー"} のメンバー管理権限
              </div>
              <div className="text-xs text-slate-500">{employee?.email}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            {PERM_ITEMS.map((item) => {
              const isOn = memberPermissions[item.key];
              return (
                <div key={item.key} className="space-y-2">
                  <label
                    className={clsx(
                      "flex items-start gap-3 rounded-lg border p-4 transition cursor-pointer",
                      isOn ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={(e) =>
                        setMemberPermissions((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="mt-1 h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-bold text-slate-800">{item.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                    </div>
                  </label>
                  {isOn && (
                    <div className="ml-8 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-extrabold text-slate-500 mb-2">
                        {item.empTypeLabel}（未選択 = 全雇用形態）
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {EMPLOYMENT_TYPES.map((type) => {
                          const selected = memberPermissions[item.empTypeField].includes(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => toggleEmploymentType(item.empTypeField, type)}
                              className={clsx(
                                "rounded-md border px-3 py-1.5 text-xs font-bold transition",
                                selected
                                  ? "border-orange-400 bg-orange-100 text-orange-700"
                                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                              )}
                            >
                              {type}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 説明 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-extrabold text-slate-500 mb-2">権限の説明</div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>雇用形態を選択すると、その雇用形態のメンバーのみ操作できます</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>未選択の場合は全雇用形態のメンバーを操作できます</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>例：「業務委託」のみ選択すると、業務委託のメンバーだけ作成・編集・削除できます</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
