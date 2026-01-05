"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { ensureProfile } from "../../../../lib/ensureProfile";
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

type DealDoc = {
  companyCode: string;
  createdBy: string;
  customerId: string;
  title: string;
  genre?: string;
  description?: string;
  status: DealStatus;
};

export default function ProjectEditPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

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
  const [loadedOnce, setLoadedOnce] = useState(false);

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
    return items;
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
        const prof = (await ensureProfile(u)) as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);

        await loadCustomers(u, prof);

        const dealSnap = await getDoc(doc(db, "deals", projectId));
        if (!dealSnap.exists()) {
          setError("案件が見つかりません");
          setLoading(false);
          return;
        }
        const d = dealSnap.data() as DealDoc;
        if (!loadedOnce) {
          setCustomerId(d.customerId || "");
          setTitle(d.title || "");
          setGenre(d.genre || "");
          setDescription(d.description || "");
          setStatus((d.status as DealStatus) || "ACTIVE");
          setLoadedOnce(true);
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, projectId, loadedOnce]);

  const customerName = useMemo(() => customers.find((c) => c.id === customerId)?.name || "", [customers, customerId]);

  const handleSave = async () => {
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
      await updateDoc(doc(db, "deals", projectId), {
        customerId,
        title: t,
        genre: genre.trim() || "",
        description: description.trim() || "",
        status,
        updatedAt: Timestamp.now(),
      });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "DEAL_UPDATED",
        projectId,
        entityId: projectId,
        message: `案件を更新しました: ${t}（顧客: ${customerName || "未設定"}）`,
        link: `/projects/${projectId}/detail`,
      });

      router.push(`/projects/${projectId}/detail`);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="案件編集" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="案件編集"
      subtitle="案件情報を更新"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${projectId}/detail`}
            className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 hover:bg-orange-50"
          >
            ← 案件詳細
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || customers.length === 0}
            className="rounded-full bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
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
                <Link href="/customers" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
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
            <Link href={`/projects/${projectId}/detail`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              キャンセル
            </Link>
            <button
              onClick={handleSave}
              disabled={saving || customers.length === 0}
              className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


