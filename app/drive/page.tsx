"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db, storage } from "../../lib/firebase";
import { logActivity } from "../../lib/activity";
import { ensureProfile } from "../../lib/ensureProfile";
import { AppShell } from "../AppShell";

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
  // optional relation
  customerId?: string | null;
  dealId?: string | null;
  // file meta
  storagePath?: string | null;
  url?: string | null;
  size?: number | null;
  mimeType?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function joinPath(parts: string[]) {
  return parts.filter(Boolean).join("/");
}

export default function DrivePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [items, setItems] = useState<DriveItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const [qText, setQText] = useState("");
  const [busy, setBusy] = useState(false);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // アップロード進捗管理
  const [uploadProgress, setUploadProgress] = useState<
    Array<{
      name: string;
      progress: number;
      status: "uploading" | "done" | "error";
      transferredBytes: number;
      totalBytes: number;
      errorCode?: string;
      storagePath?: string;
    }>
  >([]);
  const lastUploadDebugRef = useRef<{ fileName: string; storagePath: string } | null>(null);

  const loadItems = async (u: User, prof: MemberProfile) => {
    const merged: DriveItem[] = [];
    if (prof.companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "driveItems"), where("companyCode", "==", prof.companyCode)));
      merged.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as DriveItem)));
    } else {
      const snapByCreator = await getDocs(query(collection(db, "driveItems"), where("createdBy", "==", u.uid)));
      merged.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as DriveItem)));
    }

    const byId = new Map<string, DriveItem>();
    for (const it of merged) byId.set(it.id, it);
    const list = Array.from(byId.values()).sort((a, b) => {
      const ak = a.kind === "folder" ? 0 : 1;
      const bk = b.kind === "folder" ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return (a.name || "").localeCompare(b.name || "");
    });
    setItems(list);
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
          setError("ワークスペース情報を確認できませんでした。招待リンクを開き直すか、管理者に再招待を依頼してください。");
          setLoading(false);
          return;
        }
        setProfile(prof);
        await loadItems(u, prof);
      } catch (e: any) {
        setError(e?.message || "ドライブの読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URLからフォルダを開く（/drive?folderId=xxx）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const folderId = new URLSearchParams(window.location.search).get("folderId");
    if (folderId) setCurrentFolderId(folderId);
  }, []);

  const foldersById = useMemo(() => {
    const m: Record<string, DriveItem> = {};
    for (const it of items) if (it.kind === "folder") m[it.id] = it;
    return m;
  }, [items]);

  const currentChildren = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return items.filter((it) => {
      if ((it.parentId || null) !== currentFolderId) return false;
      if (!q) return true;
      return (it.name || "").toLowerCase().includes(q);
    });
  }, [items, currentFolderId, qText]);

  const breadcrumb = useMemo(() => {
    const out: Array<{ id: string | null; name: string }> = [{ id: null, name: "マイドライブ" }];
    let cur = currentFolderId;
    const guard = new Set<string>();
    while (cur) {
      if (guard.has(cur)) break;
      guard.add(cur);
      const f = foldersById[cur];
      if (!f) break;
      out.push({ id: f.id, name: f.name });
      cur = f.parentId || null;
    }
    return out.reverse();
  }, [currentFolderId, foldersById]);

  const triggerUpload = () => {
    if (!currentFolderId) {
      setError("アップロードするには、先にアップロード先フォルダを開いてください。");
      setSuccess("");
      return;
    }
    fileInputRef.current?.click();
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!user) return;
    if (!profile) {
      setError("ワークスペース情報を確認中です。数秒待ってから再度お試しください。");
      setSuccess("");
      return;
    }
    if (!currentFolderId) {
      setError("アップロードするには、先にアップロード先フォルダを開いてください。");
      setSuccess("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!profile.companyCode) {
      setError("会社コードが未設定です（/settings/company で会社情報を設定してください）");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    
    // 進捗状態の初期化
    const uploads = Array.from(files);
    setUploadProgress(uploads.map((f) => ({ name: f.name, progress: 0, status: "uploading", transferredBytes: 0, totalBytes: f.size || 0 })));

    try {
      for (let i = 0; i < uploads.length; i++) {
        const f = uploads[i];
        const docRef = doc(collection(db, "driveItems"));
        const storagePath = joinPath(["drive", profile.companyCode, user.uid, docRef.id, f.name]);
        lastUploadDebugRef.current = { fileName: f.name, storagePath };
        const sref = storageRef(storage, storagePath);
        const task = uploadBytesResumable(sref, f, { contentType: f.type || undefined });
        
        await new Promise<void>((resolve, reject) => {
          task.on(
            "state_changed",
            (snapshot) => {
              // 進捗を計算
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(prev => 
                prev.map((item, idx) => 
                  idx === i
                    ? {
                        ...item,
                        progress: Math.round(progress),
                        transferredBytes: snapshot.bytesTransferred,
                        totalBytes: snapshot.totalBytes,
                        storagePath,
                      }
                    : item
                )
              );
            },
            (err) => {
              setUploadProgress(prev => 
                prev.map((item, idx) => 
                  idx === i ? { ...item, status: "error", errorCode: String(err?.code || ""), storagePath } : item
                )
              );
              reject(err);
            },
            () => resolve(),
          );
        });
        
        const url = await getDownloadURL(sref);

        await setDoc(docRef, {
          companyCode: profile.companyCode,
          createdBy: user.uid,
          kind: "file",
          name: f.name,
          parentId: currentFolderId,
          storagePath,
          url,
          size: f.size,
          mimeType: f.type || "",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        // 完了をマーク
        setUploadProgress(prev => 
          prev.map((item, idx) => 
            idx === i ? { ...item, progress: 100, status: "done", transferredBytes: f.size || item.transferredBytes, totalBytes: f.size || item.totalBytes, storagePath } : item
          )
        );
      }

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "FILE_ADDED",
        message: `ドライブにファイルをアップロードしました（${files.length}件）`,
        link: "/drive",
      });

      await loadItems(user, profile);
      setSuccess("アップロードしました");
      
      // 3秒後に進捗表示をクリア
      setTimeout(() => setUploadProgress([]), 3000);
    } catch (e: any) {
      const code = e?.code ? String(e.code) : "";
      const msg = e?.message ? String(e.message) : "";
      setError(code && msg ? `${code}: ${msg}` : msg || "アップロードに失敗しました");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (it: DriveItem) => {
    if (!user || !profile) return;
    if (!confirm(`「${it.name}」を削除しますか？`)) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      // folder: allow delete only if empty (simple rule)
      if (it.kind === "folder") {
        const hasChild = items.some((x) => (x.parentId || null) === it.id);
        if (hasChild) {
          setError("フォルダが空ではありません。先に中身を削除してください。");
          return;
        }
      }
      // file: delete from storage if present
      if (it.kind === "file" && it.storagePath) {
        try {
          await deleteObject(storageRef(storage, it.storagePath));
        } catch {
          // ignore storage delete errors
        }
      }
      await deleteDoc(doc(db, "driveItems", it.id));
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "FILE_DELETED",
        message: `ドライブから削除しました: ${it.name}`,
        link: "/drive",
      });
      await loadItems(user, profile);
      setSuccess("削除しました");
    } catch (e: any) {
      setError(e?.message || "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="ドライブ" subtitle="Drive">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const folderShareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/drive${currentFolderId ? `?folderId=${encodeURIComponent(currentFolderId)}` : ""}`
      : "";

  const copyFolderUrl = async () => {
    if (!folderShareUrl) return;
    try {
      await navigator.clipboard.writeText(folderShareUrl);
      setSuccess("フォルダURLをコピーしました");
      setError("");
    } catch {
      setError("コピーに失敗しました（ブラウザの権限をご確認ください）");
      setSuccess("");
    }
  };

  return (
    <AppShell
      title="ドライブ"
      subtitle="Google Drive風（フォルダ + 複数アップロード）"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={currentFolderId ? `/drive/new?parentId=${encodeURIComponent(currentFolderId)}` : "/drive/new"}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 transition"
          >
            ＋ 新規フォルダ
          </Link>
          <button
            onClick={() => void copyFolderUrl()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 transition"
            type="button"
            title="現在開いているフォルダのURLをコピー"
          >
            フォルダURL
          </button>
          <button
            onClick={triggerUpload}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 transition disabled:opacity-50 disabled:hover:bg-orange-600"
            disabled={busy || !currentFolderId}
            title={!currentFolderId ? "アップロードはフォルダを開いてから実行できます" : "アップロード"}
          >
            アップロード
          </button>
        </div>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleUploadFiles(e.target.files)}
      />

      <div className="mx-auto w-full max-w-6xl">
        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
        {success ? <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-700">{success}</div> : null}

        {/* アップロード進捗表示 */}
        {uploadProgress.length > 0 && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="mb-3 text-sm font-extrabold text-blue-900">
              アップロード中 ({uploadProgress.filter(p => p.status === "done").length}/{uploadProgress.length})
            </div>
            {typeof window !== "undefined" && window.location.hostname === "localhost" && lastUploadDebugRef.current ? (
              <div className="mb-3 rounded-lg border border-blue-200 bg-white/60 p-3 text-xs font-bold text-slate-700">
                <div>Debug: bucket = <span className="font-extrabold">{process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "-"}</span></div>
                <div>Debug: lastFile = <span className="font-extrabold">{lastUploadDebugRef.current.fileName}</span></div>
                <div>Debug: storagePath = <span className="font-extrabold">{lastUploadDebugRef.current.storagePath}</span></div>
              </div>
            ) : null}
            <div className="space-y-3">
              {uploadProgress.map((item, idx) => (
                <div key={idx}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="truncate font-bold text-blue-900">{item.name}</span>
                    <span className={clsx(
                      "font-extrabold",
                      item.status === "done" ? "text-green-700" : 
                      item.status === "error" ? "text-red-700" : "text-blue-700"
                    )}>
                      {item.status === "done" ? "完了" : 
                       item.status === "error" ? (item.errorCode ? `エラー (${item.errorCode})` : "エラー") : `${item.progress}%`}
                    </span>
                  </div>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-slate-600">
                    <span>
                      {Math.round((item.transferredBytes || 0) / 1024 / 1024)}MB / {Math.max(1, Math.round((item.totalBytes || 0) / 1024 / 1024))}MB
                    </span>
                    {item.storagePath ? <span className="truncate max-w-[55%] text-slate-500">{item.storagePath}</span> : null}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                    <div 
                      className={clsx(
                        "h-full transition-all duration-300",
                        item.status === "done" ? "bg-green-600" :
                        item.status === "error" ? "bg-red-600" : "bg-blue-600"
                      )}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-0 py-1">
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
                  type="button"
                >
                  {isFilterExpanded ? "▲ 閉じる" : "▼ フィルタを表示"}
                </button>
              </div>
              <div className="text-sm font-bold text-slate-700">
                {breadcrumb.map((b, idx) => (
                  <span key={`${b.id ?? "root"}-${idx}`}>
                    <button
                      className={idx === breadcrumb.length - 1 ? "text-slate-900" : "text-orange-700 hover:underline"}
                      onClick={() => setCurrentFolderId(b.id)}
                      type="button"
                    >
                      {b.name}
                    </button>
                    {idx < breadcrumb.length - 1 ? <span className="mx-1 text-slate-400">/</span> : null}
                  </span>
                ))}
              </div>
            </div>

            {isFilterExpanded && (
              <div className="mt-4 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="md:col-span-6">
                    <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                    <input
                      value={qText}
                      onChange={(e) => setQText(e.target.value)}
                      placeholder="このフォルダ内を検索"
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-700">
            全 {currentChildren.length} 件
          </div>
        </div>

        {!currentFolderId ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            アップロードはフォルダを開いてから実行できます（マイドライブ直下へのアップロードは不可）。
          </div>
        ) : null}

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">名前</th>
                  <th className="px-4 py-3 text-left">種類</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentChildren.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      まだ何もありません。右上から追加してください。
                    </td>
                  </tr>
                ) : (
                  currentChildren.map((it) => (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {it.kind === "folder" ? (
                          <button
                            onClick={() => setCurrentFolderId(it.id)}
                            className="flex min-w-0 items-center gap-2 text-left hover:underline"
                          >
                            <span className="text-lg">📁</span>
                            <span className="truncate">{it.name}</span>
                          </button>
                        ) : it.url ? (
                          <a className="flex min-w-0 items-center gap-2 hover:underline" href={it.url} target="_blank" rel="noreferrer">
                            <span className="text-lg">📄</span>
                            <span className="truncate">{it.name}</span>
                          </a>
                        ) : (
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-lg">📄</span>
                            <span className="truncate">{it.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                          {it.kind === "folder" ? "フォルダ" : "ファイル"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(it)}
                          disabled={busy}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:bg-red-100/60"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </AppShell>
  );
}

