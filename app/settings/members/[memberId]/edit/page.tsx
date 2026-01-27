"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../../lib/firebase";
import { AppShell } from "../../../../AppShell";
import { ensureProfile } from "../../../../../lib/ensureProfile";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Company = {
  ownerUid: string;
  companyName?: string;
};

type Permissions = {
  dashboard: boolean; // ホーム
  members: boolean;   // メンバー管理（招待・編集・削除）
  projects: boolean;  // プロジェクト管理（案件）
  issues: boolean;    // イシュー管理（課題）
  customers: boolean; // 顧客管理
  files: boolean;     // ファイル管理（ドライブ）
  billing: boolean;   // 請求・売上管理（収支）
  settings: boolean;  // ワークスペース設定
  wiki: boolean;      // Wiki
  effort: boolean;    // 工数
  calendar: boolean;  // カレンダー
};

const DEFAULT_PERMISSIONS: Permissions = {
  dashboard: true,
  members: false,
  projects: true,
  issues: true,
  customers: false,
  files: true,
  billing: false,
  settings: false,
  wiki: true,
  effort: true,
  calendar: true,
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
  role: "owner" | "admin" | "member"; // admin は後方互換のため残す
  permissions?: Permissions;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type EmploymentType = "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託";

type Employee = {
  id: string;
  name: string;
  email: string;
  employmentType: EmploymentType;
  joinDate: string;
  color?: string;
  authUid?: string;
  companyCode?: string;
  createdBy: string;
  isActive?: boolean | null; // 稼働中/停止中
};

const EMPLOYEE_COLORS = [
  { name: "ブルー", value: "#3B82F6" },
  { name: "グリーン", value: "#10B981" },
  { name: "パープル", value: "#8B5CF6" },
  { name: "ピンク", value: "#EC4899" },
  { name: "オレンジ", value: "#F97316" },
  { name: "レッド", value: "#EF4444" },
  { name: "イエロー", value: "#EAB308" },
  { name: "シアン", value: "#06B6D4" },
  { name: "インディゴ", value: "#6366F1" },
  { name: "ティール", value: "#14B8A6" },
] as const;

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function MemberEditPage() {
  const router = useRouter();
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("正社員");
  const [joinDate, setJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [color, setColor] = useState<string>(EMPLOYEE_COLORS[0].value);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [role, setRole] = useState<WorkspaceMembership["role"]>("member");
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);

  const isOwner = useMemo(() => {
    return !!user && !!company && company.ownerUid === user.uid;
  }, [company, user]);

  const canEdit = useMemo(() => {
    if (!user || !employee) return false;
    return isOwner || employee.authUid === user.uid;
  }, [employee, isOwner, user]);

  const targetIsCompanyOwner = useMemo(() => {
    if (!company || !employee?.authUid) return false;
    return company.ownerUid === employee.authUid;
  }, [company, employee?.authUid]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setLoading(false);
          router.push("/login");
          return;
        }
        setProfile(prof);

        if (prof.companyCode) {
          try {
            const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
            setCompany(compSnap.exists() ? (compSnap.data() as Company) : null);
          } catch {
            setCompany(null);
          }
        }

        const empSnap = await getDoc(doc(db, "employees", memberId));
        if (!empSnap.exists()) {
          setEmployee(null);
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...(empSnap.data() as any) } as Employee;
        setEmployee(emp);
        setName(emp.name || "");
        setEmploymentType(emp.employmentType || "正社員");
        setJoinDate(emp.joinDate || new Date().toISOString().slice(0, 10));
        setColor(emp.color || EMPLOYEE_COLORS[0].value);
        setIsActive(emp.isActive !== false); // デフォルトは稼働中

        if (prof.companyCode && emp.authUid) {
          try {
            const mSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${emp.authUid}`));
            const m = mSnap.exists() ? (mSnap.data() as WorkspaceMembership) : null;
            setMembership(m);
            // admin は member に変換（後方互換）
            const savedRole = m?.role === "admin" ? "member" : m?.role;
            setRole(savedRole || (targetIsCompanyOwner ? "owner" : "member"));
            // 既存データと新しい権限キーをマージ
            const p = m?.permissions || {};
            setPermissions({
              dashboard: p.dashboard ?? DEFAULT_PERMISSIONS.dashboard,
              members: p.members ?? DEFAULT_PERMISSIONS.members,
              projects: p.projects ?? DEFAULT_PERMISSIONS.projects,
              issues: p.issues ?? DEFAULT_PERMISSIONS.issues,
              customers: p.customers ?? DEFAULT_PERMISSIONS.customers,
              files: p.files ?? DEFAULT_PERMISSIONS.files,
              billing: p.billing ?? DEFAULT_PERMISSIONS.billing,
              settings: p.settings ?? DEFAULT_PERMISSIONS.settings,
              wiki: p.wiki ?? DEFAULT_PERMISSIONS.wiki,
              effort: p.effort ?? DEFAULT_PERMISSIONS.effort,
              calendar: p.calendar ?? DEFAULT_PERMISSIONS.calendar,
            });
          } catch (e) {
            console.warn(e);
            setMembership(null);
            setRole(targetIsCompanyOwner ? "owner" : "member");
            setPermissions(DEFAULT_PERMISSIONS);
          }
        } else {
          setMembership(null);
          setRole(targetIsCompanyOwner ? "owner" : "member");
          setPermissions(DEFAULT_PERMISSIONS);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, memberId]);

  const handleSave = async () => {
    if (!user || !profile || !employee) return;
    if (!canEdit) {
      setError("このメンバーを編集する権限がありません。");
      return;
    }
    const n = name.trim();
    if (!n) {
      setError("名前を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "employees", employee.id), {
        name: n,
        employmentType,
        joinDate,
        color,
        isActive,
        updatedAt: Timestamp.now(),
      } as any);

      // 権限変更（workspaceMemberships.role / permissions）はオーナーのみ
      if (isOwner && profile.companyCode && employee.authUid) {
        const membershipId = `${profile.companyCode}_${employee.authUid}`;
        const membershipRef = doc(db, "workspaceMemberships", membershipId);

        // 会社の ownerUid の人は owner 固定（誤操作でオーナー不在になるのを防ぐ）
        const nextRole: WorkspaceMembership["role"] = targetIsCompanyOwner ? "owner" : role;

        // 未作成の場合もあるので setDoc(merge) で確実に反映
        await setDoc(
          membershipRef,
          {
            uid: employee.authUid,
            companyCode: profile.companyCode,
            role: nextRole,
            // オーナーは全権限持つので permissions は保存しない（member のみ）
            ...(nextRole === "member" ? { permissions } : {}),
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );
      }

      router.push(`/settings/members/${encodeURIComponent(employee.id)}`);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="メンバー編集" subtitle="読み込み中...">
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
        title="メンバー編集"
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

  return (
    <AppShell
      title="メンバー編集"
      subtitle={employee.name || employee.email}
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={`/settings/members/${encodeURIComponent(employee.id)}`}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            ← 詳細へ
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className={clsx("rounded-md px-4 py-2 text-sm font-extrabold text-white", saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700")}
            type="button"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
      ) : null}

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900">基本情報</div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-500">名前 *</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-500">メール</div>
              <input
                value={employee.email}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"
              />
              <div className="mt-1 text-[11px] font-bold text-slate-500">
                ※ 認証用メールは別管理のため、ここでは変更しません
              </div>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">雇用形態</div>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
              >
                {(["正社員", "契約社員", "パート", "アルバイト", "業務委託"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">入社日</div>
              <input
                type="date"
                value={joinDate}
                onChange={(e) => setJoinDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-500">状態</div>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsActive(true)}
                  className={clsx(
                    "flex-1 rounded-lg border p-3 text-center transition",
                    isActive
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  <div className="text-sm font-extrabold text-slate-900">稼働中</div>
                  <div className="mt-1 text-[11px] font-bold text-slate-500">通常業務中</div>
                </button>
                <button
                  type="button"
                  onClick={() => setIsActive(false)}
                  className={clsx(
                    "flex-1 rounded-lg border p-3 text-center transition",
                    !isActive
                      ? "border-slate-500 bg-slate-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  <div className="text-sm font-extrabold text-slate-900">停止中</div>
                  <div className="mt-1 text-[11px] font-bold text-slate-500">休職・退職など</div>
                </button>
              </div>
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-500">表示色</div>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {EMPLOYEE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={clsx(
                      "relative rounded-lg border p-3 transition hover:shadow-sm",
                      color === c.value ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-white",
                    )}
                    title={c.name}
                  >
                    <div className="mx-auto h-5 w-5 rounded-full" style={{ backgroundColor: c.value }} />
                    <div className="mt-1 text-center text-[10px] font-bold text-slate-600">{c.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-extrabold text-slate-900">権限</div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {isOwner ? "オーナーのみ権限変更できます。" : "権限変更はオーナーのみ可能です（閲覧のみ）。"}
              </div>
            </div>
            <div className="text-xs font-bold text-slate-500">{company?.companyName ? company.companyName : profile.companyCode}</div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-extrabold text-slate-500">ロール</div>
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                onClick={() => isOwner && !targetIsCompanyOwner && setRole("owner")}
                disabled={!isOwner || targetIsCompanyOwner}
                className={clsx(
                  "flex-1 rounded-lg border p-3 text-center transition",
                  (targetIsCompanyOwner ? true : role === "owner")
                    ? "border-orange-500 bg-orange-50"
                    : "border-slate-200 bg-white hover:bg-slate-50",
                  (!isOwner || targetIsCompanyOwner) && "cursor-not-allowed opacity-60",
                )}
              >
                <div className="text-sm font-extrabold text-slate-900">オーナー</div>
                <div className="mt-1 text-[11px] font-bold text-slate-500">全ての操作が可能</div>
              </button>
              <button
                type="button"
                onClick={() => isOwner && !targetIsCompanyOwner && setRole("member")}
                disabled={!isOwner || targetIsCompanyOwner}
                className={clsx(
                  "flex-1 rounded-lg border p-3 text-center transition",
                  !targetIsCompanyOwner && role === "member"
                    ? "border-orange-500 bg-orange-50"
                    : "border-slate-200 bg-white hover:bg-slate-50",
                  (!isOwner || targetIsCompanyOwner) && "cursor-not-allowed opacity-60",
                )}
              >
                <div className="text-sm font-extrabold text-slate-900">メンバー</div>
                <div className="mt-1 text-[11px] font-bold text-slate-500">メニュー表示権限を設定</div>
              </button>
            </div>
            {targetIsCompanyOwner ? (
              <div className="mt-2 text-[11px] font-bold text-slate-500">※ このユーザーは会社オーナーのため「オーナー」固定です。</div>
            ) : null}
          </div>

          {/* メンバーの場合のみメニュー表示権限を表示 */}
          {!targetIsCompanyOwner && role === "member" ? (
            <div className="mt-4">
              <div className="text-xs font-extrabold text-slate-500">メニュー表示権限</div>
              <div className="mt-1 text-[11px] text-slate-400">チェックした項目がグローバルメニューに表示されます</div>
              <div className="mt-3 space-y-2">
                {(Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]).map((key) => (
                  <div key={key} className="space-y-1">
                    <label
                      className={clsx(
                        "flex items-center justify-between rounded-lg border p-3 transition",
                        permissions[key] ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white",
                        !isOwner && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span className="text-sm font-bold text-slate-800">{PERMISSION_LABELS[key]}</span>
                      <input
                        type="checkbox"
                        checked={permissions[key]}
                        onChange={(e) =>
                          isOwner && setPermissions((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                        disabled={!isOwner}
                        className="h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                      />
                    </label>
                    {/* 詳細権限リンク（対応するものがある場合のみ） */}
                    {key === "calendar" && permissions[key] && isOwner && (
                      <Link
                        href={`/settings/members/${memberId}/permissions/calendar`}
                        className="ml-3 inline-flex items-center gap-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline"
                      >
                        <span>→</span>
                        <span>カレンダー権限をさらに制御する</span>
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}


