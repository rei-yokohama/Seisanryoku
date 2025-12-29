 "use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import type { Project } from "../../../../lib/backlog";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
};

export default function ProjectDocumentsPage() {
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

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profSnap.exists()) {
        setLoading(false);
        router.push("/login");
        return;
      }
      setProfile(profSnap.data() as MemberProfile);

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
      <AppShell title="ドキュメント" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title={`${project?.key || ""} ${project?.name || ""}`.trim() || "ドキュメント"}
      subtitle="ドキュメント"
      projectId={projectId}
    >
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-extrabold text-slate-900">ドキュメント</div>
            <div className="mt-2 text-sm text-slate-600">
              この画面は準備中です（Wiki統合をやめて、専用ページとして表示します）。
            </div>
          </div>
          <Link
            href={`/projects/new?projectId=${encodeURIComponent(projectId)}`}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-700"
          >
            課題の追加
          </Link>
        </div>
      </div>
    </AppShell>
  );
}


