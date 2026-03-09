"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, where, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../../../lib/firebase";
import { AppShell } from "../../../../../AppShell";
import type { Group } from "../../../../../../lib/visibilityPermissions";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type EmploymentType = "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託";

const EMPLOYMENT_TYPES: EmploymentType[] = ["正社員", "契約社員", "パート", "アルバイト", "業務委託"];

type EmployeeItem = {
  id: string;
  name: string;
  email: string;
  authUid?: string;
  isActive?: boolean | null;
  employmentType?: EmploymentType;
};

type Company = {
  ownerUid: string;
  companyName?: string;
};

type CalendarPermissions = {
  viewOthersCalendar: boolean;
  editOthersEvents: boolean;
  createEvents: boolean;
  deleteOthersEvents: boolean;
  viewScope: "all" | "specific_members" | "specific_groups" | "specific_employment_types";
  allowedMemberUids: string[];
  allowedGroupIds: string[];
  allowedEmploymentTypes: string[];
  viewEmploymentTypes: string[];
  editEmploymentTypes: string[];
  deleteEmploymentTypes: string[];
  createEmploymentTypes: string[];
  viewMemberUids: string[];
  editMemberUids: string[];
  deleteMemberUids: string[];
  sendInvitationMemberUids: string[];
  receiveInvitationMemberUids: string[];
  canSendInvitations: boolean;
  canReceiveInvitations: boolean;
};

const DEFAULT_CALENDAR_PERMISSIONS: CalendarPermissions = {
  viewOthersCalendar: false,
  editOthersEvents: false,
  createEvents: true,
  deleteOthersEvents: false,
  viewScope: "all",
  allowedMemberUids: [],
  allowedGroupIds: [],
  allowedEmploymentTypes: [],
  viewEmploymentTypes: [],
  editEmploymentTypes: [],
  deleteEmploymentTypes: [],
  createEmploymentTypes: [],
  viewMemberUids: [],
  editMemberUids: [],
  deleteMemberUids: [],
  sendInvitationMemberUids: [],
  receiveInvitationMemberUids: [],
  canSendInvitations: true,
  canReceiveInvitations: true,
};

type MemberUidField = "viewMemberUids" | "editMemberUids" | "deleteMemberUids";

type PermKeyWithEmpType = {
  key: "viewOthersCalendar" | "createEvents" | "editOthersEvents" | "deleteOthersEvents";
  label: string;
  description: string;
  empTypeField: "viewEmploymentTypes" | "editEmploymentTypes" | "deleteEmploymentTypes" | "createEmploymentTypes";
  empTypeLabel: string;
  memberUidField?: MemberUidField;
};

