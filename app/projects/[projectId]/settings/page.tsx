"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, getDocs, query, updateDoc, collection, where, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import type { Project } from "../../../../lib/backlog";
import { logActivity } from "../../../../lib/activity";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ProjectSettingsPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [project, setProject] = useState<Project | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberUids, setMemberUids] = useState<Set<string>>(new Set());

  const memberCount = useMemo(() => memberUids.size, [memberUids]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profSnap.exists()) {
        setLoading(false);
        router.push("/login");
        return;
      }
      const prof = profSnap.data() as MemberProfile;
      setProfile(prof);

      try {
        const pSnap = await getDoc(doc(db, "projects", projectId));
        if (!pSnap.exists()) {
          setLoading(false);
          router.push("/projects");
          return;
        }
        const p = { ...(pSnap.data() as Project), id: projectId } as Project;
        setProject(p);
        setName(p.name || "");
        setDescription(p.description || "");
        setMemberUids(new Set(p.memberUids || []));

        // employees (company + createdBy fallback)
        const mergedEmp: Employee[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          mergedEmp.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        }
        const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
        mergedEmp.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        const byId = new Map<string, Employee>();
        for (const e of mergedEmp) byId.set(e.id, e);
        const items = Array.from(byId.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setEmployees(items);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, projectId]);

  const toggleMember = (uid: string) => {
    setMemberUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const save = async () => {
    if (!user || !profile || !project) return;
    setError("");
    const n = name.trim();
    if (!n) {
      setError("プロジェクト名を入力してください");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", projectId), {
        name: n,
        description: description.trim(),
        memberUids: Array.from(memberUids),
        updatedAt: Timestamp.now(),
      } as any);

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "PROJECT_UPDATED",
        projectId,
        entityId: projectId,
        message: `プロジェクト設定を更新: ${project.key} ${n}`,
        link: `/projects/${projectId}/settings`,
      });

      router.push(`/dashboard?projectId=${encodeURIComponent(projectId)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "保存に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="プロジェクト設定" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }
  if (!user || !profile || !project) return null;

  return (
    <AppShell 
      title={`${project.key} ${project.name}`.trim()}
      subtitle="プロジェクト設定"
      projectId={projectId}
      headerRight={
        <button
          onClick={save}
          disabled={saving}
          className={clsx(
            "rounded-md px-4 py-2 text-sm font-extrabold text-white",
            saving ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700",
          )}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-sm font-extrabold text-slate-900">基本情報</div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-xs font-extrabold text-slate-500">プロジェクトキー</div>
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-extrabold text-slate-800">
                  {project.key}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  ※キー変更は課題キーとの整合が崩れるのでMVPでは不可
                </div>
              </div>
              <div className="md:col-span-8">
                <div className="text-xs font-extrabold text-slate-500">プロジェクト名</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500"
                />
              </div>
              <div className="md:col-span-12">
                <div className="text-xs font-extrabold text-slate-500">説明</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 min-h-[120px] w-full rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-800 outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-extrabold text-slate-900">メンバー</div>
              <div className="text-xs font-extrabold text-slate-600">{memberCount} 人</div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                <input
                  type="checkbox"
                  checked={memberUids.has(user.uid)}
                  onChange={() => toggleMember(user.uid)}
                />
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-slate-900">自分</div>
                  <div className="truncate text-xs text-slate-600">{profile.email}</div>
                </div>
              </label>
              {employees
                .filter(e => !!e.authUid)
                .map(e => (
                  <label key={e.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                    <input
                      type="checkbox"
                      checked={memberUids.has(e.authUid!)}
                      onChange={() => toggleMember(e.authUid!)}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-slate-900">{e.name}</div>
                      <div className="truncate text-xs text-slate-600">{e.authUid}</div>
                    </div>
                  </label>
                ))}
            </div>
          </div>
    </AppShell>
  );
}

