 "use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { ensureProfile } from "../../../../lib/ensureProfile";
import type { Project } from "../../../../lib/backlog";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
};

export default function ProjectGanttPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
      if (!prof) {
        setLoading(false);
        router.push("/login");
        return;
      }
      setProfile(prof);

      try {
        const pSnap = await getDoc(doc(db, "projects", projectId));
        if (pSnap.exists()) {
          setProject({ ...(pSnap.data() as Project), id: projectId });
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [projectId, router]);

  if (loading) {
    return (
      <AppShell title="ガントチャート" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title={`${project?.key || ""} ${project?.name || ""}`.trim() || "ガントチャート"}
      subtitle="ガントチャート"
      projectId={projectId}
    >
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="text-lg font-extrabold text-slate-900">ガントチャート</div>
        <div className="mt-2 text-sm text-slate-600">
          この画面は準備中です（まずは“クリックして遷移できる”状態を優先しています）。
        </div>
      </div>
    </AppShell>
  );
}