const CALENDAR_PERMISSION_ITEMS: PermKeyWithEmpType[] = [
  {
    key: "viewOthersCalendar",
    label: "他メンバーのカレンダーを閲覧",
    description: "他のメンバーの予定を見ることができます",
    empTypeField: "viewEmploymentTypes",
    empTypeLabel: "閲覧可能な雇用形態",
    memberUidField: "viewMemberUids",
  },
  {
    key: "editOthersEvents",
    label: "他メンバーの予定を編集",
    description: "他のメンバーが作成した予定を編集できます",
    empTypeField: "editEmploymentTypes",
    empTypeLabel: "編集可能な雇用形態",
    memberUidField: "editMemberUids",
  },
  {
    key: "deleteOthersEvents",
    label: "他メンバーの予定を削除",
    description: "他のメンバーが作成した予定を削除できます",
    empTypeField: "deleteEmploymentTypes",
    empTypeLabel: "削除可能な雇用形態",
    memberUidField: "deleteMemberUids",
  },
  {
    key: "createEvents",
    label: "予定を作成",
    description: "新しい予定を作成できます（自分の予定）",
    empTypeField: "createEmploymentTypes",
    empTypeLabel: "",
  },
];

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function CalendarPermissionsPage() {
  const router = useRouter();
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<EmployeeItem | null>(null);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [calendarPermissions, setCalendarPermissions] = useState<CalendarPermissions>(DEFAULT_CALENDAR_PERMISSIONS);
  const [permMemberSearch, setPermMemberSearch] = useState<Record<string, string>>({});
  const [inviteMemberSearch, setInviteMemberSearch] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<Company | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<{ uid: string; displayName?: string | null; email?: string | null } | null>(null);

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
            const compData = compSnap.data() as Company;
            setCompany(compData);
            setIsOwner(compData.ownerUid === u.uid);

            // オーナーのプロフィールを取得
            if (compData.ownerUid) {
              try {
                const ownerProfSnap = await getDoc(doc(db, "profiles", compData.ownerUid));
                if (ownerProfSnap.exists()) {
                  const op = ownerProfSnap.data();
                  setOwnerProfile({ uid: compData.ownerUid, displayName: op.displayName, email: op.email });
                }
              } catch {}
            }
          }

          // 社員一覧
          const eSnap = await getDocs(
            query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)),
          );
          setEmployees(eSnap.docs.map((d) => ({ id: d.id, ...d.data() } as EmployeeItem)));

          // グループ一覧
          const gSnap = await getDocs(
            query(collection(db, "groups"), where("companyCode", "==", prof.companyCode)),
          );
          setGroups(gSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Group)));
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
              const cp = msData.calendarPermissions || {};
              setCalendarPermissions({
                viewOthersCalendar: cp.viewOthersCalendar ?? DEFAULT_CALENDAR_PERMISSIONS.viewOthersCalendar,
                editOthersEvents: cp.editOthersEvents ?? DEFAULT_CALENDAR_PERMISSIONS.editOthersEvents,
                createEvents: cp.createEvents ?? DEFAULT_CALENDAR_PERMISSIONS.createEvents,
                deleteOthersEvents: cp.deleteOthersEvents ?? DEFAULT_CALENDAR_PERMISSIONS.deleteOthersEvents,
                viewScope: cp.viewScope ?? DEFAULT_CALENDAR_PERMISSIONS.viewScope,
                allowedMemberUids: Array.isArray(cp.allowedMemberUids) ? cp.allowedMemberUids : [],
                allowedGroupIds: Array.isArray(cp.allowedGroupIds) ? cp.allowedGroupIds : [],
                allowedEmploymentTypes: Array.isArray(cp.allowedEmploymentTypes) ? cp.allowedEmploymentTypes : [],
                viewEmploymentTypes: Array.isArray(cp.viewEmploymentTypes) ? cp.viewEmploymentTypes : [],
                editEmploymentTypes: Array.isArray(cp.editEmploymentTypes) ? cp.editEmploymentTypes : [],
                deleteEmploymentTypes: Array.isArray(cp.deleteEmploymentTypes) ? cp.deleteEmploymentTypes : [],
                createEmploymentTypes: Array.isArray(cp.createEmploymentTypes) ? cp.createEmploymentTypes : [],
                viewMemberUids: Array.isArray(cp.viewMemberUids) ? cp.viewMemberUids : [],
                editMemberUids: Array.isArray(cp.editMemberUids) ? cp.editMemberUids : [],
                deleteMemberUids: Array.isArray(cp.deleteMemberUids) ? cp.deleteMemberUids : [],
                sendInvitationMemberUids: Array.isArray(cp.sendInvitationMemberUids) ? cp.sendInvitationMemberUids : [],
                receiveInvitationMemberUids: Array.isArray(cp.receiveInvitationMemberUids) ? cp.receiveInvitationMemberUids : [],
                canSendInvitations: cp.canSendInvitations ?? DEFAULT_CALENDAR_PERMISSIONS.canSendInvitations,
                canReceiveInvitations: cp.canReceiveInvitations ?? DEFAULT_CALENDAR_PERMISSIONS.canReceiveInvitations,
              });
            }
          } catch {
            // ドキュメント未作成 or 権限不足の場合はデフォルト値のまま
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
        calendarPermissions,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      setSuccess("保存しました");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const toggleMemberUid = (uid: string) => {
    setCalendarPermissions((prev) => ({
      ...prev,
      allowedMemberUids: prev.allowedMemberUids.includes(uid)
        ? prev.allowedMemberUids.filter((u) => u !== uid)
        : [...prev.allowedMemberUids, uid],
    }));
  };

  const toggleEmploymentType = (field: "allowedEmploymentTypes" | "viewEmploymentTypes" | "editEmploymentTypes" | "deleteEmploymentTypes" | "createEmploymentTypes", type: string) => {
    setCalendarPermissions((prev) => ({
      ...prev,
      [field]: prev[field].includes(type)
        ? prev[field].filter((t: string) => t !== type)
        : [...prev[field], type],
    }));
  };

  const togglePermMemberUid = (field: MemberUidField | "sendInvitationMemberUids" | "receiveInvitationMemberUids", uid: string) => {
    setCalendarPermissions((prev) => ({
      ...prev,
      [field]: (prev[field] as string[]).includes(uid)
        ? (prev[field] as string[]).filter((u: string) => u !== uid)
        : [...(prev[field] as string[]), uid],
    }));
  };

  const toggleGroupId = (id: string) => {
    setCalendarPermissions((prev) => ({
      ...prev,
      allowedGroupIds: prev.allowedGroupIds.includes(id)
        ? prev.allowedGroupIds.filter((g) => g !== id)
        : [...prev.allowedGroupIds, id],
    }));
  };

  // オーナーがemployeesに存在しない場合、リストに追加
  const allEmployees = (() => {
    if (!company) return employees;
    const ownerUid = company.ownerUid;
    const hasOwnerRecord = employees.some((e) => e.authUid === ownerUid);
    if (hasOwnerRecord) return employees;
    const ownerRow: EmployeeItem = {
      id: `__owner__${ownerUid}`,
      name: ownerProfile?.displayName || ownerProfile?.email?.split("@")[0] || "オーナー",
      email: ownerProfile?.email || "",
      authUid: ownerUid,
      isActive: true,
      employmentType: undefined,
    };
    return [ownerRow, ...employees];
  })();

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
    >
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-900">カレンダー権限</h1>
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

        {/* 基本権限 */}
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
            {CALENDAR_PERMISSION_ITEMS.map((item) => {
              const isOn = calendarPermissions[item.key];
              const showEmpTypes = isOn && item.key !== "createEvents";
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
                        setCalendarPermissions((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="mt-1 h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-bold text-slate-800">{item.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                    </div>
                  </label>
                  {showEmpTypes && (
                    <div className="ml-8 space-y-2">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-extrabold text-slate-500 mb-2">
                          {item.empTypeLabel}（未選択 = 全雇用形態）
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {EMPLOYMENT_TYPES.map((type) => {
                            const selected = calendarPermissions[item.empTypeField].includes(type);
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
                      {item.memberUidField && (() => {
                        const field = item.memberUidField!;
                        const selectedUids = calendarPermissions[field] as string[];
                        const searchKey = field;
                        const searchTerm = permMemberSearch[searchKey] || "";
                        const otherEmployees = allEmployees.filter(
                          (e) => e.isActive !== false && !!e.authUid && e.authUid !== employee?.authUid
                        );
                        const filteredList = searchTerm
                          ? otherEmployees.filter((e) => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                          : otherEmployees;
                        const selectedMembers = otherEmployees.filter((e) => selectedUids.includes(e.authUid!));
                        return (
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                            <div className="text-[11px] font-extrabold text-slate-500 mb-2">
                              個別メンバー指定（未選択 = 制限なし）
                            </div>
                            {selectedMembers.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {selectedMembers.map((e) => (
                                  <span
                                    key={e.authUid}
                                    className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700"
                                  >
                                    {e.name}
                                    <button
                                      type="button"
                                      onClick={() => togglePermMemberUid(field, e.authUid!)}
                                      className="ml-0.5 text-orange-400 hover:text-orange-600"
                                    >
                                      &times;
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <input
                              type="text"
                              placeholder="メンバーを検索..."
                              value={searchTerm}
                              onChange={(e) => setPermMemberSearch((prev) => ({ ...prev, [searchKey]: e.target.value }))}
                              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200 mb-1.5"
                            />
                            <div className="max-h-32 overflow-y-auto space-y-0.5">
                              {filteredList.length === 0 ? (
                                <div className="px-2 py-1.5 text-[11px] text-slate-400 italic">該当なし</div>
                              ) : (
                                filteredList.map((e) => {
                                  const isSelected = selectedUids.includes(e.authUid!);
                                  return (
                                    <label
                                      key={e.authUid}
                                      className={clsx(
                                        "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition text-xs",
                                        isSelected
                                          ? "bg-orange-50 text-orange-700 font-bold"
                                          : "hover:bg-white text-slate-700"
                                      )}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => togglePermMemberUid(field, e.authUid!)}
                                        className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                                      />
                                      <span>{e.name}</span>
                                      {e.employmentType && (
                                        <span className="text-[10px] text-slate-400 ml-auto">{e.employmentType}</span>
                                      )}
                                    </label>
                                    );
                                  })
                                )}
                              </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 閲覧範囲（viewOthersCalendar がオンの場合のみ） */}
        {calendarPermissions.viewOthersCalendar && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-extrabold text-slate-900 mb-3">閲覧範囲</div>
            <div className="flex flex-wrap gap-2 mb-4">
              {(
                [
                  { value: "all", label: "全員" },
                  { value: "specific_members", label: "特定メンバー" },
                  { value: "specific_groups", label: "特定グループ" },
                  { value: "specific_employment_types", label: "特定の雇用形態" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCalendarPermissions((prev) => ({ ...prev, viewScope: opt.value }))}
                  className={clsx(
                    "rounded-lg border px-4 py-2 text-xs font-extrabold transition",
                    calendarPermissions.viewScope === opt.value
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {calendarPermissions.viewScope === "specific_members" && (
              <div>
                <div className="text-xs font-extrabold text-slate-500 mb-2">閲覧可能なメンバー</div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {allEmployees
                    .filter((e) => e.isActive !== false && !!e.authUid && e.authUid !== employee?.authUid)
                    .map((e) => (
                      <label
                        key={e.id}
                        className={clsx(
                          "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition",
                          calendarPermissions.allowedMemberUids.includes(e.authUid!)
                            ? "border-orange-200 bg-orange-50"
                            : "border-slate-200 bg-white hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={calendarPermissions.allowedMemberUids.includes(e.authUid!)}
                          onChange={() => toggleMemberUid(e.authUid!)}
                          className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="text-xs font-bold text-slate-800">{e.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            {calendarPermissions.viewScope === "specific_groups" && (
              <div>
                <div className="text-xs font-extrabold text-slate-500 mb-2">閲覧可能なグループ</div>
                {groups.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                    グループがまだありません。
                    <Link href="/settings/groups" className="text-orange-600 hover:underline ml-1">
                      グループ管理
                    </Link>
                    から作成してください。
                  </div>
                ) : (
                  <div className="space-y-1">
                    {groups.map((g) => (
                      <label
                        key={g.id}
                        className={clsx(
                          "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition",
                          calendarPermissions.allowedGroupIds.includes(g.id)
                            ? "border-orange-200 bg-orange-50"
                            : "border-slate-200 bg-white hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={calendarPermissions.allowedGroupIds.includes(g.id)}
                          onChange={() => toggleGroupId(g.id)}
                          className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                        />
                        <div className="flex-1">
                          <span className="text-xs font-bold text-slate-800">{g.name}</span>
                          <span className="ml-2 text-[10px] text-slate-500">{g.memberUids.length}名</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {calendarPermissions.viewScope === "specific_employment_types" && (
              <div>
                <div className="text-xs font-extrabold text-slate-500 mb-2">閲覧可能な雇用形態</div>
                <div className="flex flex-wrap gap-1.5">
                  {EMPLOYMENT_TYPES.map((type) => {
                    const selected = calendarPermissions.allowedEmploymentTypes.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleEmploymentType("allowedEmploymentTypes", type)}
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
        )}

        {/* 招待権限 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-3">招待権限</div>
          <div className="text-xs text-slate-500 mb-4">
            カレンダーの閲覧権限がなくても、招待の送受信は独立して制御できます
          </div>
          <div className="space-y-3">
            {([
              { key: "canSendInvitations" as const, label: "他メンバーへの招待送信", desc: "予定にゲストとして他のメンバーを招待できます", memberField: "sendInvitationMemberUids" as const },
              { key: "canReceiveInvitations" as const, label: "他メンバーからの招待受信", desc: "他のメンバーが作成した予定のゲストとして表示されます", memberField: "receiveInvitationMemberUids" as const },
            ]).map((inv) => {
              const isOn = calendarPermissions[inv.key];
              const field = inv.memberField;
              const selectedUids = calendarPermissions[field] as string[];
              const searchKey = field;
              const searchTerm = inviteMemberSearch[searchKey] || "";
              const otherEmployees = allEmployees.filter(
                (e) => e.isActive !== false && !!e.authUid && e.authUid !== employee?.authUid
              );
              const filteredList = searchTerm
                ? otherEmployees.filter((e) => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                : otherEmployees;
              const selectedMembers = otherEmployees.filter((e) => selectedUids.includes(e.authUid!));
              return (
                <div key={inv.key} className="space-y-2">
                  <label
                    className={clsx(
                      "flex items-start gap-3 rounded-lg border p-4 transition cursor-pointer",
                      isOn
                        ? "border-orange-200 bg-orange-50"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={(e) =>
                        setCalendarPermissions((prev) => ({ ...prev, [inv.key]: e.target.checked }))
                      }
                      className="mt-1 h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-bold text-slate-800">{inv.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{inv.desc}</div>
                    </div>
                  </label>
                  {isOn && (
                    <div className="ml-8 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-extrabold text-slate-500 mb-2">
                        個別メンバー指定（未選択 = 制限なし）
                      </div>
                      {selectedMembers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedMembers.map((e) => (
                            <span
                              key={e.authUid}
                              className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700"
                            >
                              {e.name}
                              <button
                                type="button"
                                onClick={() => togglePermMemberUid(field, e.authUid!)}
                                className="ml-0.5 text-orange-400 hover:text-orange-600"
                              >
                                &times;
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder="メンバーを検索..."
                        value={searchTerm}
                        onChange={(e) => setInviteMemberSearch((prev) => ({ ...prev, [searchKey]: e.target.value }))}
                        className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200 mb-1.5"
                      />
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {filteredList.length === 0 ? (
                          <div className="px-2 py-1.5 text-[11px] text-slate-400 italic">該当なし</div>
                        ) : (
                          filteredList.map((e) => {
                            const isSelected = selectedUids.includes(e.authUid!);
                            return (
                              <label
                                key={e.authUid}
                                className={clsx(
                                  "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition text-xs",
                                  isSelected
                                    ? "bg-orange-50 text-orange-700 font-bold"
                                    : "hover:bg-white text-slate-700"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => togglePermMemberUid(field, e.authUid!)}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                                />
                                <span>{e.name}</span>
                                {e.employmentType && (
                                  <span className="text-[10px] text-slate-400 ml-auto">{e.employmentType}</span>
                                )}
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 説明パネル */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-extrabold text-slate-500 mb-2">権限の説明</div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>「他メンバーのカレンダーを閲覧」がオフの場合、チームカレンダーで自分の予定のみ表示されます</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>閲覧範囲で「特定メンバー」「特定グループ」を選ぶと、閲覧可能な範囲を限定できます</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>「予定を作成」がオフの場合、新しい予定を作成できません</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>「他メンバーの予定を編集/削除」は、他のメンバーが作成した予定に対する操作を制御します</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>カレンダーの閲覧権限がなくても、招待済みの予定は表示されます</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span>招待の送受信は閲覧権限とは独立して制御できます</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
