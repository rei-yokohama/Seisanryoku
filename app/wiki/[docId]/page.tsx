"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { ensureProfile } from "../../../lib/ensureProfile";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  companyName?: string | null;
  displayName?: string | null;
};

type WikiScopeType = "GLOBAL" | "DEAL" | "CUSTOMER";

type WikiNode = {
  id: string;
  parentId: string | null;
  title: string;
  order: number;
};

type WikiDoc = {
  companyCode: string;
  createdBy: string;
  title: string;
  // 新: Google Docs風（タブツリー + HTMLコンテンツ）
  nodes?: WikiNode[];
  contents?: Record<string, string>;
  // 新: 顧客/案件の両方に紐づける
  customerId?: string | null;
  dealId?: string | null;
  scopeType?: WikiScopeType;
  scopeId?: string | null;

  // 旧: プレーンテキスト（互換のため読み込みに使う）
  content?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type Deal = { id: string; title: string; companyCode: string; customerId: string };
type Customer = { id: string; name: string; companyCode: string };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function genId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (const n of arr) out += chars[n % chars.length];
  return out;
}

function collectDescendants(nodes: WikiNode[], rootId: string) {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      if (!children.has(n.parentId)) children.set(n.parentId, []);
      children.get(n.parentId)!.push(n.id);
    }
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    const cs = children.get(cur) || [];
    for (const c of cs) {
      out.push(c);
      stack.push(c);
    }
  }
  return out;
}

