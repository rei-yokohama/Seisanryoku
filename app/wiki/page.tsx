"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, where, writeBatch } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { logActivity } from "../../lib/activity";
import { AppShell } from "../AppShell";
import { ensureProfile } from "../../lib/ensureProfile";

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
  // 新: 顧客/案件紐づけ
  customerId?: string | null;
  dealId?: string | null;
  scopeType?: WikiScopeType;
  scopeId?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type WikiScopeType = "GLOBAL" | "DEAL" | "CUSTOMER";

type Deal = { id: string; title: string; companyCode: string; customerId: string };
type Customer = { id: string; name: string; companyCode: string };
type Employee = { id: string; name: string; authUid?: string };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function WikiHomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<WikiDoc[]>([]);
  const [qText, setQText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const loadDocs = async (u: User, prof: MemberProfile) => {
    const merged: WikiDoc[] = [];
    try {
      if (prof.companyCode) {
        const snapByCompany = await getDocs(query(collection(db, "wikiDocs"), where("companyCode", "==", prof.companyCode)));
        merged.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as WikiDoc)));
      } else {
        const snapByCreator = await getDocs(query(collection(db, "wikiDocs"), where("createdBy", "==", u.uid)));
        merged.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as WikiDoc)));
      }
    } catch (e: any) {
      const code = String(e?.code || "");
      const msg = String(e?.message || "");
      setError(code && msg ? `${code}: ${msg}` : msg || "読み込みに失敗しました（Wiki一覧）");
      setDocs([]);
      return;
    }
    const byId = new Map<string, WikiDoc>();
    for (const d of merged) byId.set(d.id, d);
    const items = Array.from(byId.values()).sort((a, b) => {
      const am = (a.updatedAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
      const bm = (b.updatedAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
      return bm - am;
    });
    setDocs(items);
  };

  const loadMeta = async (u: User, prof: MemberProfile) => {
    if (!prof.companyCode) {
      setDeals([]);
      setCustomers([]);
      setEmployees([]);
      return;
    }
    try {
      const [dealSnap, custSnap, empSnap] = await Promise.all([
        getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode))),
        getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode))),
        getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode))),
      ]);
      setDeals(dealSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal)));
      setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      setEmployees(empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    } catch (e: any) {
      const code = String(e?.code || "");
      const msg = String(e?.message || "");
      setDeals([]);
      setCustomers([]);
      setEmployees([]);
      setError((prev) => prev || (code && msg ? `${code}: ${msg}` : msg || "読み込みに失敗しました（紐づけ情報）"));
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
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);

        // 権限チェック
        if (prof.companyCode) {
          try {
            const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
            const isOwner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
            if (!isOwner) {
              const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
              if (msSnap.exists()) {
                const perms = (msSnap.data() as any).permissions || {};
                if (perms.wiki === false) {
                  window.location.href = "/";
                  return;
                }
              }
            }
          } catch (e) {
            console.warn("permission check failed:", e);
          }
        }

        await loadDocs(u, prof);
        await loadMeta(u, prof);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dealsById = useMemo(() => {
    const m: Record<string, Deal> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

  const customersById = useMemo(() => {
    const m: Record<string, Customer> = {};
    for (const c of customers) m[c.id] = c;
    return m;
  }, [customers]);

  const employeeNameByAuthUid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of employees) if (e.authUid) m[e.authUid] = e.name;
    return m;
  }, [employees]);

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => {
      const hay = `${d.title || ""} ${linkText(d)} ${creatorName(d)}`.toLowerCase();
      return hay.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, qText, dealsById, customersById, employeeNameByAuthUid, user]);

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
    const ok = confirm(`選択した ${ids.length} 件のWikiを削除しますか？（この操作は取り消せません）`);
    if (!ok) return;

    setBulkDeleting(true);
    setError("");
    try {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.delete(doc(db, "wikiDocs", id));
      }
      await batch.commit();

      await logActivity({
        companyCode: profile.companyCode || "",
        actorUid: user.uid,
        type: "WIKI_DELETED",
        message: `Wikiドキュメントを一括削除しました（${ids.length}件）`,
        link: "/wiki",
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

  function linkCustomerId(d: WikiDoc) {
    const direct = String(d.customerId || "");
    if (direct) return direct;
    const legacyCustomer = d.scopeType === "CUSTOMER" ? String(d.scopeId || "") : "";
    if (legacyCustomer) return legacyCustomer;
    const legacyDeal = d.scopeType === "DEAL" ? String(d.scopeId || "") : String(d.dealId || "");
    if (legacyDeal) return dealsById[legacyDeal]?.customerId || "";
    return "";
  }

  function linkDealId(d: WikiDoc) {
    const direct = String(d.dealId || "");
    if (direct) return direct;
    const legacyDeal = d.scopeType === "DEAL" ? String(d.scopeId || "") : "";
    return legacyDeal;
  }

  function linkText(d: WikiDoc) {
    const cid = linkCustomerId(d);
    const did = linkDealId(d);
    const cn = cid ? customersById[cid]?.name || "" : "";
    const dn = did ? dealsById[did]?.title || "" : "";
    if (cn && dn) return `顧客: ${cn} / 案件: ${dn}`;
    if (cn) return `顧客: ${cn}`;
    if (dn) return `案件: ${dn}`;
    return "未紐づけ";
  }

  function creatorName(d: WikiDoc) {
    if (!user) return d.createdBy || "";
    if (d.createdBy === user.uid) return "私";
    return employeeNameByAuthUid[d.createdBy] || (d.createdBy ? d.createdBy.slice(0, 8) : "");
  }

  const createDoc = async () => {
    if (!user || !profile) return;
    setCreating(true);
    setError("");
    try {
      const companyCode = profile.companyCode || "";
      if (!companyCode) throw new Error("会社コードが未設定です（/settings/company で会社情報を設定してください）");
      const ref = await addDoc(collection(db, "wikiDocs"), {
        companyCode,
        createdBy: user.uid,
        title: "無題のドキュメント",
        // 新規作成直後は「タブなし」状態にする（タブ追加してから入力）
        nodes: [],
        contents: {},
        scopeType: "GLOBAL" as WikiScopeType,
        scopeId: null,
        // 互換性：過去実装の content を残しておく（新UIでは使わない）
        content: "",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode,
        actorUid: user.uid,
        type: "WIKI_CREATED",
        message: "Wikiドキュメントを作成しました",
        link: `/wiki/${ref.id}`,
      });
      router.push(`/wiki/${ref.id}`);
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell
      title="Wiki"
      subtitle="Google Docs風"
      headerRight={
        <div className="flex items-center gap-2">
          {editMode ? (
            <button
              onClick={exitEditMode}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
              type="button"
            >
              完了
            </button>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              disabled={loading || docs.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              type="button"
            >
              編集
            </button>
          )}
          {editMode && selectedCount > 0 ? (
            <button
              onClick={() => void bulkDelete()}
              disabled={bulkDeleting || loading}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-50"
              title="選択したWikiを削除"
              type="button"
            >
              {bulkDeleting ? "削除中..." : `選択を削除（${selectedCount}）`}
            </button>
          ) : null}
          <button
            onClick={createDoc}
            disabled={creating}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 transition disabled:bg-orange-300"
            type="button"
          >
            {creating ? "作成中..." : "＋ 新規"}
          </button>
        </div>
      }
    >
      <div className="px-0 py-1">
        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

        {/* 検索条件（/issue と同じトーン） */}
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
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  {editMode ? (
                    <th className="w-10 px-3 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        disabled={loading || filtered.length === 0}
                        title="全選択"
                        className="h-4 w-4 accent-orange-600"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left">タイトル</th>
                  <th className="px-4 py-3 text-left">紐づけ</th>
                  <th className="px-4 py-3 text-left">作成者</th>
                  <th className="px-4 py-3 text-right">更新</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={editMode ? 5 : 4} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      読み込み中...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={editMode ? 5 : 4} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      ドキュメントがまだありません。右上から作成してください。
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const updated = (d.updatedAt as any)?.toDate?.() as Date | undefined;
                    const linked = linkText(d);
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
                              aria-label="選択"
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {editMode ? (
                            <button
                              type="button"
                              onClick={() => toggleSelect(d.id)}
                              className="hover:underline"
                              title="選択"
                            >
                              {d.title || "無題"}
                            </button>
                          ) : (
                            <Link href={`/wiki/${d.id}`} className="hover:underline">
                              {d.title || "無題"}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700">{linked}</td>
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


