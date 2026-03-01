"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { AppShell } from "../../AppShell";
import type { Group } from "../../../lib/visibilityPermissions";

type MemberProfile = {
  uid: string;
  companyCode: string;
};

type Company = {
  ownerUid: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  isActive?: boolean | null;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function GroupsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [groups, setGroups] = useState<Group[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // 作成/編集モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupName, setGroupName] = useState("");
  const [selectedMemberUids, setSelectedMemberUids] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 削除確認
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }
      try {
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (!profSnap.exists()) {
          router.push("/login");
          return;
        }
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        if (prof.companyCode) {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          if (compSnap.exists()) {
            setIsOwner((compSnap.data() as Company).ownerUid === u.uid);
          }

          // グループ取得
          const gSnap = await getDocs(
            query(collection(db, "groups"), where("companyCode", "==", prof.companyCode)),
          );
          setGroups(gSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Group)));

          // 社員取得
          const eSnap = await getDocs(
            query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)),
          );
          setEmployees(eSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const openCreate = () => {
    setEditingGroup(null);
    setGroupName("");
    setSelectedMemberUids([]);
    setModalOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditingGroup(g);
    setGroupName(g.name);
    setSelectedMemberUids([...g.memberUids]);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.companyCode) return;
    const name = groupName.trim();
    if (!name) {
      setError("グループ名を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (editingGroup) {
        await updateDoc(doc(db, "groups", editingGroup.id), {
          name,
          memberUids: selectedMemberUids,
          updatedAt: Timestamp.now(),
        });
        setGroups((prev) =>
          prev.map((g) =>
            g.id === editingGroup.id ? { ...g, name, memberUids: selectedMemberUids } : g,
          ),
        );
        setSuccess("グループを更新しました");
      } else {
        const ref = await addDoc(collection(db, "groups"), {
          name,
          companyCode: profile.companyCode,
          memberUids: selectedMemberUids,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        setGroups((prev) => [
          ...prev,
          {
            id: ref.id,
            name,
            companyCode: profile.companyCode,
            memberUids: selectedMemberUids,
          },
        ]);
        setSuccess("グループを作成しました");
      }
      setModalOpen(false);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, "groups", deleteTarget.id));
      setGroups((prev) => prev.filter((g) => g.id !== deleteTarget.id));
      setSuccess("グループを削除しました");
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "削除に失敗しました");
    }
  };

  const toggleMember = (uid: string) => {
    setSelectedMemberUids((prev) =>
      prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid],
    );
  };

  const employeeNameByUid = (uid: string) => {
    return employees.find((e) => e.authUid === uid)?.name || uid;
  };

  if (loading) {
    return (
      <AppShell title="グループ管理" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="グループ管理" subtitle="Groups">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-900">グループ管理</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              ← 設定に戻る
            </Link>
            {isOwner && (
              <button
                onClick={openCreate}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 transition"
              >
                グループを作成
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
            {success}
          </div>
        )}

        {groups.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <div className="text-sm font-bold text-slate-500">グループがまだありません</div>
            {isOwner && (
              <div className="mt-2 text-xs text-slate-400">
                「グループを作成」ボタンからメンバーのグループを作成できます
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div
                key={g.id}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">{g.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {g.memberUids.length}名のメンバー
                    </div>
                  </div>
                  {isOwner && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(g)}
                        className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => setDeleteTarget(g)}
                        className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
                {g.memberUids.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {g.memberUids.map((uid) => (
                      <span
                        key={uid}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700"
                      >
                        {employeeNameByUid(uid)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 作成/編集モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-sm font-extrabold text-slate-900">
              {editingGroup ? "グループを編集" : "グループを作成"}
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-extrabold text-slate-500">グループ名</div>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  placeholder="例: 営業チーム"
                />
              </div>
              <div>
                <div className="text-xs font-extrabold text-slate-500">メンバー</div>
                <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                  {employees
                    .filter((e) => e.isActive !== false && !!e.authUid)
                    .map((e) => (
                      <label
                        key={e.id}
                        className={clsx(
                          "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition",
                          selectedMemberUids.includes(e.authUid!)
                            ? "border-orange-200 bg-orange-50"
                            : "border-slate-200 bg-white hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedMemberUids.includes(e.authUid!)}
                          onChange={() => toggleMember(e.authUid!)}
                          className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="text-xs font-bold text-slate-800">{e.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className={clsx(
                  "rounded-lg px-4 py-2 text-sm font-extrabold text-white transition",
                  saving ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700",
                )}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-sm font-extrabold text-slate-900">グループを削除</div>
            <div className="mt-2 text-xs text-slate-600">
              「{deleteTarget.name}」を削除してよろしいですか？この操作は元に戻せません。
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-700 transition"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
