"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ProjectIssueEditRedirect() {
  const router = useRouter();
  const params = useParams<{ issueId: string }>();
  
  useEffect(() => {
    if (params.issueId) {
      router.replace(`/issue/${params.issueId}/edit`);
    }
  }, [router, params.issueId]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-sm font-bold text-slate-600 animate-pulse">リダイレクト中...</div>
    </div>
  );
}
