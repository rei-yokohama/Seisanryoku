"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import type { Project } from "../../lib/backlog";
import { normalizeProjectKey } from "../../lib/backlog";
import { logActivity } from "../../lib/activity";
import { AppShell } from "../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Company = {
  code: string;
  name: string;
  ownerUid: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
};

export default function ProjectsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [selectedMemberUids, setSelectedMemberUids] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const router = useRouter();

  const isManager = useMemo(() => !!(user && company && company.ownerUid === user.uid), [user, company]);

  const loadEmployees = useCallback(async (uid: string, companyCode: string) => {
    const merged: Employee[] = [];
    if (companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", companyCode)));
      merged.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }
    const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", uid)));
    merged.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    const items = Array.from(byId.values());
    setEmployees(items);
    return items;
  }, []);

  const loadProjects = useCallback(async (uid: string, companyCode: string) => {
    const merged: Project[] = [];
    if (companyCode) {
      const snapByCompany = await getDocs(query(collection(db, "projects"), where("companyCode", "==", companyCode)));
      merged.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
    }
    // 会社コードが未設定だった過去データ救済として createdBy も併用
    const snapByCreator = await getDocs(query(collection(db, "projects"), where("createdBy", "==", uid)));
    merged.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
    const byId = new Map<string, Project>();
    for (const p of merged) byId.set(p.id, p);
    const items = Array.from(byId.values());
    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setProjects(items);
    return items;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (profSnap.exists()) {
        const prof = profSnap.data() as MemberProfile;
        setProfile(prof);

        if (prof.companyCode) {
          const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
          if (compSnap.exists()) {
            setCompany({ ...(compSnap.data() as Company), code: prof.companyCode });
          }
        }

        await Promise.all([
          loadProjects(u.uid, prof.companyCode),
          loadEmployees(u.uid, prof.companyCode),
        ]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [router, loadProjects, loadEmployees]);

  const visibleProjects = useMemo(() => {
    if (!user) return [];
    if (isManager) return projects;
    // 社員は memberUids に自分のuidが含まれるプロジェクトのみ
    return projects.filter(p => Array.isArray(p.memberUids) && p.memberUids.includes(user.uid));
  }, [projects, user, isManager]);

  const openCreate = () => {
    if (!user || !profile) return;
    setError("");
    setShowCreate(true);
    setCreateName("");
    setCreateKey("");
    setCreateDesc("");
    // デフォルト: 自分は必ずメンバー
    setSelectedMemberUids(new Set([user.uid]));
  };

  const toggleMember = (uid: string) => {
    setSelectedMemberUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      // 作成者は必ず残す
      if (user?.uid) next.add(user.uid);
      return next;
    });
  };

  const createProject = async () => {
    if (!user || !profile) return;
    setError("");
    const name = createName.trim();
    const key = normalizeProjectKey(createKey);
    if (!name) {
      setError("プロジェクト名を入力してください");
      return;
    }
    if (!key) {
      setError("キー(例: SEI)を入力してください");
      return;
    }
    if (!profile.companyCode) {
      setError("会社コードが未設定です。先に会社を作成/参加してください。");
      return;
    }

    const memberUids = Array.from(selectedMemberUids).filter(Boolean);
    const docRef = await addDoc(collection(db, "projects"), {
      companyCode: profile.companyCode,
      key,
      name,
      description: createDesc.trim(),
      memberUids,
      createdBy: user.uid,
      createdAt: Timestamp.now(),
      issueSeq: 0,
    });

    // 互換性のため、プロジェクトdocにidフィールドを持たせたい場合はmergeで保存
    await setDoc(doc(db, "projects", docRef.id), { id: docRef.id }, { merge: true });
    await logActivity({
      companyCode: profile.companyCode,
      actorUid: user.uid,
      type: "PROJECT_CREATED",
      projectId: docRef.id,
      entityId: docRef.id,
      message: `プロジェクトを作成: ${key} ${name}`,
      link: `/projects/${docRef.id}`,
    });

    setShowCreate(false);
    await loadProjects(user.uid, profile.companyCode);
  };

  if (loading) {
    return (
      <AppShell title="プロジェクト" subtitle="Projects">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-emerald-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell title="プロジェクト" subtitle="Projects">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-emerald-700">Backlog（案件・タスク管理）</div>
            <h1 className="text-3xl font-bold text-emerald-950">プロジェクト</h1>
            <div className="mt-1 text-xs text-emerald-700">
              会社: <span className="font-semibold text-emerald-900">{profile?.companyCode || "-"}</span>
              {company?.name ? <span className="ml-2 text-emerald-800">({company.name})</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/my/tasks"
              className="rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm transition hover:shadow"
            >
              自分のタスク
            </Link>
            <Link
              href={isManager ? "/dashboard" : "/employee-dashboard"}
              className="rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm transition hover:shadow"
            >
              ダッシュボードへ
            </Link>
            {isManager && (
              <button
                onClick={openCreate}
                className="rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950 shadow-lg transition hover:scale-[1.02]"
              >
                + プロジェクト作成
              </button>
            )}
          </div>
        </div>

        {visibleProjects.length === 0 ? (
          <div className="rounded-2xl border-2 border-emerald-200 bg-white p-8 text-emerald-800">
            <div className="text-lg font-bold text-emerald-950">プロジェクトがありません</div>
            <div className="mt-2 text-sm">
              {isManager ? "右上の「プロジェクト作成」から追加できます。" : "管理者があなたをプロジェクトに追加すると、ここに表示されます。"}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleProjects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group rounded-2xl border-2 border-emerald-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-bold text-emerald-700">{p.key}</div>
                    <div className="mt-1 text-xl font-bold text-emerald-950">{p.name}</div>
                    {p.description ? (
                      <div className="mt-2 line-clamp-2 text-sm text-emerald-800">{p.description}</div>
                    ) : (
                      <div className="mt-2 text-sm text-emerald-600">説明なし</div>
                    )}
                  </div>
                  <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900 transition group-hover:bg-emerald-200">
                    開く →
                  </div>
                </div>
                <div className="mt-4 text-xs text-emerald-700">
                  メンバー: <span className="font-semibold text-emerald-900">{Array.isArray(p.memberUids) ? p.memberUids.length : 0}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl border-2 border-emerald-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-emerald-700">新規プロジェクト</div>
                <div className="text-2xl font-bold text-emerald-950">プロジェクトを作成</div>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-900"
              >
                閉じる
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-bold text-emerald-900">プロジェクト名</div>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full rounded-xl border-2 border-emerald-200 px-4 py-3 text-emerald-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  placeholder="例: 受託開発A"
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-bold text-emerald-900">キー（例: SEI）</div>
                <input
                  value={createKey}
                  onChange={(e) => setCreateKey(e.target.value)}
                  className="w-full rounded-xl border-2 border-emerald-200 px-4 py-3 text-emerald-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  placeholder="例: SEI"
                />
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-bold text-emerald-900">説明</div>
                <textarea
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  className="h-24 w-full rounded-xl border-2 border-emerald-200 px-4 py-3 text-emerald-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  placeholder="プロジェクト概要（任意）"
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-sm font-bold text-emerald-900">メンバー（社員）</div>
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-2 text-xs text-emerald-700">
                  プロジェクトにアクセスできる人を選びます（あなたは自動で含まれます）。
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {employees
                    .filter((e) => !!e.authUid)
                    .map((e) => (
                      <label key={e.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedMemberUids.has(e.authUid || "")}
                          onChange={() => toggleMember(e.authUid || "")}
                          className="h-4 w-4"
                        />
                        <div className="text-sm font-semibold text-emerald-950">{e.name}</div>
                      </label>
                    ))}
                  {employees.filter((e) => !!e.authUid).length === 0 && (
                    <div className="text-sm text-emerald-700">
                      社員がいません（またはauthUidが未設定です）。後からプロジェクト詳細で調整できます。
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl border-2 border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900"
              >
                キャンセル
              </button>
              <button
                onClick={createProject}
                className="rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950 shadow-lg transition hover:scale-[1.02]"
              >
                作成
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}


