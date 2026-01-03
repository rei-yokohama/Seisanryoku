"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { logActivity } from "../../../../lib/activity";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
};

type DealStatus = "ACTIVE" | "INACTIVE";

function DealNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<DealStatus>("ACTIVE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadCustomers = async (u: User, prof: MemberProfile) => {
    const merged: Customer[] = [];
    if (prof.companyCode) {
      const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    // companyCode が無い過去データ救済（通常は companyCode でのみ取得する）
    if (!prof.companyCode) {
      const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
      merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(items);
    return items;
  };

  useEffect(() => {
    const initialCustomer = searchParams.get("customerId") || "";
    if (initialCustomer) setCustomerId(initialCustomer);
    const initialStatus = (searchParams.get("status") || "").toUpperCase();
    if (initialStatus === "ACTIVE" || initialStatus === "INACTIVE") setStatus(initialStatus as DealStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const items = await loadCustomers(u, prof);
        if (!customerId && items.length > 0) setCustomerId(items[0].id);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerName = useMemo(() => customers.find((c) => c.id === customerId)?.name || "", [customers, customerId]);

  const handleSubmit = async () => {
    if (!user || !profile) return;
    if (!customerId) {
      setError("顧客を選択してください");
      return;
    }
    const t = title.trim();
    if (!t) {
      setError("案件名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "deals"), {
        companyCode: profile.companyCode,
        createdBy: user.uid,
        customerId,
        title: t,
        genre: genre.trim() || "",
        description: description.trim() || "",
        status,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "DEAL_CREATED",
        message: `案件を作成しました: ${t}（顧客: ${customerName || "未設定"}）`,
        link: "/projects",
      });
      router.push("/projects");
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="案件の追加" subtitle="Deal creation">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="案件の追加"
      subtitle="Deal creation"
      headerRight={
        <Link href="/projects" className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 hover:bg-orange-50">
          ← 案件一覧
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">顧客 *</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 sm:flex-1"
                  >
                    {customers.length === 0 ? <option value="">顧客がありません（先に顧客を追加）</option> : null}
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Link
                    href="/customers/new"
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    顧客を追加
                  </Link>
                </div>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">案件名 *</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：〇〇システム開発"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">案件ジャンル</div>
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：開発 / 広告 / 相談 / 運用"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">ステータス</div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DealStatus)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  <option value="ACTIVE">稼働中</option>
                  <option value="INACTIVE">停止</option>
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">概要</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="案件の背景・範囲・注意点など"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Link href="/projects" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                キャンセル
              </Link>
              <button
                onClick={handleSubmit}
                disabled={saving || customers.length === 0}
                className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
              >
                {saving ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
      </div>
    </AppShell>
  );
}

export default function DealNewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
        </div>
      }
    >
      <DealNewInner />
    </Suspense>
  );
}


