import { NextRequest, NextResponse } from "next/server";

type ServiceSettings = {
  enabled?: boolean;
  webhookUrl?: string;
  apiToken?: string;
  roomId?: string;
};

type IssuePayload = {
  issueKey: string;
  title: string;
  statusLabel: string;
  priorityLabel: string;
  assigneeName?: string;
  reporterName?: string;
  projectName?: string;
  link?: string;
};

async function sendDiscord(url: string, issue: IssuePayload) {
  const fullLink = issue.link ? `https://crm.sof10.net${issue.link}` : "";
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: `📋 ${issue.issueKey} ${issue.title}`,
          url: fullLink || undefined,
          color: 0xf97316,
          fields: [
            { name: "状態", value: issue.statusLabel, inline: true },
            { name: "優先度", value: issue.priorityLabel, inline: true },
            ...(issue.assigneeName
              ? [{ name: "担当", value: issue.assigneeName, inline: true }]
              : []),
            ...(issue.projectName
              ? [{ name: "案件", value: issue.projectName, inline: true }]
              : []),
          ],
        },
      ],
    }),
  });
}

async function sendSlack(url: string, issue: IssuePayload) {
  const fullLink = issue.link ? `https://crm.sof10.net${issue.link}` : "";
  const titleText = fullLink
    ? `<${fullLink}|${issue.issueKey} ${issue.title}>`
    : `${issue.issueKey} ${issue.title}`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `📋 課題が作成されました`, emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: titleText },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*状態:* ${issue.statusLabel}` },
            { type: "mrkdwn", text: `*優先度:* ${issue.priorityLabel}` },
            ...(issue.assigneeName
              ? [{ type: "mrkdwn" as const, text: `*担当:* ${issue.assigneeName}` }]
              : []),
            ...(issue.projectName
              ? [{ type: "mrkdwn" as const, text: `*案件:* ${issue.projectName}` }]
              : []),
          ],
        },
      ],
    }),
  });
}

async function sendChatwork(apiToken: string, roomId: string, issue: IssuePayload) {
  const fullLink = issue.link ? `https://crm.sof10.net${issue.link}` : "";
  const body = [
    `[info][title]📋 課題が作成されました: ${issue.issueKey}[/title]`,
    `件名: ${issue.title}`,
    `状態: ${issue.statusLabel}`,
    `優先度: ${issue.priorityLabel}`,
    ...(issue.assigneeName ? [`担当: ${issue.assigneeName}`] : []),
    ...(issue.projectName ? [`案件: ${issue.projectName}`] : []),
    ...(fullLink ? [`${fullLink}`] : []),
    `[/info]`,
  ].join("\n");

  await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": apiToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `body=${encodeURIComponent(body)}`,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { settings, issue } = (await request.json()) as {
      settings: { discord?: ServiceSettings; slack?: ServiceSettings; chatwork?: ServiceSettings };
      issue: IssuePayload;
    };

    if (!issue?.issueKey) {
      return NextResponse.json({ error: "issue data is required" }, { status: 400 });
    }

    const results: { service: string; ok: boolean; error?: string }[] = [];

    if (settings.discord?.enabled && settings.discord.webhookUrl) {
      try {
        await sendDiscord(settings.discord.webhookUrl, issue);
        results.push({ service: "discord", ok: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown error";
        results.push({ service: "discord", ok: false, error: msg });
      }
    }

    if (settings.slack?.enabled && settings.slack.webhookUrl) {
      try {
        await sendSlack(settings.slack.webhookUrl, issue);
        results.push({ service: "slack", ok: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown error";
        results.push({ service: "slack", ok: false, error: msg });
      }
    }

    if (settings.chatwork?.enabled && settings.chatwork.apiToken && settings.chatwork.roomId) {
      try {
        await sendChatwork(settings.chatwork.apiToken, settings.chatwork.roomId, issue);
        results.push({ service: "chatwork", ok: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown error";
        results.push({ service: "chatwork", ok: false, error: msg });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    const err = error as { message?: string };
    return NextResponse.json({ error: err.message || "webhook送信に失敗しました" }, { status: 500 });
  }
}
