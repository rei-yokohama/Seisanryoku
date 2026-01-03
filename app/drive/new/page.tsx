"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, where } from "firebase/firestore";
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

type DriveItemKind = "folder" | "file";

type DriveItem = {
  id: string;
  companyCode: string;
  createdBy: string;
  kind: DriveItemKind;
  name: string;
  parentId: string | null;
  customerId?: string | null;
  dealId?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

type Deal = { id: string; title: string; companyCode: string };
type Customer = { id: string; name: string; companyCode: string };

export default function DriveNewFolderPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string>("");
  const [dealId, setDealId] = useState<string>("");
  const [lockLink, setLockLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

        // 親フォルダをクエリから初期設定（/drive から遷移する想定）
        if (typeof window !== "undefined") {
          const parentFromQuery = new URLSearchParams(window.location.search).get("parentId");
          if (parentFromQuery) setParentId(parentFromQuery);
        }

        if (prof.companyCode) {
          const [driveSnap, dealByCompany, custByCompany] = await Promise.all([
            getDocs(query(collection(db, "driveItems"), where("companyCode", "==", prof.companyCode))),
            getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode))),
            getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode))),
          ]);
          const folderItems = driveSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as DriveItem))
            .filter((it) => it.kind === "folder")
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
          setFolders(folderItems);

          setDeals(dealByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Deal)).sort((a, b) => (a.title || "").localeCompare(b.title || "")));
          setCustomers(custByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)).sort((a, b) => (a.name || "").localeCompare(b.name || "")));
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dealsInCustomer = useMemo(() => {
    if (!customerId) return [];
    return deals.filter((d: any) => String((d as any).customerId || "") === customerId);
  }, [deals, customerId]);

  // 親フォルダが指定されていて、そのフォルダが顧客/案件に紐づいている場合は継承して固定
  useEffect(() => {
    if (!parentId) {
      setLockLink(false);
      return;
    }
    const p = folders.find((f) => f.id === parentId);
    const pCustomer = (p?.customerId || "") as string;
    const pDeal = (p?.dealId || "") as string;
    if (pCustomer && pDeal) {
      setCustomerId(pCustomer);
      setDealId(pDeal);
      setLockLink(true);
    } else {
      setLockLink(false);
    }
  }, [parentId, folders]);

  // 初期値（親フォルダ継承が無い場合）
  useEffect(() => {
    if (lockLink) return;
    if (!customerId && customers.length > 0) {
      setCustomerId(customers[0].id);
      return;
    }
    if (customerId && !dealId) {
      const first = dealsInCustomer[0];
      if (first) setDealId(first.id);
    }
  }, [lockLink, customers, customerId, dealId, dealsInCustomer]);

  const create = async () => {
    if (!user || !profile) return;
    if (!profile.companyCode) {
      setError("会社コードが未設定です（/settings/company で会社情報を設定してください）");
      return;
    }
    const t = name.trim();
    if (!t) {
      setError("フォルダ名を入力してください");
      return;
    }
    if (!customerId) {
      setError("顧客を選択してください");
      return;
    }
    if (!dealId) {
      setError("案件を選択してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await addDoc(collection(db, "driveItems"), {
        companyCode: profile.companyCode,
        createdBy: user.uid,
        kind: "folder",
        name: t,
        parentId: parentId || null,
        dealId,
        customerId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "FILE_ADDED",
        projectId: dealId,
        entityId: customerId,
        message: `顧客/案件フォルダを作成: ${t}`,
        link: "/drive",
      });
      router.push("/drive");
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="新規フォルダ" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="新規フォルダ"
      subtitle="ドライブ"
      headerRight={
        <Link href="/drive" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          ← ドライブ
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-3xl">
        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="text-sm font-bold text-slate-700">フォルダ名 *</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：SEO案件応募"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </div>

            <div>
              <div className="text-sm font-bold text-slate-700">親フォルダ</div>
              <select
                value={parentId || ""}
                onChange={(e) => setParentId(e.target.value || null)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                <option value="">マイドライブ直下</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-sm font-bold text-slate-700">顧客 *</div>
              <select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setDealId("");
                }}
                disabled={lockLink}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none disabled:bg-slate-50"
              >
                <option value="">顧客を選択</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-bold text-slate-700">案件 *</div>
              <select
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                disabled={lockLink || !customerId}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none disabled:bg-slate-50"
              >
                {!customerId ? <option value="">先に顧客を選択</option> : <option value="">案件を選択</option>}
                {dealsInCustomer.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              {lockLink ? <div className="mt-1 text-xs font-bold text-slate-500">親フォルダの紐づけを継承しています。</div> : null}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Link href="/drive" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              キャンセル
            </Link>
            <button
              onClick={create}
              disabled={busy || !customerId || !dealId}
              className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
            >
              {busy ? "作成中..." : "作成"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


