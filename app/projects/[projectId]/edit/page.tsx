"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
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
  dealGenres?: string[] | null; // ユーザーごとの案件ジャンル候補
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
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
  leaderUid?: string | null;
  subLeaderUid?: string | null;
  revenue?: number | null;
};

function normalizeOptions(xs: Array<string | null | undefined>) {
  const set = new Set<string>();
  for (const x of xs) {
    const t = String(x || "").trim();
    if (!t) continue;
    set.add(t);
  }
  return Array.from(set).slice(0, 30);
}

export default function ProjectEditPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<DealStatus>("ACTIVE");
  const [leaderUid, setLeaderUid] = useState("");
  const [subLeaderUid, setSubLeaderUid] = useState("");
  const [revenue, setRevenue] = useState("");
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [genreEditorOpen, setGenreEditorOpen] = useState(false);
  const [newGenre, setNewGenre] = useState("");
  const [savingGenres, setSavingGenres] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadedOnce, setLoadedOnce] = useState(false);

  const loadCustomers = async (u: User, prof: MemberProfile) => {
    const merged: Customer[] = [];
    if (prof.companyCode) {
      const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    } else {
      // companyCode が未設定の過去データ救済（通常は通らない想定）
      const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
      merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(items);
    return items;
  };

  const loadEmployees = async (prof: MemberProfile) => {
    if (!prof.companyCode) {
      setEmployees([]);
      return;
    }
    const snap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setEmployees(list);
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
        setGenreOptions(normalizeOptions(prof.dealGenres || []));

        await loadCustomers(u, prof);
        await loadEmployees(prof);

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
          setLeaderUid((d.leaderUid as string) || "");
          setSubLeaderUid((d.subLeaderUid as string) || "");
          setRevenue(d.revenue === null || d.revenue === undefined ? "" : String(d.revenue));
          setLoadedOnce(true);
        }
      } catch (e: any) {
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        setError(code && msg ? `${code}: ${msg}` : msg || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, projectId, loadedOnce]);

  const customerName = useMemo(() => customers.find((c) => c.id === customerId)?.name || "", [customers, customerId]);

  const saveGenreOptions = async (next: string[]) => {
    if (!user) return;
    setSavingGenres(true);
    try {
      await setDoc(doc(db, "profiles", user.uid), { dealGenres: next }, { merge: true });
      setGenreOptions(next);
    } catch (e: any) {
      const code = String(e?.code || "");
      const msg = String(e?.message || "");
      setError(code && msg ? `${code}: ${msg}` : msg || "ジャンル候補の保存に失敗しました");
    } finally {
      setSavingGenres(false);
    }
  };

  const addGenreOption = async () => {
    const t = newGenre.trim();
    if (!t) return;
    const next = normalizeOptions([...genreOptions, t]);
    setNewGenre("");
    await saveGenreOptions(next);
  };

  const removeGenreOption = async (g: string) => {
    const next = genreOptions.filter((x) => x !== g);
    await saveGenreOptions(next);
    // 今選んでいる値が削除されたら未設定に戻す
    if (genre === g) setGenre("");
  };

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
      const revenueTrimmed = revenue.trim();
      const revenueValue: number | null = revenueTrimmed ? Number(revenueTrimmed) : null;
      if (revenueTrimmed) {
        const revenueNum = Number(revenueTrimmed);
        if (Number.isNaN(revenueNum) || revenueNum < 0) {
        setError("売上は 0 以上の数値で入力してください");
        setSaving(false);
        return;
        }
      }

      await updateDoc(doc(db, "deals", projectId), {
        customerId,
        title: t,
        genre: genre.trim() || "",
        description: description.trim() || "",
        status,
        leaderUid: leaderUid || null,
        subLeaderUid: subLeaderUid || null,
        revenue: revenueValue,
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
      const code = String(e?.code || "");
      const msg = String(e?.message || "");
      setError(code && msg ? `${code}: ${msg}` : msg || "保存に失敗しました");
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
              <div className="mb-1 text-sm font-bold text-slate-700">カテゴリ</div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none sm:flex-1"
                >
                  <option value="">未設定</option>
                  {genreOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setGenreEditorOpen((v) => !v)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  候補を編集
                </button>
              </div>
              {genreEditorOpen ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={newGenre}
                      onChange={(e) => setNewGenre(e.target.value)}
                      placeholder="ジャンル候補を追加"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none sm:flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => void addGenreOption()}
                      disabled={savingGenres}
                      className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
                    >
                      追加
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {genreOptions.length === 0 ? (
                      <div className="text-xs font-bold text-slate-500">候補がありません</div>
                    ) : (
                      genreOptions.map((g) => (
                        <span key={g} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700">
                          {g}
                          <button
                            type="button"
                            onClick={() => void removeGenreOption(g)}
                            disabled={savingGenres}
                            className="text-slate-400 hover:text-rose-600 disabled:text-slate-300"
                            title="削除"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="mt-2 text-[11px] font-bold text-slate-500">※ 候補はあなた専用です（他ユーザーには影響しません）</div>
                </div>
              ) : null}
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
              <div className="mb-1 text-sm font-bold text-slate-700">リーダー</div>
              <select
                value={leaderUid}
                onChange={(e) => setLeaderUid(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                <option value="">未設定</option>
                <option value={user.uid}>私</option>
                {employees
                  .filter((e) => !!e.authUid && e.authUid !== user.uid)
                  .map((e) => (
                    <option key={e.id} value={e.authUid}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">サブリーダー</div>
              <select
                value={subLeaderUid}
                onChange={(e) => setSubLeaderUid(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                <option value="">未設定</option>
                <option value={user.uid}>私</option>
                {employees
                  .filter((e) => !!e.authUid && e.authUid !== user.uid)
                  .map((e) => (
                    <option key={e.id} value={e.authUid}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">売上（数値）</div>
              <input
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="例：500000"
              />
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


