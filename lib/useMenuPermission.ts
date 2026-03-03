"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "./firebase";
import { ensureProfile } from "./ensureProfile";

type MenuPermissions = {
  dashboard: boolean;
  members: boolean;
  projects: boolean;
  issues: boolean;
  customers: boolean;
  files: boolean;
  billing: boolean;
  invoicing: boolean;
  settings: boolean;
  wiki: boolean;
  effort: boolean;
  calendar: boolean;
};

const DEFAULT_MENU_PERMISSIONS: MenuPermissions = {
  dashboard: true,
  members: true,
  projects: true,
  issues: true,
  customers: true,
  files: true,
  billing: true,
  invoicing: true,
  settings: true,
  wiki: true,
  effort: true,
  calendar: true,
};

export function useMenuPermission(requiredPermission: keyof MenuPermissions) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }

      try {
        const prof = await ensureProfile(u);
        const companyCode = (prof?.companyCode || "").trim();
        
        if (!companyCode) {
          setHasPermission(true); // companyCodeがない場合はデフォルト許可
          setLoading(false);
          return;
        }

        // 全ユーザーに同じ画面を表示
        setHasPermission(true);
      } catch (e) {
        console.warn("Permission check failed:", e);
        setHasPermission(true); // エラー時はデフォルト許可
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router, requiredPermission]);

  return { user, loading, hasPermission };
}
