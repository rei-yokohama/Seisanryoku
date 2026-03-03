import type { Timestamp } from "firebase/firestore";

// ---------- Types ----------

export type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

export type Customer = {
  id: string;
  name: string;
  isActive?: boolean | null;
  inactivatedAt?: Timestamp | null;
  contactName?: string | null;
  address?: string | null;
  assigneeUid?: string | null;
  assigneeUids?: string[] | null;
};

export type IssuerProfile = {
  id: string;
  name: string;
  companyName: string;
  corporateNumber?: string;
  postalCode?: string;
  address?: string;
  tel?: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  isDefault?: boolean;
};

export type Employee = {
  id: string;
  name: string;
  authUid?: string;
};

export type BillingStatus = "none" | "created" | "confirmed" | "sent" | "no_invoice";

export type BillingRecord = {
  id: string;
  companyCode: string;
  customerId: string;
  assigneeUid?: string;
  month: string; // YYYY-MM
  status: BillingStatus;
  amount?: number | null;
  notes?: string | null;
  pdfGeneratedAt?: Timestamp | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  updatedBy?: string;
  // 拡張フィールド（オプショナル、後方互換）
  taxType?: "included" | "excluded";
  issuerProfileId?: string;
  invoiceNumber?: string;
  issueDate?: string; // YYYY/MM/DD
  billingDate?: string; // 請求日 YYYY/MM/DD
  dueDate?: string; // 支払い期限 YYYY/MM/DD
  itemName?: string; // 項目
  itemDescription?: string; // 内容
  customerName?: string;
  assigneeName?: string;
};

// ---------- Constants ----------

export const STATUS_OPTIONS: BillingStatus[] = ["none", "created", "confirmed", "sent", "no_invoice"];

// ---------- Helpers ----------

export function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function statusLabel(s: BillingStatus): string {
  switch (s) {
    case "created": return "作成済";
    case "confirmed": return "確認済";
    case "sent": return "送付済";
    case "no_invoice": return "請求なし";
    default: return "未着手";
  }
}

export function statusColor(s: BillingStatus): string {
  switch (s) {
    case "created": return "bg-amber-100 text-amber-800";
    case "confirmed": return "bg-blue-100 text-blue-800";
    case "sent": return "bg-emerald-100 text-emerald-800";
    case "no_invoice": return "bg-slate-100 text-slate-600";
    default: return "bg-slate-50 text-slate-400";
  }
}

export function yen(n: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
}

export function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function parseYM(key: string) {
  const [y, m] = key.split("-").map((v) => Number(v));
  return { y: y || new Date().getFullYear(), m: m || new Date().getMonth() + 1 };
}

export function addMonths(key: string, delta: number) {
  const { y, m } = parseYM(key);
  return ymKey(new Date(y, (m - 1) + delta, 1));
}

export function labelYM(key: string) {
  const { m } = parseYM(key);
  const nextM = m === 12 ? 1 : m + 1;
  return `${m}月度（${nextM}月末お振込）`;
}

export function makeBillingKey(companyCode: string, customerId: string, assigneeUid: string, m: string) {
  if (assigneeUid) return `${companyCode}_${customerId}_${assigneeUid}_${m}`;
  return `${companyCode}_${customerId}_${m}`;
}

export function getCustomerAssignees(c: Customer): string[] {
  if (Array.isArray(c.assigneeUids) && c.assigneeUids.length > 0) return c.assigneeUids.filter(Boolean) as string[];
  return c.assigneeUid ? [c.assigneeUid] : [];
}

export function generateInvoiceNumber(month: string, suffix: string): string {
  return `INV-${month.replace("-", "")}-${suffix.toUpperCase()}`;
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
