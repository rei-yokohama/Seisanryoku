"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../../lib/firebase";
import { AppShell } from "../../../../AppShell";
import {
  type DataVisibilityPermissions,
  DEFAULT_DATA_VISIBILITY,
  type Group,
} from "../../../../../lib/visibilityPermissions";

type MemberProfile = {
  uid: string;
  companyCode: string;
};

type Company = {
  ownerUid: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  isActive?: boolean | null;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type Props = {
  title: string;
  icon: string;
  fieldName: string;
  explanationItems: string[];
};

export default function DataPermissionPage({ title, icon, fieldName, explanationItems }: Props) {
  const router = useRouter();
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [employee, setEmployee] = useState<{ id: string; name: string; email: string; authUid?: string } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [perms, setPerms] = useState<DataVisibilityPermissions>(DEFAULT_DATA_VISIBILITY);

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

        // 対象メンバー取得
        const empSnap = await getDoc(doc(db, "employees", memberId));
        if (!empSnap.exists()) {
          setError("メンバーが見つかりません");
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...empSnap.data() } as any;
        setEmployee(emp);

        if (prof.companyCode) {
          // 社員一覧
          const eSnap = await getDocs(
            query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)),
          );
          setEmployees(eSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));

          // グループ一覧
          const gSnap = await getDocs(
            query(collection(db, "groups"), where("companyCode", "==", prof.companyCode)),
          );
          setGroups(gSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Group)));

          // 既存権限（ドキュメント未作成の場合はデフォルト値を使用）
          if (emp.authUid) {
            try {
              const msSnap = await getDoc(
                doc(db, "workspaceMemberships", `${prof.companyCode}_${emp.authUid}`),
              );
              if (msSnap.exists()) {
                const msData = msSnap.data() as any;
                const p = msData[fieldName] || {};
                setPerms({
                  viewOthersData: p.viewOthersData ?? DEFAULT_DATA_VISIBILITY.viewOthersData,
                  viewScope: p.viewScope ?? DEFAULT_DATA_VISIBILITY.viewScope,
                  allowedMemberUids: Array.isArray(p.allowedMemberUids) ? p.allowedMemberUids : [],
                  allowedGroupIds: Array.isArray(p.allowedGroupIds) ? p.allowedGroupIds : [],
                });
              }
            } catch {
              // ドキュメント未作成 or 権限不足の場合はデフォルト値のまま
            }
          }
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, memberId, fieldName]);

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
        [fieldName]: perms,
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
    setPerms((prev: DataVisibilityPermissions) => ({
      ...prev,
      allowedMemberUids: prev.allowedMemberUids.includes(uid)
        ? prev.allowedMemberUids.filter((u: string) => u !== uid)
        : [...prev.allowedMemberUids, uid],
    }));
  };

  const toggleGroupId = (id: string) => {
    setPerms((prev: DataVisibilityPermissions) => ({
      ...prev,
      allowedGroupIds: prev.allowedGroupIds.includes(id)
        ? prev.allowedGroupIds.filter((g: string) => g !== id)
        : [...prev.allowedGroupIds, id],
    }));
  };

  if (loading) {
    return (
      <AppShell title={title} subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell title={title} subtitle={employee?.name || "メンバー"}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
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
                saving ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700",
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

        {/* メイン設定 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-lg">
              {icon}
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-900">
                {employee?.name || "メンバー"} の{title}
              </div>
              <div className="text-xs text-slate-500">{employee?.email}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-4">
            {/* 他メンバーのデータを閲覧できる */}
            <label
              className={clsx(
                "flex items-start gap-3 rounded-lg border p-4 transition cursor-pointer",
                perms.viewOthersData
                  ? "border-orange-200 bg-orange-50"
                  : "border-slate-200 bg-white hover:bg-slate-50",
              )}
            >
              <input
                type="checkbox"
                checked={perms.viewOthersData}
                onChange={(e) =>
                  setPerms((prev: DataVisibilityPermissions) => ({ ...prev, viewOthersData: e.target.checked }))
                }
                className="mt-1 h-5 w-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-800">他メンバーのデータを閲覧できる</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  オフにすると、自分のデータのみ表示されます
                </div>
              </div>
            </label>

            {/* 閲覧範囲 */}
            {perms.viewOthersData && (
              <div className="space-y-3">
                <div className="text-xs font-extrabold text-slate-500">閲覧範囲</div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: "all", label: "全員" },
                      { value: "specific_members", label: "特定メンバー" },
                      { value: "specific_groups", label: "特定グループ" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPerms((prev: DataVisibilityPermissions) => ({ ...prev, viewScope: opt.value }))}
                      className={clsx(
                        "rounded-lg border px-4 py-2 text-xs font-extrabold transition",
                        perms.viewScope === opt.value
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* メンバーピッカー */}
                {perms.viewScope === "specific_members" && (
                  <div>
                    <div className="text-xs font-extrabold text-slate-500 mb-2">閲覧可能なメンバー</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {employees
                        .filter((e) => e.isActive !== false && !!e.authUid && e.authUid !== employee?.authUid)
                        .map((e) => (
                          <label
                            key={e.id}
                            className={clsx(
                              "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition",
                              perms.allowedMemberUids.includes(e.authUid!)
                                ? "border-orange-200 bg-orange-50"
                                : "border-slate-200 bg-white hover:bg-slate-50",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={perms.allowedMemberUids.includes(e.authUid!)}
                              onChange={() => toggleMemberUid(e.authUid!)}
                              className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                            />
                            <span className="text-xs font-bold text-slate-800">{e.name}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                {/* グループピッカー */}
                {perms.viewScope === "specific_groups" && (
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
                              perms.allowedGroupIds.includes(g.id)
                                ? "border-orange-200 bg-orange-50"
                                : "border-slate-200 bg-white hover:bg-slate-50",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={perms.allowedGroupIds.includes(g.id)}
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
              </div>
            )}
          </div>
        </div>

        {/* 説明パネル */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-extrabold text-slate-500 mb-2">権限の説明</div>
          <div className="space-y-2 text-xs text-slate-600">
            {explanationItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-orange-600">•</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
