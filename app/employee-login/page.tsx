"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmployeeLoginRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-2xl font-bold text-orange-900">リダイレクト中...</div>
    </div>
  );
}
