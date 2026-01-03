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
  const [tab, setTab] = useState<"ALL" | "MINE">("ALL");

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
      list = list.filter(c => c.createdBy === user.uid);
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
          <Link href="/projects" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            案件一覧 →
          </Link>
          <Link href="/customers/new" className="rounded-md bg-orange-500 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-orange-600 shadow-sm transition">
            会社を追加
          </Link>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[1600px] px-4">
        {/* HubSpot-style Tab Bar */}
        <div className="mb-4 flex items-center border-b border-slate-200">
          <button
            onClick={() => setTab("ALL")}
            className={clsx(
              "px-4 py-2 text-sm font-bold transition-all border-b-2",
              tab === "ALL" ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            全ての会社 <span className="ml-1 text-[10px] opacity-60 bg-slate-100 px-1.5 py-0.5 rounded-full">{customers.length}</span>
          </button>
          <button
            onClick={() => setTab("MINE")}
            className={clsx(
              "px-4 py-2 text-sm font-bold transition-all border-b-2",
              tab === "MINE" ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            自分の会社
          </button>
          <div className="ml-auto flex items-center gap-2 pb-2">
             <div className="relative">
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="検索..."
                  className="w-64 rounded-md border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 transition"
                />
                <svg className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
             </div>
          </div>
        </div>

        {/* HubSpot-style Filter Bar */}
        <div className="mb-2 flex items-center gap-3 py-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <button className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            会社の担当者 <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 9l-7 7-7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            作成日 <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 9l-7 7-7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="h-4 w-[1px] bg-slate-200 mx-1" />
          <button className="text-[11px] font-bold text-blue-600 hover:underline">＋ その他</button>
          <button className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
            詳細フィルター
          </button>
        </div>

        {/* Table Area */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[400px]">
          <table className="w-full table-fixed divide-y divide-slate-100">
            <thead className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="w-1/3 px-4 py-3 text-left">会社名</th>
                <th className="w-1/4 px-4 py-3 text-left">会社の担当者</th>
                <th className="w-1/4 px-4 py-3 text-left">作成日 (GMT+9)</th>
                <th className="w-48 px-4 py-3 text-left">電話番号</th>
                <th className="w-24 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center">
                      <div className="h-12 w-12 rounded-full bg-slate-50 flex items-center justify-center mb-3 text-slate-300">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <p className="text-sm font-bold text-slate-400 italic">該当する会社が見つかりませんでした</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const creator = employeesByUid[c.createdBy];
                  return (
                    <tr key={c.id} className="group hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/customers/${c.id}`} className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center text-slate-400 group-hover:scale-110 transition-transform">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-extrabold text-blue-600 truncate group-hover:underline">
                              {c.name}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {creator ? (
                          <div className="flex items-center gap-2">
                             <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: creator.color || "#CBD5E1" }}>
                                {creator.name.charAt(0)}
                             </div>
                             <div className="min-w-0">
                               <div className="text-[11px] font-bold text-slate-700 truncate">{creator.name}</div>
                               <div className="text-[10px] text-slate-400 truncate">{creator.email}</div>
                             </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] font-bold text-slate-600">
                        {formatDateTime(c.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-[11px] font-bold text-slate-600">
                        {c.contactPhone || "--"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(c)}
                            className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition"
                            title="編集"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="mt-4 flex items-center justify-center gap-4 text-xs font-bold text-slate-500">
           <button className="flex items-center gap-1 hover:text-orange-500 transition disabled:opacity-30" disabled>
             <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 19l-7-7 7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
             前へ
           </button>
           <div className="flex items-center gap-1">
             <span className="px-2 py-1 rounded bg-orange-100 text-orange-700 border border-orange-200">1</span>
           </div>
           <button className="flex items-center gap-1 hover:text-orange-500 transition disabled:opacity-30" disabled>
             次へ
             <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 5l7 7-7 7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
           </button>
           <div className="h-4 w-[1px] bg-slate-200 mx-2" />
           <div className="flex items-center gap-2">
             <span>ページあたり</span>
             <select className="bg-transparent outline-none cursor-pointer hover:text-orange-500 transition">
               <option>25件</option>
               <option>50件</option>
               <option>100件</option>
             </select>
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
