import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { ISSUE_STATUSES, ISSUE_PRIORITIES } from "./backlog";
import type { IssueStatus, IssuePriority } from "./backlog";

export type WebhookServiceSettings = {
  enabled: boolean;
  webhookUrl?: string;
  apiToken?: string;
  roomId?: string;
};

export type WebhookSettings = {
  discord?: WebhookServiceSettings;
  slack?: WebhookServiceSettings;
  chatwork?: WebhookServiceSettings;
};

export type IssueWebhookPayload = {
  issueKey: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeName?: string;
  reporterName?: string;
  projectName?: string;
  link?: string;
};

function statusLabel(value: IssueStatus): string {
  return ISSUE_STATUSES.find((s) => s.value === value)?.label ?? value;
}

function priorityLabel(value: IssuePriority): string {
  return ISSUE_PRIORITIES.find((p) => p.value === value)?.label ?? value;
}

export async function sendIssueWebhook(
  companyCode: string,
  payload: IssueWebhookPayload,
) {
  try {
    const snap = await getDoc(doc(db, "webhookSettings", companyCode));
    if (!snap.exists()) return;
    const settings = snap.data() as WebhookSettings;

    const hasEnabled =
      (settings.discord?.enabled && settings.discord.webhookUrl) ||
      (settings.slack?.enabled && settings.slack.webhookUrl) ||
      (settings.chatwork?.enabled && settings.chatwork.apiToken && settings.chatwork.roomId);
    if (!hasEnabled) return;

    const body = {
      settings,
      issue: {
        ...payload,
        statusLabel: statusLabel(payload.status),
        priorityLabel: priorityLabel(payload.priority),
      },
    };

    fetch("/api/send-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) => console.warn("sendIssueWebhook fetch failed:", e));
  } catch (e) {
    console.warn("sendIssueWebhook failed:", e);
  }
}
