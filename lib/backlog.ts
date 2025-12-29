import type { Timestamp } from "firebase/firestore";

export type Project = {
  id: string;
  companyCode: string;
  key: string; // e.g. "SEI"
  name: string;
  description?: string;
  memberUids: string[]; // auth.uid of members who can access
  createdBy: string;
  createdAt?: Timestamp;
  issueSeq?: number; // incrementing number for issue keys
};

export type IssueStatus = "TODO" | "IN_PROGRESS" | "DONE";
export const ISSUE_STATUSES: { value: IssueStatus; label: string }[] = [
  { value: "TODO", label: "未対応" },
  { value: "IN_PROGRESS", label: "対応中" },
  { value: "DONE", label: "完了" },
];

export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export const ISSUE_PRIORITIES: { value: IssuePriority; label: string }[] = [
  { value: "LOW", label: "低" },
  { value: "MEDIUM", label: "中" },
  { value: "HIGH", label: "高" },
  { value: "URGENT", label: "緊急" },
];

export type Issue = {
  id: string;
  companyCode: string;
  projectId: string;
  issueKey: string; // e.g. "SEI-12"
  title: string;
  description?: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeUid?: string | null;
  reporterUid: string;
  labels?: string[];
  startDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  estimateMinutes?: number;
  parentIssueId?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type IssueComment = {
  id: string;
  companyCode: string;
  issueId: string;
  authorUid: string;
  body: string;
  createdAt?: Timestamp;
};

export type WikiPage = {
  id: string;
  companyCode: string;
  projectId: string;
  slug: string;
  title: string;
  body: string;
  updatedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type ProjectFile = {
  id: string;
  companyCode: string;
  projectId: string;
  name: string;
  url?: string | null; // for now, store URL. Later can be Firebase Storage URL.
  storagePath?: string | null;
  uploadedBy: string;
  createdAt?: Timestamp;
};

export const normalizeProjectKey = (key: string) =>
  key
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 10);

export const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
};


