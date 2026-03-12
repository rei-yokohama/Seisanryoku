"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { AppShell } from "../AppShell";
import { ensureProfile } from "../../lib/ensureProfile";

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
  companyCode?: string;
  createdBy: string;
  isActive?: boolean | null;
};

type WorkspaceMembership = {
  id: string;
  companyCode: string;
  uid: string;
  role: "owner" | "admin" | "member" | "manager";
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function roleLabel(role?: WorkspaceMembership["role"] | null) {
  if (role === "owner") return "オーナー";
  if (role === "admin") return "メンバー";
  if (role === "manager") return "マネージャー";
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
  const [isOwner, setIsOwner] = useState(false);
  const [canCreateMembers, setCanCreateMembers] = useState(false);
  const [canEditMembers, setCanEditMembers] = useState(false);
  const [allowedViewEmploymentTypes, setAllowedViewEmploymentTypes] = useState<string[]>([]);
  const [companyOwnerUid, setCompanyOwnerUid] = useState<string | null>(null);
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [ownerDisplayEmail, setOwnerDisplayEmail] = useState("");

  const loadEmployees = async (uid: string, companyCode?: string, ownerUid?: string) => {
    const merged: Employee[] = [];
    const rawMap = new Map<string, any>();
    if (companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", companyCode)));
      for (const d of snapByCompany.docs) {
        rawMap.set(d.id, d.data());
        merged.push({ id: d.id, ...d.data() } as Employee);
      }
    }
    if (!companyCode) {
      const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", uid)));
      for (const d of snapByCreator.docs) {
        rawMap.set(d.id, d.data());
        merged.push({ id: d.id, ...d.data() } as Employee);
      }
    }
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    let items = Array.from(byId.values());

    // オーナーのemployeeレコードにauthUidを紐づける
    if (ownerUid && !items.some((e) => e.authUid === ownerUid)) {
      // rawMapからauthUid/uid/emailでオーナーを探す
      let ownerEmail: string | null = null;
      try {
        const ownerProfSnap = await getDoc(doc(db, "profiles", ownerUid));
        if (ownerProfSnap.exists()) {
          const pd = ownerProfSnap.data();
          ownerEmail = pd?.email || null;
          setOwnerDisplayName(pd?.displayName || pd?.email?.split("@")[0] || "");
          setOwnerDisplayEmail(pd?.email || "");
        }
      } catch {
        // 権限不足 — employeesデータだけで対応
      }

      let matched = false;
      // rawMapからuid/authUidフィールドで探す
      for (const [docId, raw] of rawMap.entries()) {
        if (raw.uid === ownerUid) {
          const emp = items.find((e) => e.id === docId);
          if (emp) { emp.authUid = ownerUid; matched = true; }
          break;
        }
      }
      // emailで探す
      if (!matched && ownerEmail) {
        for (const [docId, raw] of rawMap.entries()) {
          if (raw.email === ownerEmail && !raw.authUid) {
            const emp = items.find((e) => e.id === docId);
            if (emp) { emp.authUid = ownerUid; matched = true; }
            break;
          }
        }
      }
    }

    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
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
      const id = `${companyCode}_${uid}`;
      const snap = await getDoc(doc(db, "workspaceMemberships", id));
      if (snap.exists()) setMemberships([{ id: snap.id, ...snap.data() } as WorkspaceMembership]);
      else setMemberships([]);
    } catch {
      setMemberships([]);
    }
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

          if (p.companyCode) {
            // 先にcompaniesを読んでownerUidを取得
            let ownerUid = "";
            try {
              const compSnap = await getDoc(doc(db, "companies", p.companyCode));
              ownerUid = compSnap.exists() ? String((compSnap.data() as any).ownerUid || "") : "";
            } catch {}
            const ownerFlag = !!ownerUid && ownerUid === u.uid;
            setIsOwner(ownerFlag);
            setCompanyOwnerUid(ownerUid || null);

            // ownerUidを渡してemployeesを読み込み（オーナーのauthUid紐づけも行う）
            await loadEmployees(u.uid, p.companyCode, ownerUid || undefined);
            await loadMemberships(u.uid, p.companyCode, ownerFlag);

            // メンバー権限を読み込み
            if (!ownerFlag) {
              try {
                const msSnap = await getDoc(doc(db, "workspaceMemberships", `${p.companyCode}_${u.uid}`));
                if (msSnap.exists()) {
                  const msData = msSnap.data() as any;
                  const mp = msData.memberPermissions || {};
                  setCanCreateMembers(mp.canCreateMembers ?? true);
                  setCanEditMembers(mp.canEditMembers ?? true);
                  setAllowedViewEmploymentTypes(Array.isArray(mp.allowedViewEmploymentTypes) ? mp.allowedViewEmploymentTypes : []);
                }
              } catch {}
            } else {
              setCanCreateMembers(true);
              setCanEditMembers(true);
            }
          } else {
            await loadEmployees(u.uid);
            setIsOwner(false);
          }
        } else {
          setIsOwner(false);
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

    // オーナーがemployeesに存在しない場合、オーナー行を追加
    const ownerHasEmployeeRecord = companyOwnerUid
      ? employees.some((e) => e.authUid === companyOwnerUid)
      : false;
    const adminRow: Employee[] = [];
    if (companyOwnerUid && !ownerHasEmployeeRecord) {
      // オーナーのemployeeレコードが存在しない（authUid紐づけ後も見つからない）
      const name = isOwner
        ? (profile?.displayName || user?.email?.split("@")[0] || "オーナー")
        : (ownerDisplayName || "オーナー");
      const email = isOwner
        ? (user?.email || "-")
        : (ownerDisplayEmail || "-");
      adminRow.push({
        id: `__admin__${companyOwnerUid}`,
        name,
        email,
        employmentType: "管理者",
        joinDate: "",
        authUid: companyOwnerUid,
        color: "#EA580C",
        createdBy: companyOwnerUid,
        companyCode: profile?.companyCode || "",
      });
    }

    const list = [...adminRow, ...employees];
    const seen = new Set<string>();
    const uniq = list.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return uniq
      .filter((e) => {
        // 停止中のメンバーを非表示
        if (e.isActive === false) return false;
        if (typeFilter !== "ALL" && e.employmentType !== typeFilter) return false;
        // 雇用形態別の閲覧制限（自分とオーナーは除外）
        if (!isOwner && allowedViewEmploymentTypes.length > 0 && !e.id.startsWith("__admin__") && e.authUid !== user?.uid) {
          if (!allowedViewEmploymentTypes.includes(e.employmentType)) return false;
        }
        if (!qq) return true;
        const hay = `${e.name || ""} ${e.email || ""}`.toLowerCase();
        return hay.includes(qq);
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [employees, q, typeFilter, isOwner, user, profile, allowedViewEmploymentTypes, companyOwnerUid, ownerDisplayName, ownerDisplayEmail]);

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
    <AppShell title="メンバー" subtitle="チームメンバー一覧">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {/* 検索・フィルタ */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="名前で検索..."
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="ALL">すべての雇用形態</option>
                {(["正社員", "契約社員", "パート", "アルバイト", "業務委託"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {(isOwner || canCreateMembers) && (
              <Link
                href="/settings/members/new"
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 transition"
              >
                ＋ メンバーを追加
              </Link>
            )}
            {(isOwner || canEditMembers) && (
              <Link
                href="/settings/members"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 transition"
              >
                メンバー設定
              </Link>
            )}
          </div>
        </div>

        {/* メンバーリスト */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">
              メンバーがいません
            </div>
          ) : (
            filtered.map((e) => {
              const isAdminRow = e.id.startsWith("__admin__");
              const uidForRole = e.authUid || "";
              const role = uidForRole ? membershipByUid[uidForRole]?.role : undefined;

              return (
                <Link
                  key={e.id}
                  href={isAdminRow && isOwner ? "/settings/account" : `/members/${encodeURIComponent(e.id)}`}
                  className={clsx(
                    "block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-orange-300 hover:shadow-md",
                    isAdminRow && "border-orange-200 bg-orange-50/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 flex-shrink-0 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-lg font-extrabold text-white"
                      style={{ backgroundColor: e.color || "#3B82F6" }}
                    >
                      {(e.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-extrabold text-slate-900 truncate">{e.name}</div>
                      <div className="text-xs text-slate-500 truncate">{e.email}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-600">
                      {e.employmentType}
                    </span>
                    {role && (
                      <span
                        className={clsx(
                          "inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold",
                          role === "owner" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {roleLabel(role as any)}
                      </span>
                    )}
                    {e.isActive === false && (
                      <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-[10px] font-extrabold text-rose-700">
                        停止中
                      </span>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