export default function WikiDocPage() {
  const router = useRouter();
  const params = useParams<{ docId: string }>();
  const docId = params.docId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [nodes, setNodes] = useState<WikiNode[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [activeNodeId, setActiveNodeId] = useState<string>("root");
  const [customerId, setCustomerId] = useState<string>("");
  const [dealId, setDealId] = useState<string>("");

  const [deals, setDeals] = useState<Deal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const draftHtmlRef = useRef<string>("");
  const lastAppliedHtmlRef = useRef<string>("");

  const doSaveNow = async (opts?: { force?: boolean }) => {
    if (!user) return;
    try {
      setError("");
      if (!profile?.companyCode) {
        setError("会社コードが未設定です（/settings/company で会社情報を設定してください）");
        return;
      }
      // いま見えているDOMを保存対象にする
      const el = editorRef.current;
      if (el) draftHtmlRef.current = el.innerHTML;

      const mergedContents: Record<string, string> = {
        ...contents,
        [activeNodeId]: draftHtmlRef.current,
      };

      setSaving(true);
      const payload: any = {
        companyCode: profile.companyCode,
        title: title.trim() || "無題",
        nodes,
        contents: mergedContents,
        updatedAt: Timestamp.now(),
      };
      // 紐づけは null も含めて保存（シンプルに一発で状態が一致する）
      payload.customerId = customerId || null;
      payload.dealId = dealId || null;
      payload.scopeType = dealId ? "DEAL" : "GLOBAL";
      payload.scopeId = dealId || null;

      await updateDoc(doc(db, "wikiDocs", docId), payload);
      setSavedAt(new Date());
    } catch (e: any) {
      const code = e?.code ? String(e.code) : "";
      const msg = e?.message ? String(e.message) : "";
      setError(code && msg ? `${code}: ${msg}` : msg || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const load = async (u: User) => {
    const prof = (await ensureProfile(u)) as MemberProfile | null;
    if (!prof) throw new Error("ワークスペース情報を確認できませんでした（招待リンクの再実行、または管理者に再招待をご依頼ください）");
    setProfile(prof);

    const snap = await getDoc(doc(db, "wikiDocs", docId));
    if (!snap.exists()) throw new Error("ドキュメントが見つかりません");
    const d = snap.data() as WikiDoc;
    setTitle(d.title || "無題");

    // linkage (must be customer + deal)
    const docDealId = (d.dealId || "") as string;
    const docCustomerId = (d.customerId || "") as string;
    let nextDealId = docDealId;
    let nextCustomerId = docCustomerId;

    // legacy migration
    if ((!nextDealId || !nextCustomerId) && d.scopeType && d.scopeId) {
      if (d.scopeType === "DEAL") {
        nextDealId = nextDealId || String(d.scopeId || "");
      }
      if (d.scopeType === "CUSTOMER") {
        nextCustomerId = nextCustomerId || String(d.scopeId || "");
      }
    }

    // nodes/contents (migration from old `content`)
    const rootId = "root";
    const nextNodes: WikiNode[] =
      Array.isArray(d.nodes) && d.nodes.length > 0
        ? d.nodes
        : [{ id: rootId, parentId: null, title: "本文", order: 0 }];
    const nextContents: Record<string, string> =
      d.contents && typeof d.contents === "object"
        ? (d.contents as Record<string, string>)
        : {};

    if (!nextContents[rootId]) {
      const legacy = (d.content || "").trim();
      if (legacy) {
        // 旧: プレーンテキスト → ざっくりHTML化
        nextContents[rootId] = `<p>${escapeHtml(legacy).replaceAll("\n", "<br/>")}</p>`;
      } else {
        nextContents[rootId] = "";
      }
    }

    setNodes(nextNodes.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    setContents(nextContents);
    setActiveNodeId(nextNodes[0]?.id || rootId);

    // linkage candidates
    if (prof.companyCode) {
      const [dealByCompany, custByCompany] = await Promise.all([
        getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode))),
        getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode))),
      ]);

      const dealMap = new Map<string, Deal>();
      for (const x of dealByCompany.docs) dealMap.set(x.id, ({ id: x.id, ...x.data() } as Deal));
      const dealItems = Array.from(dealMap.values()).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      setDeals(dealItems);

      const custMap = new Map<string, Customer>();
      for (const x of custByCompany.docs) custMap.set(x.id, ({ id: x.id, ...x.data() } as Customer));
      const custItems = Array.from(custMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setCustomers(custItems);

      // fill missing side by looking up
      if (nextDealId && !nextCustomerId) {
        nextCustomerId = dealItems.find((dd) => dd.id === nextDealId)?.customerId || "";
      }
      if (nextCustomerId && !nextDealId) {
        nextDealId = dealItems.find((dd) => dd.customerId === nextCustomerId)?.id || "";
      }
    } else {
      setDeals([]);
      setCustomers([]);
    }

    setDealId(nextDealId || "");
    setCustomerId(nextCustomerId || "");
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
        await load(u);
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const canDelete = useMemo(() => {
    // MVP: ログインしていれば削除可能（ルールは後で締める）
    return !!user;
  }, [user]);

  const handleDelete = async () => {
    if (!user || !profile) return;
    if (!confirm("このドキュメントを削除しますか？")) return;
    try {
      await deleteDoc(doc(db, "wikiDocs", docId));
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "WIKI_DELETED",
        message: "Wikiドキュメントを削除しました",
        link: "/wiki",
      });
      router.push("/wiki");
    } catch (e: any) {
      setError(e?.message || "削除に失敗しました");
    }
  };

  const activeHtml = contents[activeNodeId] ?? "";
  const activeNode = useMemo(() => nodes.find(n => n.id === activeNodeId) || null, [nodes, activeNodeId]);

  // tree helpers
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, WikiNode[]>();
    for (const n of nodes) {
      const k = n.parentId ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.title || "").localeCompare(b.title || ""));
      m.set(k, arr);
    }
    return m;
  }, [nodes]);

  const updateDraftFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    draftHtmlRef.current = html;
  };

  const setActiveAndSyncDom = (nextId: string) => {
    const el = editorRef.current;
    if (el) {
      const html = el.innerHTML;
      draftHtmlRef.current = html;
      setContents((prev) => ({ ...prev, [activeNodeId]: html }));
    }
    setActiveNodeId(nextId);
    // DOM同期は useEffect で
  };

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const nextHtml = contents[activeNodeId] ?? "";
    // 入力中に毎回 innerHTML を書き戻すと重くなる＆カーソルが飛ぶので、タブ切替時だけ同期
    if (lastAppliedHtmlRef.current !== nextHtml) {
      el.innerHTML = nextHtml;
      lastAppliedHtmlRef.current = nextHtml;
      draftHtmlRef.current = nextHtml;
    }
  }, [activeNodeId]);

  const exec = (cmd: string, value?: string) => {
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand(cmd, false, value);
    updateDraftFromDom();
  };

  const addSibling = () => {
    if (!activeNode) return;
    const parentId = activeNode.parentId;
    const nextId = genId(10);
    const siblings = nodes.filter(n => (n.parentId ?? null) === (parentId ?? null));
    const maxOrder = siblings.reduce((m, n) => Math.max(m, n.order ?? 0), 0);
    const next: WikiNode = { id: nextId, parentId, title: "新しいタブ", order: maxOrder + 1 };
    setNodes((prev) => [...prev, next]);
    setContents((prev) => ({ ...prev, [nextId]: "" }));
    setActiveNodeId(nextId);
  };

  const addChild = () => {
    if (!activeNode) return;
    const parentId = activeNode.id;
    const nextId = genId(10);
    const kids = nodes.filter(n => n.parentId === parentId);
    const maxOrder = kids.reduce((m, n) => Math.max(m, n.order ?? 0), 0);
    const next: WikiNode = { id: nextId, parentId, title: "子タブ", order: maxOrder + 1 };
    setNodes((prev) => [...prev, next]);
    setContents((prev) => ({ ...prev, [nextId]: "" }));
    setActiveNodeId(nextId);
  };

  const renameActive = () => {
    if (!activeNode) return;
    const next = prompt("タブ名を入力", activeNode.title || "");
    if (next == null) return;
    const t = next.trim() || "無題";
    setNodes((prev) => prev.map(n => (n.id === activeNode.id ? { ...n, title: t } : n)));
  };

  const deleteActive = () => {
    if (!activeNode) return;
    if (activeNode.parentId == null) {
      alert("本文タブは削除できません");
      return;
    }
    if (!confirm("このタブ（子孫タブ含む）を削除しますか？")) return;
    const descendants = collectDescendants(nodes, activeNode.id);
    const idsToRemove = new Set<string>([activeNode.id, ...descendants]);
    const remainNodes = nodes.filter(n => !idsToRemove.has(n.id));
    const remainContents: Record<string, string> = {};
    for (const [k, v] of Object.entries(contents)) {
      if (!idsToRemove.has(k)) remainContents[k] = v;
    }
    setNodes(remainNodes);
    setContents(remainContents);
    setActiveNodeId("root");
  };

  const customerName = useMemo(() => customers.find((c) => c.id === customerId)?.name || "", [customers, customerId]);
  const dealTitle = useMemo(() => deals.find((d) => d.id === dealId)?.title || "", [deals, dealId]);
  const dealsInCustomer = useMemo(() => {
    if (!customerId) return [];
    return deals.filter((d) => d.customerId === customerId);
  }, [deals, customerId]);

  return (
    <AppShell
      title={title || "無題"}
      subtitle="Wiki"
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/wiki" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            ← 一覧
          </Link>
          <button
            onClick={() => void doSaveNow({ force: true })}
            disabled={saving || loading || !user}
            className="rounded-full bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
            type="button"
            title="今の内容を保存"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {canDelete ? (
            <button onClick={handleDelete} className="rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100">
              削除
            </button>
          ) : null}
        </div>
      }
    >
      <div className="w-full">
        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
        {!loading && (!customerId || !dealId) ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
            このWikiは <span className="font-extrabold">顧客</span> と <span className="font-extrabold">案件</span> の両方に紐づけ推奨です（未選択でも本文は保存されます）。
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">読み込み中...</div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            {/* Top bar (Google Docs風) */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-[240px]">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-lg border border-transparent bg-slate-50 px-3 py-2 text-base font-extrabold text-slate-900 outline-none focus:border-orange-500"
                    placeholder="タイトル"
                  />
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>{saving ? "保存中..." : savedAt ? `保存済み: ${savedAt.toLocaleTimeString()}` : "編集できます"}</span>
                    <span className="text-slate-300">•</span>
                    <span>会社: <span className="font-bold text-slate-700">{profile?.companyCode || "-"}</span></span>
                    <span className="text-slate-300">•</span>
                    <span>
                      紐づけ:{" "}
                      <span className="font-bold text-slate-700">
                        顧客 {customerName ? `（${customerName}）` : "（未選択）"} / 案件 {dealTitle ? `（${dealTitle}）` : "（未選択）"}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Link selector (must) */}
                <div className="flex items-center gap-2">
                  <select
                    value={customerId}
                    onChange={(e) => {
                      const nextCustomer = e.target.value;
                      setCustomerId(nextCustomer);
                      const nextDeal = deals.find((d) => d.customerId === nextCustomer)?.id || "";
                      setDealId(nextDeal);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                    title="顧客"
                  >
                    <option value="">顧客を選択</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dealId}
                    onChange={(e) => {
                      const nextDeal = e.target.value;
                      setDealId(nextDeal);
                      const nextCustomer = deals.find((d) => d.id === nextDeal)?.customerId || "";
                      if (nextCustomer) setCustomerId(nextCustomer);
                    }}
                    className="max-w-[320px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                    title="案件"
                    disabled={!customerId}
                  >
                    {!customerId ? <option value="">先に顧客を選択</option> : <option value="">案件を選択</option>}
                    {dealsInCustomer.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void doSaveNow({ force: true })}
                    disabled={saving || loading || !user}
                    className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
                    type="button"
                    title="この内容を保存"
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>

              {/* Formatting toolbar */}
              <div className="flex flex-wrap items-center gap-1 px-4 pb-3">
                <button onClick={() => exec("undo")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50" title="元に戻す">
                  ↶
                </button>
                <button onClick={() => exec("redo")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50" title="やり直し">
                  ↷
                </button>
                <div className="mx-1 h-6 w-px bg-slate-200" />
                <button onClick={() => exec("bold")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-extrabold text-slate-800 hover:bg-slate-50" title="太字">
                  B
                </button>
                <button onClick={() => exec("italic")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold italic text-slate-800 hover:bg-slate-50" title="斜体">
                  I
                </button>
                <button onClick={() => exec("underline")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold underline text-slate-800 hover:bg-slate-50" title="下線">
                  U
                </button>
                <div className="mx-1 h-6 w-px bg-slate-200" />
                <select
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "p") exec("formatBlock", "p");
                    if (v === "h1") exec("formatBlock", "h1");
                    if (v === "h2") exec("formatBlock", "h2");
                    if (v === "h3") exec("formatBlock", "h3");
                    e.currentTarget.value = "p";
                  }}
                  defaultValue="p"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700"
                  title="見出し"
                >
                  <option value="p">本文</option>
                  <option value="h1">見出し1</option>
                  <option value="h2">見出し2</option>
                  <option value="h3">見出し3</option>
                </select>
                <button onClick={() => exec("insertUnorderedList")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50" title="箇条書き">
                  ••
                </button>
                <button onClick={() => exec("insertOrderedList")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50" title="番号付きリスト">
                  1.
                </button>
                <button
                  onClick={() => {
                    const url = prompt("リンクURLを入力");
                    if (!url) return;
                    exec("createLink", url);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  title="リンク"
                >
                  🔗
                </button>
                <button onClick={() => exec("removeFormat")} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50" title="装飾を解除">
                  Tx
                </button>
              </div>
            </div>

            {/* Body: left tree + wide editor */}
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-[70vh]">
              {/* Left tree */}
              <aside className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50">
                <div className="px-3 py-3">
                  <div className="text-xs font-extrabold text-slate-600">ドキュメント タブ</div>
                </div>
                <div className="px-2 pb-3">
                  {(() => {
                    const render = (parentId: string | null, depth: number) => {
                      const list = childrenByParent.get(parentId) || [];
                      return (
                        <div className={depth === 0 ? "space-y-1" : "space-y-1"}>
                          {list.map((n) => (
                            <div key={n.id}>
                              <button
                                onClick={() => setActiveAndSyncDom(n.id)}
                                className={clsx(
                                  "w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold transition",
                                  n.id === activeNodeId ? "bg-orange-100 text-orange-800" : "text-slate-700 hover:bg-white",
                                )}
                                style={{ paddingLeft: 12 + depth * 14 }}
                              >
                                <span className="truncate">{n.title || "無題"}</span>
                                {n.id === activeNodeId ? <span className="text-xs text-orange-700">●</span> : null}
                              </button>
                              {render(n.id, depth + 1)}
                            </div>
                          ))}
                        </div>
                      );
                    };
                    return render(null, 0);
                  })()}
                </div>
                <div className="border-t border-slate-200 p-3 space-y-2">
                  <button onClick={addSibling} className="w-full rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 border border-slate-200">
                    ＋ タブ追加
                  </button>
                  <button onClick={addChild} className="w-full rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 border border-slate-200">
                    ＋ 子タブ追加
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={renameActive} className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 border border-slate-200">
                      名前変更
                    </button>
                    <button onClick={deleteActive} className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 border border-red-200">
                      削除
                    </button>
                  </div>
                </div>
              </aside>

              {/* Editor */}
              <section className="bg-white">
                <div className="px-4 py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-extrabold text-slate-900">
                      {activeNode?.title || "本文"}
                    </div>
                    <div className="text-xs font-bold text-slate-500">
                      横幅最大（描きやすいモード）
                    </div>
                  </div>
                  <div
                    ref={editorRef}
                    className="min-h-[68vh] w-full rounded-xl border border-slate-200 bg-white px-5 py-5 text-[15px] leading-7 text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={updateDraftFromDom}
                    onBlur={() => {
                      updateDraftFromDom();
                      // blur した時点の内容は state にも反映（タブ切替や再描画のため）
                      setContents((prev) => ({ ...prev, [activeNodeId]: draftHtmlRef.current }));
                    }}
                    spellCheck={false}
                    style={{ maxWidth: "none" }}
                    data-placeholder="ここに入力…（上のバーで装飾できます）"
                  />
                  {activeHtml.length === 0 ? (
                    <div className="pointer-events-none -mt-[68vh] px-6 py-6 text-sm text-slate-400">
                      ここに入力…（上のバーで太字・見出し・箇条書き・リンクなどが使えます）
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}


