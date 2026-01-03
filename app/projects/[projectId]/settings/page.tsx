"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, getDocs, query, updateDoc, deleteDoc, collection, where, Timestamp } from "firebase/firestore";
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
        // deals コレクションから案件を取得
        const pSnap = await getDoc(doc(db, "deals", projectId));
        if (!pSnap.exists()) {
          setLoading(false);
          router.push("/projects");
          return;
        }
        const dealData = pSnap.data();
        // deal を project として扱えるように変換
        const p = { 
          ...dealData,
          id: projectId,
          name: dealData.title || "無題",
          key: dealData.key || dealData.title?.slice(0, 5)?.toUpperCase() || "DEAL",
        } as Project;
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
      setError("案件名を入力してください");
      return;
    }
    setSaving(true);
    try {
      // deals コレクションを更新
      await updateDoc(doc(db, "deals", projectId), {
        title: n,
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
        message: `案件設定を更新: ${project.key} ${n}`,
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

  const deleteProject = async () => {
    if (!user || !profile || !project) return;
    
    const confirmed = confirm(
      `案件「${project.name}」を削除しますか？\n\nこの操作は取り消せません。\n- すべての課題\n- Wiki\n- ファイル\n- コメント\nなどの関連データも削除されます。`
    );
    
    if (!confirmed) return;

    setSaving(true);
    try {
      // 案件に関連するデータを削除
      if (profile.companyCode) {
        // 課題を削除
        const issuesSnap = await getDocs(
          query(
            collection(db, "issues"),
            where("companyCode", "==", profile.companyCode),
            where("projectId", "==", projectId)
          )
        );
        for (const issueDoc of issuesSnap.docs) {
          await deleteDoc(doc(db, "issues", issueDoc.id));
        }

        // Wikiを削除
        const wikiSnap = await getDocs(
          query(
            collection(db, "wikiPages"),
            where("companyCode", "==", profile.companyCode),
            where("projectId", "==", projectId)
          )
        );
        for (const wikiDoc of wikiSnap.docs) {
          await deleteDoc(doc(db, "wikiPages", wikiDoc.id));
        }

        // ファイルを削除
        const filesSnap = await getDocs(
          query(
            collection(db, "projectFiles"),
            where("companyCode", "==", profile.companyCode),
            where("projectId", "==", projectId)
          )
        );
        for (const fileDoc of filesSnap.docs) {
          await deleteDoc(doc(db, "projectFiles", fileDoc.id));
        }
      }

      // 案件本体を削除（deals コレクション）
      await deleteDoc(doc(db, "deals", projectId));

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "PROJECT_DELETED",
        message: `案件を削除しました: ${project.key} ${project.name}`,
        link: "/projects",
      });

      router.push("/projects");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "削除に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="案件設定" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }
  if (!user || !profile || !project) return null;

  return (
    <AppShell 
      title={project.name}
      subtitle="案件設定"
      projectId={projectId}
      headerRight={
        <button
          onClick={save}
          disabled={saving}
          className={clsx(
            "rounded-md px-4 py-2 text-sm font-extrabold text-white",
            saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700",
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
                <div className="text-xs font-extrabold text-slate-500">案件キー</div>
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-extrabold text-slate-800">
                  {project.key}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  ※キー変更は課題キーとの整合が崩れるのでMVPでは不可
                </div>
              </div>
              <div className="md:col-span-8">
                <div className="text-xs font-extrabold text-slate-500">案件名</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-orange-500"
                />
              </div>
              <div className="md:col-span-12">
                <div className="text-xs font-extrabold text-slate-500">説明</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 min-h-[120px] w-full rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-800 outline-none focus:border-orange-500"
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

          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-5">
            <div className="text-sm font-extrabold text-red-900">危険な操作</div>
            <div className="mt-2 text-xs text-red-700">
              案件を削除すると、すべての課題、Wiki、ファイル、コメントなどの関連データが完全に削除されます。この操作は取り消せません。
            </div>
            <div className="mt-4">
              <button
                onClick={deleteProject}
                disabled={saving}
                className={clsx(
                  "rounded-md px-4 py-2 text-sm font-extrabold text-white",
                  saving ? "bg-red-400" : "bg-red-600 hover:bg-red-700",
                )}
              >
                {saving ? "削除中..." : "案件を削除"}
              </button>
            </div>
          </div>
    </AppShell>
  );
}

