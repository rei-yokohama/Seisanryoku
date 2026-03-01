import type { Timestamp } from "firebase/firestore";
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Issue } from "./backlog";

export type PropertyType = "select";

export type Property = {
  id: string;
  companyCode: string;
  name: string;
  key: string;
  type: PropertyType;
  options: string[];
  isSystem: boolean;
  sortOrder: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export const SYSTEM_PROPERTIES: Omit<Property, "id" | "companyCode" | "createdAt" | "updatedAt">[] = [
  {
    name: "課題カテゴリ",
    key: "category",
    type: "select",
    options: ["バグ", "機能追加", "改善", "タスク", "質問"],
    isSystem: true,
    sortOrder: 0,
  },
  {
    name: "案件カテゴリ",
    key: "dealCategory",
    type: "select",
    options: ["開発", "保守", "コンサルティング", "デザイン"],
    isSystem: true,
    sortOrder: 1,
  },
  {
    name: "課題の状態",
    key: "issueStatus",
    type: "select",
    options: ["未対応", "対応中", "完了"],
    isSystem: true,
    sortOrder: 2,
  },
];

/**
 * companyCode のプロパティを取得。システムプロパティが存在しなければシードする。
 */
export async function ensureProperties(companyCode: string): Promise<Property[]> {
  const snap = await getDocs(
    query(collection(db, "properties"), where("companyCode", "==", companyCode))
  );
  const existing = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Property));

  const missing = SYSTEM_PROPERTIES.filter(
    (sp) => !existing.some((e) => e.key === sp.key)
  );

  // システムプロパティの名前を定義と同期
  for (const sp of SYSTEM_PROPERTIES) {
    const match = existing.find((e) => e.key === sp.key);
    if (match && match.name !== sp.name) {
      await updateDoc(doc(db, "properties", match.id), { name: sp.name });
      match.name = sp.name;
    }
  }

  for (const sp of missing) {
    const ref = doc(collection(db, "properties"));
    const now = new Date();
    const prop: Omit<Property, "id"> = {
      companyCode,
      name: sp.name,
      key: sp.key,
      type: sp.type,
      options: sp.options,
      isSystem: sp.isSystem,
      sortOrder: sp.sortOrder,
      createdAt: { toDate: () => now } as unknown as Timestamp,
      updatedAt: { toDate: () => now } as unknown as Timestamp,
    };
    await setDoc(ref, {
      ...prop,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    existing.push({ ...prop, id: ref.id } as Property);
  }

  return existing.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Issue からカテゴリ値を取得。propertyValues.category → labels[0] フォールバック
 */
export function getCategoryValue(issue: Issue): string {
  const pv = (issue as any).propertyValues as Record<string, string> | undefined;
  if (pv?.category) return pv.category;
  return issue.labels && issue.labels[0] ? String(issue.labels[0]) : "";
}

/** 旧 enum → ラベル変換マップ（後方互換） */
const STATUS_ENUM_TO_LABEL: Record<string, string> = {
  TODO: "未対応",
  IN_PROGRESS: "対応中",
  DONE: "完了",
};

const STATUS_LABEL_TO_ENUM: Record<string, string> = {
  "未対応": "TODO",
  "対応中": "IN_PROGRESS",
  "完了": "DONE",
};

/**
 * DB に保存された status 値を表示ラベルに変換。
 * 旧 enum（TODO 等）はラベルに変換し、それ以外はそのまま返す。
 */
export function statusToLabel(status: string): string {
  return STATUS_ENUM_TO_LABEL[status] || status;
}

/**
 * 表示ラベルを DB 保存用の値に変換。
 * 既知のラベルは旧 enum に戻し、カスタムはラベルそのまま保存。
 */
export function statusToValue(label: string): string {
  return STATUS_LABEL_TO_ENUM[label] || label;
}

/** ステータスラベルに対応する色クラス */
export function statusColor(label: string): string {
  const v = STATUS_LABEL_TO_ENUM[label] || label;
  if (v === "DONE" || v === "完了") return "bg-orange-100 text-orange-700";
  if (v === "IN_PROGRESS" || v === "対応中") return "bg-sky-100 text-sky-700";
  if (v === "TODO" || v === "未対応") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}
