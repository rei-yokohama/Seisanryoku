import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

export type DataVisibilityPermissions = {
  viewOthersData: boolean;
  viewScope: "all" | "specific_members" | "specific_groups" | "specific_employment_types";
  allowedMemberUids: string[];
  allowedGroupIds: string[];
  allowedEmploymentTypes: string[];
};

/** 権限未設定時のデフォルト（自分のデータのみ閲覧可能） */
export const DEFAULT_DATA_VISIBILITY: DataVisibilityPermissions = {
  viewOthersData: false,
  viewScope: "all",
  allowedMemberUids: [],
  allowedGroupIds: [],
  allowedEmploymentTypes: [],
};

export type Group = {
  id: string;
  name: string;
  companyCode: string;
  memberUids: string[];
  createdAt?: any;
  updatedAt?: any;
};

/**
 * 閲覧可能な UID のセットを解決する。
 * オーナーは常に全員閲覧可能（呼び出し側で判定）。
 */
export async function resolveVisibleUids(
  currentUid: string,
  companyCode: string,
  perms: DataVisibilityPermissions,
): Promise<Set<string>> {
  // 他メンバーのデータを閲覧不可 → 自分のみ
  if (!perms.viewOthersData) {
    return new Set([currentUid]);
  }

  // 全員閲覧可
  if (perms.viewScope === "all") {
    return new Set(); // 空セット = フィルタなし（全員）
  }

  const allowed = new Set<string>();
  allowed.add(currentUid); // 自分は常に含む

  if (perms.viewScope === "specific_members") {
    for (const uid of perms.allowedMemberUids) {
      allowed.add(uid);
    }
  }

  if (perms.viewScope === "specific_employment_types") {
    // 雇用形態ベースの閲覧制限
    try {
      const snap = await getDocs(
        query(collection(db, "employees"), where("companyCode", "==", companyCode)),
      );
      for (const d of snap.docs) {
        const emp = d.data() as any;
        if (emp.authUid && perms.allowedEmploymentTypes.includes(emp.employmentType)) {
          allowed.add(emp.authUid);
        }
      }
    } catch {
      // 取得失敗時は無視
    }
  }

  if (perms.viewScope === "specific_groups") {
    // グループのメンバーを取得
    for (const gid of perms.allowedGroupIds) {
      try {
        const snap = await getDocs(
          query(
            collection(db, "groups"),
            where("companyCode", "==", companyCode),
          ),
        );
        for (const d of snap.docs) {
          if (d.id === gid) {
            const data = d.data() as Group;
            for (const uid of data.memberUids || []) {
              allowed.add(uid);
            }
          }
        }
      } catch {
        // グループ取得失敗時は無視
      }
    }
  }

  return allowed;
}

/**
 * アイテム配列を閲覧可能 UID でフィルタする。
 * visibleUids が空セットの場合は「全員閲覧可」としてフィルタなし。
 * @param includeUnassigned マネージャー（雇用形態ベース閲覧）の場合 true。担当者未設定のものも表示する。
 */
export function filterByVisibleUids<T>(
  items: T[],
  getAssigneeUids: (item: T) => string[],
  visibleUids: Set<string>,
  includeUnassigned = false,
): T[] {
  // 空セット = フィルタなし（全員閲覧可）
  if (visibleUids.size === 0) return items;

  return items.filter((item) => {
    const uids = getAssigneeUids(item);
    // 担当者未設定: マネージャーの場合は表示、それ以外は非表示
    if (uids.length === 0) return includeUnassigned;
    // 担当者のいずれかが閲覧可能なら表示
    return uids.some((uid) => visibleUids.has(uid));
  });
}

/**
 * workspaceMemberships から DataVisibilityPermissions を読み取るヘルパー。
 */
export function parseDataVisibility(
  raw: any,
  fieldName: string,
): DataVisibilityPermissions {
  const p = raw?.[fieldName] || {};
  return {
    viewOthersData: p.viewOthersData ?? DEFAULT_DATA_VISIBILITY.viewOthersData,
    viewScope: p.viewScope ?? DEFAULT_DATA_VISIBILITY.viewScope,
    allowedMemberUids: Array.isArray(p.allowedMemberUids) ? p.allowedMemberUids : [],
    allowedGroupIds: Array.isArray(p.allowedGroupIds) ? p.allowedGroupIds : [],
    allowedEmploymentTypes: Array.isArray(p.allowedEmploymentTypes) ? p.allowedEmploymentTypes : [],
  };
}
