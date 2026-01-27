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
  settings: boolean;
  wiki: boolean;
  effort: boolean;
  calendar: boolean;
};

const DEFAULT_MENU_PERMISSIONS: MenuPermissions = {
  dashboard: true,
  members: false,
  projects: true,
  issues: true,
  customers: false,
  files: true,
  billing: false,
  settings: false,
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

        // オーナーかどうか確認
        const compSnap = await getDoc(doc(db, "companies", companyCode));
        if (compSnap.exists()) {
          const c = compSnap.data() as any;
          const ownerUid = c.ownerUid || "";
          
          // オーナーは全権限
          if (ownerUid === u.uid) {
            setHasPermission(true);
            setLoading(false);
            return;
          }
        }

        // メンバーの権限を取得
        const membershipId = `${companyCode}_${u.uid}`;
        const msSnap = await getDoc(doc(db, "workspaceMemberships", membershipId));
        
        if (msSnap.exists()) {
          const ms = msSnap.data() as any;
          const p = ms.permissions || {};
          const permitted = p[requiredPermission] ?? DEFAULT_MENU_PERMISSIONS[requiredPermission];
          setHasPermission(permitted);
          
          if (!permitted) {
            router.push("/");
          }
        } else {
          // membershipがない場合はデフォルト権限を使用
          const permitted = DEFAULT_MENU_PERMISSIONS[requiredPermission];
          setHasPermission(permitted);
          
          if (!permitted) {
            router.push("/");
          }
        }
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
