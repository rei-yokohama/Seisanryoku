import { NextRequest, NextResponse } from "next/server";

type ServiceSettings = {
  enabled?: boolean;
  webhookUrl?: string;
  apiToken?: string;
  roomId?: string;
};

async function testDiscord(url: string) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: "✅ テスト通知",
          description: "生産力からのWebhook通知テストです。この通知が届いていれば設定は正常です。",
          color: 0x22c55e,
        },
      ],
    }),
  });
}

async function testSlack(url: string) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "✅ テスト通知", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "生産力からのWebhook通知テストです。この通知が届いていれば設定は正常です。",
          },
        },
      ],
    }),
  });
}

async function testChatwork(apiToken: string, roomId: string) {
  const body = [
    "[info][title]✅ テスト通知[/title]",
    "生産力からのWebhook通知テストです。この通知が届いていれば設定は正常です。",
    "[/info]",
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
    const { service, settings } = (await request.json()) as {
      service: "discord" | "slack" | "chatwork";
      settings: ServiceSettings;
    };

    if (!service || !settings) {
      return NextResponse.json({ error: "service and settings are required" }, { status: 400 });
    }

    if (service === "discord") {
      if (!settings.webhookUrl) {
        return NextResponse.json({ error: "Webhook URLが未入力です" }, { status: 400 });
      }
      await testDiscord(settings.webhookUrl);
    } else if (service === "slack") {
      if (!settings.webhookUrl) {
        return NextResponse.json({ error: "Webhook URLが未入力です" }, { status: 400 });
      }
      await testSlack(settings.webhookUrl);
    } else if (service === "chatwork") {
      if (!settings.apiToken || !settings.roomId) {
        return NextResponse.json({ error: "APIトークンとルームIDが必要です" }, { status: 400 });
      }
      await testChatwork(settings.apiToken, settings.roomId);
    } else {
      return NextResponse.json({ error: "不明なサービスです" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as { message?: string };
    return NextResponse.json({ error: err.message || "テスト送信に失敗しました" }, { status: 500 });
  }
}
