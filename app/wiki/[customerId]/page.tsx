"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, where, writeBatch } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { AppShell } from "../../AppShell";
import { ensureProfile } from "../../../lib/ensureProfile";

type MemberProfile = {
  uid: string;
  companyCode: string;
  companyName?: string | null;
  displayName?: string | null;
};

type WikiDoc = {
  id: string;
  companyCode: string;
  title: string;
  createdBy: string;
  customerId?: string | null;
  dealId?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type Employee = { id: string; name: string; authUid?: string };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function WikiCustomerPage() {
  const router = useRouter();
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<WikiDoc[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [qText, setQText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);

        // 顧客名取得
        const custSnap = await getDoc(doc(db, "customers", customerId));
        if (custSnap.exists()) {
          setCustomerName((custSnap.data() as any).name || "");
        }

        // Wiki一覧取得（この顧客のもの）
        if (prof.companyCode) {
          const [wikiSnap, empSnap] = await Promise.all([
            getDocs(query(
              collection(db, "wikiDocs"),
              where("companyCode", "==", prof.companyCode),
              where("customerId", "==", customerId),
            )),
            getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode))),
          ]);
          const items = wikiSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as WikiDoc))
            .sort((a, b) => {
              const am = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
              const bm = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
              return bm - am;
            });
          setDocs(items);
          setEmployees(empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const employeeNameByAuthUid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of employees) if (e.authUid) m[e.authUid] = e.name;
    return m;
  }, [employees]);

  function creatorName(d: WikiDoc) {
    if (!user) return d.createdBy || "";
    if (d.createdBy === user.uid) return profile?.displayName || user.email?.split("@")[0] || "ユーザー";
    return employeeNameByAuthUid[d.createdBy] || (d.createdBy ? d.createdBy.slice(0, 8) : "");
  }

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => (d.title || "").toLowerCase().includes(q));
  }, [docs, qText]);

  const allFilteredSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((d) => selectedIds.has(d.id));
  }, [filtered, selectedIds]);

  const selectedCount = selectedIds.size;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelectAll = !filtered.every((d) => next.has(d.id));
      if (shouldSelectAll) {
        for (const d of filtered) next.add(d.id);
      } else {
        for (const d of filtered) next.delete(d.id);
      }
      return next;
    });
  };

  const bulkDelete = async () => {
    if (!user || !profile) return;
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (!confirm(`選択した ${ids.length} 件のWikiを削除しますか？（この操作は取り消せません）`)) return;
    setBulkDeleting(true);
    setError("");
    try {
      const batch = writeBatch(db);
      for (const id of ids) batch.delete(doc(db, "wikiDocs", id));
      await batch.commit();
      await logActivity({
        companyCode: profile.companyCode || "",
        actorUid: user.uid,
        type: "WIKI_DELETED",
        message: `Wikiドキュメントを一括削除しました（${ids.length}件）`,
        link: `/wiki/${customerId}`,
      });
      setDocs((prev) => prev.filter((d) => !selectedIds.has(d.id)));
      setSelectedIds(new Set());
    } catch (e: any) {
      setError(e?.message || "削除に失敗しました");
    } finally {
      setBulkDeleting(false);
    }
  };

  const exitEditMode = () => {
    setEditMode(false);
    setSelectedIds(new Set());
  };

  const createDoc = async () => {
    if (!user || !profile) return;
    setCreating(true);
    setError("");
    try {
      const companyCode = profile.companyCode || "";
      if (!companyCode) throw new Error("会社コードが未設定です");
      const ref = await addDoc(collection(db, "wikiDocs"), {
        companyCode,
        createdBy: user.uid,
        title: "無題のドキュメント",
        nodes: [],
        contents: {},
        customerId,
        dealId: null,
        scopeType: "CUSTOMER",
        scopeId: customerId,
        content: "",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode,
        actorUid: user.uid,
        type: "WIKI_CREATED",
        message: "Wikiドキュメントを作成しました",
        link: `/wiki/${customerId}/${ref.id}`,
      });
      router.push(`/wiki/${customerId}/${ref.id}`);
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell
      title={customerName || "Wiki"}
      subtitle="Wiki ドキュメント一覧"
    >
      <div className="px-0 py-1">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>
        ) : null}

        {/* 検索条件 */}
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-700">全 {filtered.length} 件</span>
              <Link
                href="/wiki"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              >
                ← 顧客一覧
              </Link>
              {editMode ? (
                <button
                  onClick={exitEditMode}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                  type="button"
                >
                  完了
                </button>
              ) : (
                <button
                  onClick={() => setEditMode(true)}
                  disabled={loading || docs.length === 0}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  type="button"
                >
                  編集
                </button>
              )}
              {editMode && selectedCount > 0 ? (
                <button
                  onClick={() => void bulkDelete()}
                  disabled={bulkDeleting || loading}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  type="button"
                >
                  {bulkDeleting ? "削除中..." : `選択を削除（${selectedCount}）`}
                </button>
              ) : null}
              <button
                onClick={createDoc}
                disabled={creating}
                className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-orange-700 transition disabled:bg-orange-300"
                type="button"
              >
                {creating ? "作成中..." : "＋ 新規Wiki"}
              </button>
            </div>
          </div>

          {isFilterExpanded && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                  <input
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="ドキュメントを検索"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[600px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  {editMode ? (
                    <th className="w-10 px-3 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        disabled={loading || filtered.length === 0}
                        className="h-4 w-4 accent-orange-600"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left">タイトル</th>
                  <th className="px-4 py-3 text-left">作成者</th>
                  <th className="px-4 py-3 text-right">更新</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={editMode ? 4 : 3} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      読み込み中...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={editMode ? 4 : 3} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      ドキュメントがまだありません。右上の「＋ 新規Wiki」から作成してください。
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const updated = (d.updatedAt as any)?.toDate?.() as Date | undefined;
                    const checked = selectedIds.has(d.id);
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        {editMode ? (
                          <td className="w-10 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(d.id)}
                              className="h-4 w-4 accent-orange-600"
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {editMode ? (
                            <button
                              type="button"
                              onClick={() => toggleSelect(d.id)}
                              className="hover:underline"
                            >
                              {d.title || "無題"}
                            </button>
                          ) : (
                            <Link href={`/wiki/${customerId}/${d.id}`} className="hover:underline">
                              {d.title || "無題"}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700">{creatorName(d) || "-"}</td>
                        <td className="px-4 py-3 text-right text-xs font-bold text-slate-600">
                          {updated ? updated.toLocaleDateString() : "-"}
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
