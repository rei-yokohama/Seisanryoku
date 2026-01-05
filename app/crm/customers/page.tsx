"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { AppShell } from "../../AppShell";
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
  email?: string;
};

type Customer = {
  id: string;
  companyCode: string;
  createdBy: string;
  name: string;
  assigneeUid?: string | null;
  subAssigneeUid?: string | null; // サブリーダー
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  industry?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function formatDateTime(ts?: Timestamp) {
  if (!ts) return "--";
  const date = ts.toDate();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}年${m}月${d}日 ${hh}:${mm} GMT+9`;
}

export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [qText, setQText] = useState("");
  const [tab, setTab] = useState<"ALL" | "MINE">("ALL"); // MINE = 自分の顧客（担当）
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async (u: User, prof: MemberProfile) => {
    // customers
    const merged: Customer[] = [];
    if (prof.companyCode) {
      const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    } else {
      // companyCode が未設定の過去データ救済（ワークスペース分離のため通常は使わない）
      const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
      merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }

    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => {
      const am = (a.createdAt as any)?.toMillis?.() || 0;
      const bm = (b.createdAt as any)?.toMillis?.() || 0;
      return bm - am;
    });
    setCustomers(items);

    // employees
    const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
    setEmployees(empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
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
        const snap = await getDoc(doc(db, "profiles", u.uid));
        if (!snap.exists()) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const prof = snap.data() as MemberProfile;
        setProfile(prof);
        await loadAll(u, prof);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = customers;
    if (tab === "MINE" && user) {
      // 「自分の顧客」= 担当者が自分
      list = list.filter((c) => (c.assigneeUid || "") === user.uid);
    }
    const q = qText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const hay = `${c.name || ""} ${c.contactName || ""} ${c.contactEmail || ""} ${c.notes || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [customers, qText, tab, user]);

  const employeesByUid = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) if (e.authUid) m[e.authUid] = e;
    return m;
  }, [employees]);

  const openEdit = (c: Customer) => {
    setEditing(c);
    setName(c.name || "");
    setContactName(c.contactName || "");
    setContactEmail(c.contactEmail || "");
    setContactPhone(c.contactPhone || "");
    setNotes(c.notes || "");
    setError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!user || !profile || !editing) return;
    const n = name.trim();
    if (!n) {
      setError("顧客名を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "customers", editing.id), {
        name: n,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        notes: notes.trim(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "CUSTOMER_UPDATED",
        message: `顧客を更新しました: ${n}`,
        link: "/customers",
      });
      await loadAll(user, profile);
      setModalOpen(false);
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="顧客一覧" subtitle="Customers">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="顧客一覧"
      subtitle="Customers"
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/customers/new" className="rounded-md bg-orange-500 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-orange-600 shadow-sm transition">
            顧客を追加
          </Link>
        </div>
      }
    >
      <div className="px-0 py-1">
        {/* 検索条件（/issue と同じ雛形） */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold text-slate-900">検索条件</div>
              <button
                onClick={() => setIsFilterExpanded((v) => !v)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  isFilterExpanded ? "bg-slate-200 text-slate-700" : "bg-orange-600 text-white",
                )}
              >
                {isFilterExpanded ? "▲ 閉じる" : "▼ フィルタを表示"}
              </button>
            </div>
            <div className="text-sm font-bold text-slate-700">全 {filtered.length} 件</div>
          </div>

          {isFilterExpanded && (
            <div className="mt-4 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold text-slate-700">
                <button
                  onClick={() => setTab("ALL")}
                  className={clsx("rounded-full px-3 py-1.5", tab === "ALL" ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  すべて
                </button>
                <button
                  onClick={() => setTab("MINE")}
                  className={clsx("rounded-full px-3 py-1.5", tab === "MINE" ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  自分の顧客
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="顧客名 / メモ / 連絡先など"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">顧客</th>
                  <th className="px-4 py-3 text-left">担当(リーダー)</th>
                  <th className="px-4 py-3 text-left">サブリーダー</th>
                  <th className="px-4 py-3 text-left">電話</th>
                  <th className="px-4 py-3 text-left">更新</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      該当する顧客がありません
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const owner = (c.assigneeUid && employeesByUid[c.assigneeUid]) || employeesByUid[c.createdBy];
                    const subLeader = c.subAssigneeUid ? employeesByUid[c.subAssigneeUid] : null;
                    const updated = (c.updatedAt as any) || c.createdAt;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <Link href={`/customers/${c.id}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {owner?.name ? (
                            <div className="flex items-center gap-2">
                              <div
                                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-white"
                                style={{ backgroundColor: owner.color || "#ea580c" }}
                              >
                                {owner.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-bold">{owner.name}</span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {subLeader?.name ? (
                            <div className="flex items-center gap-2">
                              <div
                                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-white"
                                style={{ backgroundColor: subLeader.color || "#64748b" }}
                              >
                                {subLeader.name.charAt(0).toUpperCase()}
                              </div>
                              <span>{subLeader.name}</span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{c.contactPhone || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(updated)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEdit(c)}
                            className="rounded-md bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100"
                          >
                            編集
                          </button>
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-500">編集</div>
                <div className="text-2xl font-extrabold text-slate-900">顧客</div>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                閉じる
              </button>
            </div>

            {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

            <div className="mt-5 grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">顧客名 *</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：株式会社〇〇"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">担当者名</div>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：山田 太郎"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">メールアドレス</div>
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：yamada@example.com"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">備考</div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="顧客に関するメモ"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
              >
                {saving ? "更新中..." : "更新"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
