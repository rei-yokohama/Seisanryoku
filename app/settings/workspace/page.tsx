"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { AppShell } from "../../AppShell";

type WorkspaceMembership = {
  uid: string;
  companyCode: string;
  role?: "owner" | "admin" | "member";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type WorkspaceCompany = {
  companyName?: string;
  ownerUid?: string;
};

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [workspaceCode, setWorkspaceCode] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [defaultWorkspaceCode, setDefaultWorkspaceCode] = useState("");
  const [availableWorkspaces, setAvailableWorkspaces] = useState<Array<{ code: string; name: string; role: string; isDefault?: boolean }>>([]);
  const [switchingCode, setSwitchingCode] = useState<string | null>(null);
  const [currentOwnerUid, setCurrentOwnerUid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const generateWorkspaceCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
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
        let activeCode = "";
        let activeName = "";
        let defaultCode = "";
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (profSnap.exists()) {
          const prof = profSnap.data() as any;
          let code = String(prof.companyCode || "");
          let name = String(prof.companyName || "");
          defaultCode = String(prof.defaultCompanyCode || "");
          activeCode = code;
          activeName = name;
          setWorkspaceCode(code);
          setWorkspaceName(name);
          setDefaultWorkspaceCode(defaultCode || code);

          // 旧アカウント互換: companyCode が空なら、最初のワークスペースを自動生成して紐づける
          if (!code) {
            const newCode = generateWorkspaceCode();
            await setDoc(
              doc(db, "companies", newCode),
              {
                companyName: "",
                ownerUid: u.uid,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
              },
              { merge: true },
            );
            await setDoc(
              doc(db, "workspaceMemberships", `${newCode}_${u.uid}`),
              {
                uid: u.uid,
                companyCode: newCode,
                role: "owner",
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
              },
              { merge: true },
            );
            await updateDoc(doc(db, "profiles", u.uid), {
              companyCode: newCode,
              companyName: "",
              defaultCompanyCode: newCode,
            });
            code = newCode;
            name = "";
            activeCode = newCode;
            activeName = "";
            defaultCode = newCode;
            setWorkspaceCode(newCode);
            setWorkspaceName("");
            setDefaultWorkspaceCode(newCode);
            setCurrentOwnerUid(u.uid);
          } else {
            // defaultCompanyCode が未設定なら、現在の companyCode をデフォルトとして保存
            if (!defaultCode) {
              defaultCode = code;
              setDefaultWorkspaceCode(code);
              await updateDoc(doc(db, "profiles", u.uid), { defaultCompanyCode: code });
            }
          }

          // 互換対応：既存ユーザーは workspaceMemberships が無い場合があるので、
          // 「現在選択中のワークスペース」の membership を自動で作成しておく。
          if (activeCode) {
            const memId = `${activeCode}_${u.uid}`;
            const memSnap = await getDoc(doc(db, "workspaceMemberships", memId));
            if (!memSnap.exists()) {
              await setDoc(
                doc(db, "workspaceMemberships", memId),
                {
                  uid: u.uid,
                  companyCode: activeCode,
                  role: "member",
                  createdAt: Timestamp.now(),
                  updatedAt: Timestamp.now(),
                },
                { merge: true },
              );
            }
          }

          // 互換対応：デフォルトワークスペースも membership が無い場合があるので作成
          if (defaultCode) {
            const defMemId = `${defaultCode}_${u.uid}`;
            const defMemSnap = await getDoc(doc(db, "workspaceMemberships", defMemId));
            if (!defMemSnap.exists()) {
              await setDoc(
                doc(db, "workspaceMemberships", defMemId),
                {
                  uid: u.uid,
                  companyCode: defaultCode,
                  role: "member",
                  createdAt: Timestamp.now(),
                  updatedAt: Timestamp.now(),
                },
                { merge: true },
              );
            }
          }

          if (activeCode) {
            const compSnap = await getDoc(doc(db, "companies", activeCode));
            if (compSnap.exists()) {
              const c = compSnap.data() as any;
              if (c.companyName) setWorkspaceName(String(c.companyName));
              setCurrentOwnerUid(String(c.ownerUid || ""));
            }
          }
        }

        // 所属ワークスペース一覧（切り替え用）
        const membershipsSnap = await getDocs(query(collection(db, "workspaceMemberships"), where("uid", "==", u.uid)));
        const memberships = membershipsSnap.docs.map((d) => d.data() as WorkspaceMembership);
        const membershipCodes = Array.from(new Set(memberships.map((m) => String(m.companyCode || "")).filter(Boolean)));

        const codes = Array.from(new Set([...membershipCodes, defaultCode, activeCode].filter(Boolean)));
        const companyDocs = await Promise.all(codes.map((c) => getDoc(doc(db, "companies", c))));
        const items = codes.map((c, idx) => {
          const comp = companyDocs[idx].exists() ? (companyDocs[idx].data() as WorkspaceCompany) : {};
          const role =
            memberships.find((m) => String(m.companyCode) === c)?.role ||
            (comp.ownerUid === u.uid ? "owner" : "member");
          const name = String(comp.companyName || (c === activeCode ? activeName : "") || "未入力");
          return {
            code: c,
            name,
            role,
            isDefault: !!defaultCode && c === defaultCode,
          };
        }).sort((a, b) => a.name.localeCompare(b.name));

        setAvailableWorkspaces(items);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const switchWorkspace = async (code: string) => {
    if (!user) return;
    if (!code || code === workspaceCode) return;
    setSwitchingCode(code);
    setError("");
    setSuccess("");
    try {
      // 所属チェック（任意の会社コードに切り替えられないように）
      const memSnap = await getDoc(doc(db, "workspaceMemberships", `${code}_${user.uid}`));
      if (!memSnap.exists()) {
        setError("このワークスペースへのアクセス権限がありません");
        return;
      }

      const compSnap = await getDoc(doc(db, "companies", code));
      if (!compSnap.exists()) {
        setError("指定したワークスペースが見つかりません");
        return;
      }
      const c = compSnap.data() as any;
      const name = String(c.companyName || code);
      await updateDoc(doc(db, "profiles", user.uid), {
        companyCode: code,
        companyName: name,
      });
      setWorkspaceCode(code);
      setWorkspaceName(name);
      setCurrentOwnerUid(String(c.ownerUid || ""));
      setSuccess("ワークスペースを切り替えました");
    } catch (e: any) {
      setError(e?.message || "切り替えに失敗しました");
    } finally {
      setSwitchingCode(null);
    }
  };

  const createWorkspace = async () => {
    if (!user) return;
    const name = newWorkspaceName.trim();
    if (!name) {
      setError("新規ワークスペース名を入力してください");
      setSuccess("");
      return;
    }

    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const code = generateWorkspaceCode();

      await setDoc(
        doc(db, "companies", code),
        {
          companyName: name,
          ownerUid: user.uid,
          updatedAt: Timestamp.now(),
          createdAt: Timestamp.now(),
        },
        { merge: true },
      );

      await setDoc(
        doc(db, "workspaceMemberships", `${code}_${user.uid}`),
        {
          uid: user.uid,
          companyCode: code,
          role: "owner",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      setNewWorkspaceName("");

      // 一覧をリロード
      const membershipsSnap = await getDocs(query(collection(db, "workspaceMemberships"), where("uid", "==", user.uid)));
      const memberships = membershipsSnap.docs.map((d) => d.data() as WorkspaceMembership);
      const codes = Array.from(new Set(memberships.map((m) => String(m.companyCode || "")).filter(Boolean)));
      const companyDocs = await Promise.all(codes.map((c) => getDoc(doc(db, "companies", c))));
      const items = codes
        .map((c, idx) => {
          const comp = companyDocs[idx].exists() ? (companyDocs[idx].data() as WorkspaceCompany) : {};
          const role =
            memberships.find((m) => String(m.companyCode) === c)?.role ||
            (comp.ownerUid === user.uid ? "owner" : "member");
          const displayName = String(comp.companyName || "未入力");
          const isDefault = !!defaultWorkspaceCode && c === defaultWorkspaceCode;
          return { code: c, name: displayName, role, isDefault };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setAvailableWorkspaces(items);

      setSuccess("新しいワークスペースを作成しました（切り替えは下の一覧から行えます）");
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    const name = workspaceName.trim();
    if (!name) {
      setError("ワークスペース名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      let code = workspaceCode.trim();
      if (!code) {
        code = generateWorkspaceCode();
        setWorkspaceCode(code);
      }

      // companies/{companyCode} をワークスペースとして扱う（データ構造はそのまま）
      await setDoc(
        doc(db, "companies", code),
        {
          companyName: name,
          ownerUid: user.uid,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      // profiles/{uid}
      await updateDoc(doc(db, "profiles", user.uid), {
        companyName: name,
        companyCode: code,
      });

      // membership を作成（owner）
      await setDoc(
        doc(db, "workspaceMemberships", `${code}_${user.uid}`),
        {
          uid: user.uid,
          companyCode: code,
          role: "owner",
          updatedAt: Timestamp.now(),
          createdAt: Timestamp.now(),
        },
        { merge: true },
      );

      setSuccess("ワークスペース情報を保存しました（ヘッダーの表示に反映されます）");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="ワークスペース設定"
      subtitle="ワークスペース名・ワークスペースコード"
      headerRight={
        <Link
          href="/settings"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← 設定トップ
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">新しいワークスペースを作成</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-8">
              <div className="text-xs font-extrabold text-slate-500">ワークスペース名 *</div>
              <input
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="例：採用代行事業、広告代理事業...etc"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div className="md:col-span-4 flex items-end">
              <button
                onClick={() => void createWorkspace()}
                disabled={!user || creating}
                className="w-full rounded-xl bg-orange-600 px-6 py-3 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
                type="button"
              >
                {creating ? "作成中..." : "作成する"}
              </button>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            ※ 作成するだけで切り替えません。切り替えは下の一覧から行えます。データはワークスペースごとに完全に分離されます。
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">ワークスペースの切り替え</div>
          {loading ? (
            <div className="text-sm font-bold text-slate-600">読み込み中...</div>
          ) : availableWorkspaces.length === 0 ? (
            <div className="text-sm text-slate-600">ワークスペースが見つかりませんでした。</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {availableWorkspaces.map((w) => {
                const active = w.code === workspaceCode;
                return (
                  <div key={w.code} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold text-slate-900">
                          {w.name}
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-500">
                          コード: {w.code} / 権限: {w.role}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {w.isDefault ? (
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
                            デフォルト
                          </span>
                        ) : null}
                        {active ? (
                          <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold text-orange-800">
                            選択中
                          </span>
                        ) : (
                          <button
                            onClick={() => void switchWorkspace(w.code)}
                            disabled={switchingCode === w.code}
                            className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
                            type="button"
                          >
                            {switchingCode === w.code ? "切替中..." : "切り替える"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-3 text-xs text-slate-500">
            ※ ワークスペースを切り替えると、課題/Wiki/ドライブ/顧客/案件などのデータは選択中ワークスペースのものだけが表示されます。
            デフォルトのワークスペースは削除できません。
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 text-lg font-extrabold text-slate-900">ワークスペース情報</div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? (
            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-700">
              {success}
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm font-bold text-slate-600">読み込み中...</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">ワークスペース名 *</div>
                <input
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：採用代行事業、広告代理事業...etc"
                  disabled={!!currentOwnerUid && currentOwnerUid !== user?.uid}
                />
                <div className="mt-1 text-xs text-slate-500">
                  右上の表示名に使われます（未入力の場合は「未入力」と表示されます）。
                  {currentOwnerUid && currentOwnerUid !== user?.uid ? "（このワークスペースは編集権限がありません）" : ""}
                </div>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">ワークスペースコード</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={workspaceCode}
                    onChange={(e) => setWorkspaceCode(e.target.value.toUpperCase())}
                    className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    placeholder="未設定（保存時に自動生成）"
                    disabled={!!workspaceCode}
                  />
                  {!workspaceCode ? (
                    <button
                      onClick={() => setWorkspaceCode(generateWorkspaceCode())}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      type="button"
                    >
                      生成
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-slate-500">チーム招待・チーム機能の識別に使います。作成後は変更不可。</div>
              </div>

              <div className="pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving || !user || (!!currentOwnerUid && currentOwnerUid !== user?.uid)}
                  className="rounded-xl bg-orange-500 px-6 py-3 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
                  type="button"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}


