import { addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

export type ActivityType =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "ISSUE_CREATED"
  | "ISSUE_UPDATED"
  | "ISSUE_DELETED"
  | "COMMENT_ADDED"
  | "WIKI_CREATED"
  | "WIKI_UPDATED"
  | "WIKI_DELETED"
  | "FILE_ADDED"
  | "FILE_DELETED"
  | "ASSIGNEE_CHANGED"
  | "CUSTOMER_CREATED"
  | "CUSTOMER_UPDATED"
  | "DEAL_CREATED"
  | "DEAL_UPDATED"
  | "CALENDAR_EVENT_CREATED";

export type Activity = {
  companyCode: string;
  actorUid: string;
  type: ActivityType;
  projectId?: string | null;
  issueId?: string | null;
  entityId?: string | null;
  customerId?: string | null;
  dealId?: string | null;
  message: string;
  link?: string | null;
  createdAt?: Timestamp;
};

export type NotificationType = "ASSIGNED" | "MENTION" | "SYSTEM";

export type Notification = {
  companyCode: string;
  recipientUid: string;
  actorUid?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  read: boolean;
  createdAt?: Timestamp;
};

export async function logActivity(input: Omit<Activity, "createdAt">) {
  try {
    await addDoc(collection(db, "activity"), { ...input, createdAt: Timestamp.now() });
  } catch (e) {
    // activityは失敗しても主要機能を止めない
    console.warn("logActivity failed:", e);
  }
}

export async function pushNotification(input: Omit<Notification, "createdAt" | "read">) {
  try {
    await addDoc(collection(db, "notifications"), {
      ...input,
      read: false,
      createdAt: Timestamp.now(),
    });
  } catch (e) {
    console.warn("pushNotification failed:", e);
  }
}


