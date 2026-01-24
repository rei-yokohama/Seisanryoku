"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User, sendPasswordResetEmail } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, deleteDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { AppShell } from "../../AppShell";
import { ensureProfile } from "../../../lib/ensureProfile";

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  companyCode: string;
};

type EmploymentType = "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託" | "管理者";

type Employee = {
  id: string;
  name: string;
  email: string;
  employmentType: EmploymentType;
  joinDate: string;
  color?: string;
  authUid?: string;
  password?: string;
  companyCode?: string;
  createdBy: string;
};

type Permissions = {
  members: boolean;
  projects: boolean;
  issues: boolean;
  customers: boolean;
  files: boolean;
  billing: boolean;
  settings: boolean;
};

type WorkspaceMembership = {
  id: string;
  companyCode: string;
  uid: string;
  role: "owner" | "admin" | "member"; // admin は後方互換のため残す
  permissions?: Permissions;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function roleLabel(role?: WorkspaceMembership["role"] | null) {
  if (role === "owner") return "オーナー";
  if (role === "admin") return "メンバー"; // admin は member 扱い（後方互換）
  if (role === "member") return "メンバー";
  return "-";
}

export default function MembersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<EmploymentType | "ALL">("ALL");
  const [authFilter, setAuthFilter] = useState<"ALL" | "VERIFIED" | "UNVERIFIED">("ALL");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  const loadEmployees = async (uid: string, companyCode?: string) => {
    const merged: Employee[] = [];
    if (companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", companyCode)));
      merged.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    }
    // companyCode が無い過去データ救済
    if (!companyCode) {
      const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", uid)));
      merged.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    }
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    const items = Array.from(byId.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setEmployees(items);
  };

  const loadMemberships = async (uid: string, companyCode?: string, allowAll?: boolean) => {
    if (!companyCode) {
      setMemberships([]);
      return;
    }
    try {
      if (allowAll) {
        const snap = await getDocs(query(collection(db, "workspaceMemberships"), where("companyCode", "==", companyCode)));
        setMemberships(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkspaceMembership)));
        return;
      }
      // 非オーナーは自分のmembershipだけ読める（ルール上）
      const id = `${companyCode}_${uid}`;
      const snap = await getDoc(doc(db, "workspaceMemberships", id));
      if (snap.exists()) setMemberships([{ id: snap.id, ...snap.data() } as WorkspaceMembership]);
      else setMemberships([]);
    } catch {
      setMemberships([]);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("コピーしました");
    } catch {
      alert("コピーに失敗しました");
    }
  };

  const togglePasswordVisibility = (employeeId: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
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
        const p = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (p) {
          setProfile(p);
          await loadEmployees(u.uid, p.companyCode);

          // スーパーユーザー判定: companies/{companyCode}.ownerUid === uid
          if (p.companyCode) {
            try {
              const compSnap = await getDoc(doc(db, "companies", p.companyCode));
              const ownerUid = compSnap.exists() ? String((compSnap.data() as any).ownerUid || "") : "";
              const isOwner = !!ownerUid && ownerUid === u.uid;
              setIsSuperAdmin(isOwner);
              await loadMemberships(u.uid, p.companyCode, isOwner);
            } catch {
              setIsSuperAdmin(false);
              await loadMemberships(u.uid, p.companyCode, false);
            }
          } else {
            setIsSuperAdmin(false);
          }
        } else {
          setIsSuperAdmin(false);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const membershipByUid = useMemo(() => {
    const m: Record<string, WorkspaceMembership> = {};
    for (const ms of memberships) m[ms.uid] = ms;
    return m;
  }, [memberships]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const adminRow: Employee[] =
      isSuperAdmin && user
        ? [
            {
              id: `__admin__${user.uid}`,
              name: profile?.displayName || user.email?.split("@")[0] || "管理者",
              email: user.email || "-",
              employmentType: "管理者",
              joinDate: "",
              authUid: user.uid,
              color: "#EA580C", // orange-600
              createdBy: user.uid,
              companyCode: profile?.companyCode || "",
            },
          ]
        : [];

    const list = [...adminRow, ...employees];
    const seen = new Set<string>();
    const uniq = list.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return uniq.filter((e) => {
      if (typeFilter !== "ALL" && e.employmentType !== typeFilter) return false;
      if (authFilter === "VERIFIED" && !e.authUid) return false;
      if (authFilter === "UNVERIFIED" && !!e.authUid) return false;
      if (!qq) return true;
      const hay = `${e.name || ""} ${e.email || ""}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [employees, q, typeFilter, authFilter, isSuperAdmin, user, profile]);

  const handleDelete = async (id: string) => {
    if (!isSuperAdmin) {
      alert("メンバーの削除はオーナーのみ可能です。");
      return;
    }
    if (!confirm("このメンバーを削除してもよろしいですか？")) return;
    try {
      await deleteDoc(doc(db, "employees", id));
      setEmployees((prev) => prev.filter((e) => e.id !== id));
    } catch {
      alert("削除に失敗しました");
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      alert(`${email} にパスワードリセットメールを送信しました。`);
    } catch {
      alert("パスワードリセットメールの送信に失敗しました。");
    }
  };

  if (loading) {
    return (
      <AppShell title="メンバー" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="メンバー"
      subtitle="参加ユーザー"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href="/settings/members/invite"
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            招待リンク
          </Link>
          <Link
            href="/settings/members/new"
            className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700"
          >
            ＋ メンバー作成
          </Link>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-extrabold text-slate-900">参加ユーザー</div>
            <div className="text-xs font-bold text-slate-500">
              {profile?.companyCode ? `会社コード: ${profile.companyCode}` : null}
            </div>
          </div>
          {isSuperAdmin ? (
            <div className="mt-2 text-[11px] font-bold text-orange-700">
              管理者モード: メール・初期パスワードの表示が可能です（共有は慎重に）。
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-500">検索</div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="名前 / メールで検索"
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <div className="md:col-span-3">
              <div className="text-xs font-extrabold text-slate-500">雇用形態</div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
              >
                <option value="ALL">すべて</option>
                {(["正社員", "契約社員", "パート", "アルバイト", "業務委託"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <div className="text-xs font-extrabold text-slate-500">認証</div>
              <select
                value={authFilter}
                onChange={(e) => setAuthFilter(e.target.value as any)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-1 focus:ring-orange-500"
              >
                <option value="ALL">すべて</option>
                <option value="VERIFIED">認証済み</option>
                <option value="UNVERIFIED">未認証</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left whitespace-nowrap">名前</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">メール</th>
                  {isSuperAdmin ? <th className="px-4 py-3 text-left whitespace-nowrap">初期パスワード</th> : null}
                  <th className="px-4 py-3 text-left whitespace-nowrap">権限</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">雇用形態</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">認証</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">入社日</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 8 : 7} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      メンバーがいません
                    </td>
                  </tr>
                ) : (
                  filtered.map((e) => {
                    const isAdminRow = e.id.startsWith("__admin__");
                    const uidForRole = e.authUid || "";
                    const role =
                      isAdminRow ? "owner" : uidForRole ? membershipByUid[uidForRole]?.role : undefined;
                    const canSeeRole = isSuperAdmin || uidForRole === user?.uid || isAdminRow;
                    return (
                    <tr key={e.id} className={clsx("hover:bg-slate-50", isAdminRow && "bg-orange-50/30")}>
                      <td className="px-4 py-3 font-extrabold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-5 w-5 flex-shrink-0 rounded-full border border-white shadow-sm"
                            style={{ backgroundColor: e.color || "#3B82F6" }}
                            aria-hidden="true"
                          />
                          <span className="truncate max-w-[150px]">{e.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{e.email}</td>
                      {isSuperAdmin ? (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {e.password ? (
                            <div className="flex items-center gap-2">
                              <code className="rounded bg-slate-100 px-2 py-1 text-xs font-mono text-slate-900">
                                {visiblePasswords.has(e.id) ? e.password : "••••••••"}
                              </code>
                              <button
                                onClick={() => togglePasswordVisibility(e.id)}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-extrabold text-slate-700 hover:bg-slate-50"
                                type="button"
                              >
                                {visiblePasswords.has(e.id) ? "非表示" : "表示"}
                              </button>
                              <button
                                onClick={() => void copyToClipboard(e.password!)}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-extrabold text-slate-700 hover:bg-slate-50"
                                type="button"
                              >
                                コピー
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-slate-400">-</span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                          {canSeeRole ? roleLabel(role as any) : "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                          {e.employmentType}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {e.authUid ? (
                          <span className="inline-flex rounded-full bg-orange-100 px-2 py-1 text-xs font-extrabold text-orange-700">
                            認証済み
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-xs font-extrabold text-rose-700">
                            未認証
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">{e.joinDate || "-"}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {isAdminRow ? (
                            <Link
                              href="/settings/account"
                              className={clsx(
                                "rounded-md border px-3 py-1.5 text-xs font-extrabold",
                                "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                              )}
                              title="アカウント設定"
                            >
                              設定
                            </Link>
                          ) : (
                            <>
                              <Link
                                href={`/settings/members/${encodeURIComponent(e.id)}`}
                                className={clsx(
                                  "rounded-md border px-3 py-1.5 text-xs font-extrabold",
                                  "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                )}
                                title="詳細"
                              >
                                詳細
                              </Link>
                              {(isSuperAdmin || e.authUid === user.uid) ? (
                                <Link
                                  href={`/settings/members/${encodeURIComponent(e.id)}/edit`}
                                  className={clsx(
                                    "rounded-md border px-3 py-1.5 text-xs font-extrabold",
                                    "border-orange-200 bg-white text-orange-700 hover:bg-orange-50",
                                  )}
                                  title="編集"
                                >
                                  編集
                                </Link>
                              ) : null}
                              <button
                                onClick={() => handleSendPasswordReset(e.email)}
                                className={clsx(
                                  "rounded-md border px-3 py-1.5 text-xs font-extrabold",
                                  "border-sky-200 bg-white text-sky-700 hover:bg-sky-50",
                                )}
                                type="button"
                                title="パスワードリセットメール"
                              >
                                🔑 リセット
                              </button>
                              {isSuperAdmin ? (
                                <button
                                  onClick={() => handleDelete(e.id)}
                                  className={clsx(
                                    "rounded-md border px-3 py-1.5 text-xs font-extrabold",
                                    "border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
                                  )}
                                  type="button"
                                >
                                  削除
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}



