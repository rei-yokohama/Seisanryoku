"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Customer = {
  id: string;
  companyCode: string;
  createdBy: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [qText, setQText] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openNew = () => {
    setEditing(null);
    setName("");
    setContactName("");
    setContactEmail("");
    setNotes("");
    setError("");
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setName(c.name || "");
    setContactName(c.contactName || "");
    setContactEmail(c.contactEmail || "");
    setNotes(c.notes || "");
    setError("");
    setModalOpen(true);
  };

  const loadCustomers = async (u: User, prof: MemberProfile) => {
    const merged: Customer[] = [];
    if (prof.companyCode) {
      const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
    merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));

    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(items);
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
        await loadCustomers(u, prof);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = `${c.name || ""} ${c.contactName || ""} ${c.contactEmail || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [customers, qText]);

  const handleSave = async () => {
    if (!user || !profile) return;
    const n = name.trim();
    if (!n) {
      setError("顧客名を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateDoc(doc(db, "customers", editing.id), {
          name: n,
          contactName: contactName.trim() || "",
          contactEmail: contactEmail.trim() || "",
          notes: notes.trim() || "",
          updatedAt: Timestamp.now(),
        });
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "CUSTOMER_UPDATED",
          message: `顧客を更新しました: ${n}`,
          link: "/customers",
        });
      } else {
        await addDoc(collection(db, "customers"), {
          companyCode: profile.companyCode,
          createdBy: user.uid,
          name: n,
          contactName: contactName.trim() || "",
          contactEmail: contactEmail.trim() || "",
          notes: notes.trim() || "",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "CUSTOMER_CREATED",
          message: `顧客を作成しました: ${n}`,
          link: "/customers",
        });
      }
      setModalOpen(false);
      await loadCustomers(user, profile);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="顧客一覧" subtitle="Customers">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
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
        <>
          <Link href="/deals" className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50">
            案件一覧 →
          </Link>
          <button onClick={openNew} className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-extrabold text-emerald-950 hover:bg-emerald-600">
            ＋ 顧客追加
          </button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
              全 {filtered.length} 件
              {profile?.companyCode ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">会社: {profile.companyCode}</span> : null}
            </div>
            <input
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="顧客名 / 担当者 / メールで検索"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:w-96"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-extrabold text-slate-600">
              <div className="col-span-5">顧客名</div>
              <div className="col-span-3">担当者</div>
              <div className="col-span-3">メール</div>
              <div className="col-span-1 text-right">編集</div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">顧客がまだありません。右上から追加してください。</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <div key={c.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                    <div className="col-span-5 min-w-0">
                      <div className="truncate font-extrabold text-slate-900">{c.name}</div>
                      {c.notes ? <div className="truncate text-xs text-slate-500">{c.notes}</div> : null}
                    </div>
                    <div className="col-span-3 truncate text-slate-700">{c.contactName || "-"}</div>
                    <div className="col-span-3 truncate text-slate-700">{c.contactEmail || "-"}</div>
                    <div className="col-span-1 text-right">
                      <button onClick={() => openEdit(c)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        編集
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-slate-500">{editing ? "編集" : "新規"}</div>
                <div className="text-2xl font-extrabold text-slate-900">顧客</div>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                閉じる
              </button>
            </div>

            {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

            <div className="mt-5 grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">顧客名 *</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="例：株式会社〇〇"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-sm font-bold text-slate-700">担当者</div>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="例：田中 太郎"
                  />
                </div>
                <div>
                  <div className="mb-1 text-sm font-bold text-slate-700">メール</div>
                  <input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="例：taro@example.com"
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">メモ</div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="取引条件、注意点など"
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
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-extrabold text-emerald-950 hover:bg-emerald-600 disabled:bg-emerald-300"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}


