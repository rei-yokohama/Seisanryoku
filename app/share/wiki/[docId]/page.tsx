"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useParams } from "next/navigation";
import { db } from "../../../../lib/firebase";

type WikiNode = {
  id: string;
  parentId: string | null;
  title: string;
  order: number;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ShareWikiPage() {
  const params = useParams();
  const docId = params.docId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [nodes, setNodes] = useState<WikiNode[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "wikiDocs", docId));
        if (!snap.exists()) {
          setError("ドキュメントが見つかりません");
          setLoading(false);
          return;
        }

        const d = snap.data() as any;

        if (!d.shareEnabled) {
          setError("このドキュメントは共有されていません");
          setLoading(false);
          return;
        }

        setTitle(d.title || "無題");

        // ノード読み込み
        const rawNodes: WikiNode[] = Array.isArray(d.nodes)
          ? d.nodes
              .filter((n: any) => n?.id && n.id !== "root")
              .map((n: any) => ({
                id: String(n.id),
                parentId: n.parentId ?? null,
                title: String(n.title || ""),
                order: typeof n.order === "number" ? n.order : 0,
              }))
          : [];

        // コンテンツ読み込み（subcollection）
        let loadedContents: Record<string, string> = {};
        if (d.contentStorage === "subcollection") {
          try {
            const [tabSnap, partSnap] = await Promise.all([
              getDocs(collection(db, "wikiDocs", docId, "tabContents")),
              getDocs(collection(db, "wikiDocs", docId, "tabParts")),
            ]);
            const chunksByTab = new Map<string, Array<{ index: number; chunk: string }>>();
            for (const p of partSnap.docs) {
              const pd = p.data() as any;
              const tabId = typeof pd?.tabId === "string" ? pd.tabId : String(p.id).split("__")[0];
              const index = typeof pd?.index === "number" ? pd.index : Number(String(p.id).split("__")[1] || 0);
              const chunk = typeof pd?.chunk === "string" ? pd.chunk : "";
              if (!chunksByTab.has(tabId)) chunksByTab.set(tabId, []);
              chunksByTab.get(tabId)!.push({ index, chunk });
            }
            for (const tabDoc of tabSnap.docs) {
              const tabId = tabDoc.id;
              const tabData = tabDoc.data() as any;
              if (typeof tabData?.html === "string") {
                loadedContents[tabId] = tabData.html;
                continue;
              }
              const parts = (chunksByTab.get(tabId) || []).sort((a, b) => a.index - b.index);
              loadedContents[tabId] = parts.map((x) => x.chunk).join("");
            }
            for (const [tabId, parts] of chunksByTab.entries()) {
              if (!(tabId in loadedContents)) {
                loadedContents[tabId] = parts.sort((a, b) => a.index - b.index).map((x) => x.chunk).join("");
              }
            }
          } catch {
            loadedContents = {};
          }
        }

        // フォールバック
        if (Object.keys(loadedContents).length === 0) {
          if (d.contentsJson && typeof d.contentsJson === "string" && d.contentsJson.length > 2) {
            try {
              loadedContents = JSON.parse(d.contentsJson);
            } catch { /* ignore */ }
          }
          if (Object.keys(loadedContents).length === 0 && d.contents && typeof d.contents === "object") {
            loadedContents = { ...d.contents };
          }
        }

        const sortedNodes = rawNodes.sort((a, b) => a.order - b.order);
        setNodes(sortedNodes);
        setContents(loadedContents);
        setActiveNodeId(sortedNodes.length > 0 ? sortedNodes[0].id : null);
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [docId]);

  const activeHtml = activeNodeId ? (contents[activeNodeId] ?? "") : "";
  const activeNode = useMemo(() => nodes.find((n) => n.id === activeNodeId) || null, [nodes, activeNodeId]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, WikiNode[]>();
    for (const n of nodes) {
      const k = n.parentId ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    for (const [, arr] of m.entries()) {
      arr.sort((a, b) => a.order - b.order || (a.title || "").localeCompare(b.title || ""));
    }
    return m;
  }, [nodes]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <div className="text-xl font-bold text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="mx-auto max-w-6xl px-4">
        {/* Header */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-1 text-xs font-bold text-slate-500">共有ドキュメント</div>
          <h1 className="text-2xl font-extrabold text-slate-900">{title}</h1>
        </div>

        {/* Body */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] min-h-[60vh]">
            {/* Sidebar */}
            {nodes.length > 1 && (
              <aside className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50">
                <div className="px-3 py-3">
                  <div className="text-xs font-extrabold text-slate-600">タブ</div>
                </div>
                <div className="px-2 pb-3">
                  {(() => {
                    const render = (parentId: string | null, depth: number) => {
                      const list = childrenByParent.get(parentId) || [];
                      return (
                        <div className="space-y-1">
                          {list.map((n) => (
                            <div key={n.id}>
                              <button
                                onClick={() => setActiveNodeId(n.id)}
                                className={clsx(
                                  "w-full flex items-center rounded-lg px-3 py-2 text-left text-sm font-bold transition",
                                  n.id === activeNodeId ? "bg-orange-100 text-orange-800" : "text-slate-700 hover:bg-white",
                                )}
                                style={{ paddingLeft: 12 + depth * 14 }}
                              >
                                <span className="truncate">{n.title || "無題"}</span>
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
              </aside>
            )}

            {/* Content */}
            <section className="bg-white">
              <div className="px-6 py-6">
                {activeNode && nodes.length > 1 && (
                  <div className="mb-4 text-sm font-extrabold text-slate-900">{activeNode.title}</div>
                )}
                <div
                  className="wiki-share-content max-w-none text-[15px] leading-7 text-slate-800"
                  dangerouslySetInnerHTML={{ __html: activeHtml }}
                />
                <style>{`
                  .wiki-share-content h1 { font-size: 1.75rem; font-weight: 800; color: #0f172a; margin: 1.5rem 0 0.75rem; line-height: 1.3; }
                  .wiki-share-content h2 { font-size: 1.375rem; font-weight: 800; color: #1e293b; margin: 1.25rem 0 0.5rem; line-height: 1.35; }
                  .wiki-share-content h3 { font-size: 1.125rem; font-weight: 700; color: #1e293b; margin: 1rem 0 0.5rem; line-height: 1.4; }
                  .wiki-share-content p { margin: 0.5rem 0; color: #334155; }
                  .wiki-share-content a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
                  .wiki-share-content a:hover { color: #1d4ed8; }
                  .wiki-share-content ul { list-style: disc; padding-left: 1.5rem; margin: 0.5rem 0; color: #334155; }
                  .wiki-share-content ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; color: #334155; }
                  .wiki-share-content li { margin: 0.25rem 0; }
                  .wiki-share-content b, .wiki-share-content strong { font-weight: 700; color: #1e293b; }
                  .wiki-share-content blockquote { border-left: 3px solid #cbd5e1; padding-left: 1rem; margin: 0.75rem 0; color: #64748b; font-style: italic; }
                  .wiki-share-content code { background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875em; color: #475569; }
                  .wiki-share-content pre { background: #f1f5f9; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }
                  .wiki-share-content table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
                  .wiki-share-content th, .wiki-share-content td { border: 1px solid #e2e8f0; padding: 0.5rem 0.75rem; text-align: left; }
                  .wiki-share-content th { background: #f8fafc; font-weight: 700; color: #1e293b; }
                `}</style>
                {!activeHtml && (
                  <div className="text-sm text-slate-400">（内容がありません）</div>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-slate-500">
          このドキュメントは生産力 (Seisanryoku) で管理されています
        </div>
      </div>
    </div>
  );
}
