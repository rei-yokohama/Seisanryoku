"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, where } from "firebase/firestore";
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

  const loadDocs = async (u: User, prof: MemberProfile) => {
    const merged: WikiDoc[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "wikiDocs"), where("companyCode", "==", prof.companyCode)));
      merged.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as WikiDoc)));
    } else {
      const snapByCreator = await getDocs(query(collection(db, "wikiDocs"), where("createdBy", "==", u.uid)));
      merged.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as WikiDoc)));
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
    const [dealSnap, custSnap, empSnap] = await Promise.all([
      getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode))),
      getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode))),
      getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode))),
    ]);
    setDeals(dealSnap.docs.map(d => ({ id: d.id, ...d.data() } as Deal)));
    setCustomers(custSnap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
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
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);
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
    return docs.filter((d) => (d.title || "").toLowerCase().includes(q));
  }, [docs, qText]);

  const linkCustomerId = (d: WikiDoc) => {
    const direct = String(d.customerId || "");
    if (direct) return direct;
    const legacyCustomer = d.scopeType === "CUSTOMER" ? String(d.scopeId || "") : "";
    if (legacyCustomer) return legacyCustomer;
    const legacyDeal = d.scopeType === "DEAL" ? String(d.scopeId || "") : String(d.dealId || "");
    if (legacyDeal) return dealsById[legacyDeal]?.customerId || "";
    return "";
  };

  const linkDealId = (d: WikiDoc) => {
    const direct = String(d.dealId || "");
    if (direct) return direct;
    const legacyDeal = d.scopeType === "DEAL" ? String(d.scopeId || "") : "";
    return legacyDeal;
  };

  const linkText = (d: WikiDoc) => {
    const cid = linkCustomerId(d);
    const did = linkDealId(d);
    const cn = cid ? customersById[cid]?.name || "" : "";
    const dn = did ? dealsById[did]?.title || "" : "";
    if (cn && dn) return `顧客: ${cn} / 案件: ${dn}`;
    if (cn) return `顧客: ${cn}`;
    if (dn) return `案件: ${dn}`;
    return "未紐づけ";
  };

  const creatorName = (d: WikiDoc) => {
    if (!user) return d.createdBy || "";
    if (d.createdBy === user.uid) return "私";
    return employeeNameByAuthUid[d.createdBy] || (d.createdBy ? d.createdBy.slice(0, 8) : "");
  };

  const createDoc = async () => {
    if (!user || !profile) return;
    setCreating(true);
    setError("");
    try {
      const companyCode = profile.companyCode || "";
      const rootId = "root";
      const ref = await addDoc(collection(db, "wikiDocs"), {
        companyCode,
        createdBy: user.uid,
        title: "無題のドキュメント",
        // Google Docs風：タブ（親/子/孫）を単一ドキュメント内に保持
        nodes: [{ id: rootId, parentId: null, title: "本文", order: 0 }],
        contents: { [rootId]: "" },
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
        <button
          onClick={createDoc}
          disabled={creating}
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 transition disabled:bg-orange-300"
        >
          {creating ? "作成中..." : "＋ 新規"}
        </button>
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
                  <th className="px-4 py-3 text-left">タイトル</th>
                  <th className="px-4 py-3 text-left">紐づけ</th>
                  <th className="px-4 py-3 text-left">作成者</th>
                  <th className="px-4 py-3 text-right">更新</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      読み込み中...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      ドキュメントがまだありません。右上から作成してください。
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const updated = (d.updatedAt as any)?.toDate?.() as Date | undefined;
                    const linked = linkText(d);
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <Link href={`/wiki/${d.id}`} className="hover:underline">
                            {d.title || "無題"}
                          </Link>
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


