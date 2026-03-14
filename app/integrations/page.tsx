"use client";

import { Suspense, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { AppShell } from "../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type ServiceSettings = {
  enabled: boolean;
  webhookUrl?: string;
  apiToken?: string;
  roomId?: string;
};

type WebhookSettings = {
  discord?: ServiceSettings;
  slack?: ServiceSettings;
  chatwork?: ServiceSettings;
};

const SERVICES = [
  {
    key: "discord" as const,
    name: "Discord",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
    color: "from-indigo-500 to-indigo-600",
    bgLight: "bg-indigo-50",
    textColor: "text-indigo-600",
    borderColor: "border-indigo-200",
    description: "Discordチャンネルに課題作成の通知を送信します。",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/...", type: "url" },
    ],
  },
  {
    key: "slack" as const,
    name: "Slack",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" />
      </svg>
    ),
    color: "from-green-500 to-emerald-600",
    bgLight: "bg-green-50",
    textColor: "text-green-600",
    borderColor: "border-green-200",
    description: "Slackチャンネルに課題作成の通知を送信します。",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/...", type: "url" },
    ],
  },
  {
    key: "chatwork" as const,
    name: "Chatwork",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2 4c0-1.1.9-2 2-2h16a2 2 0 012 2v12a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V4zm4 3h12v2H6V7zm0 4h8v2H6v-2z" />
      </svg>
    ),
    color: "from-red-500 to-rose-600",
    bgLight: "bg-red-50",
    textColor: "text-red-600",
    borderColor: "border-red-200",
    description: "Chatworkルームに課題作成の通知を送信します。",
    fields: [
      { key: "apiToken", label: "APIトークン", placeholder: "Chatwork APIトークン", type: "password" },
      { key: "roomId", label: "ルームID", placeholder: "例: 123456789", type: "text" },
    ],
  },
] as const;

function IntegrationsInner() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState("");
  const [expandedService, setExpandedService] = useState<string | null>(null);

  const [discord, setDiscord] = useState<ServiceSettings>({ enabled: false, webhookUrl: "" });
  const [slack, setSlack] = useState<ServiceSettings>({ enabled: false, webhookUrl: "" });
  const [chatwork, setChatwork] = useState<ServiceSettings>({ enabled: false, apiToken: "", roomId: "" });

  const settingsMap: Record<string, { get: ServiceSettings; set: (s: ServiceSettings) => void }> = {
    discord: { get: discord, set: setDiscord },
    slack: { get: slack, set: setSlack },
    chatwork: { get: chatwork, set: setChatwork },
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/login"); return; }
      setUser(u);
      try {
        const prof = await ensureProfile(u);
        if (!prof?.companyCode) { router.push("/login"); return; }
        setProfile(prof as MemberProfile);

        const whSnap = await getDoc(doc(db, "webhookSettings", prof.companyCode));
        if (whSnap.exists()) {
          const data = whSnap.data() as WebhookSettings;
          if (data.discord) setDiscord({ ...{ enabled: false, webhookUrl: "" }, ...data.discord });
          if (data.slack) setSlack({ ...{ enabled: false, webhookUrl: "" }, ...data.slack });
          if (data.chatwork) setChatwork({ ...{ enabled: false, apiToken: "", roomId: "" }, ...data.chatwork });
        }
      } catch (e) {
        console.warn("integrations load failed:", e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const handleSave = async () => {
    if (!profile?.companyCode) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await setDoc(doc(db, "webhookSettings", profile.companyCode), {
        companyCode: profile.companyCode,
        discord,
        slack,
        chatwork,
      });
      setSaveMsg("保存しました");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch {
      setSaveMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (service: "discord" | "slack" | "chatwork") => {
    setTestingService(service);
    setTestMsg("");
    try {
      const settings = settingsMap[service].get;
      const res = await fetch("/api/webhook-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, settings }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestMsg(`テスト送信しました`);
      } else {
        setTestMsg(`${data.error || "送信失敗"}`);
      }
    } catch {
      setTestMsg("送信に失敗しました");
    } finally {
      setTestingService(null);
      setTimeout(() => setTestMsg(""), 5000);
    }
  };

  const handleToggle = (key: string, enabled: boolean) => {
    const { set, get } = settingsMap[key];
    set({ ...get, enabled });
    if (enabled) setExpandedService(key);
  };

  const enabledCount = [discord, slack, chatwork].filter((s) => s.enabled).length;

  if (loading) {
    return (
      <AppShell title="アプリ連携" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-orange-500" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="アプリ連携" subtitle="外部サービスとの連携">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">アプリ連携</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            外部サービスと連携して、課題作成時に自動通知を送信します。
          </p>
        </div>

        {/* Status Summary */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${enabledCount > 0 ? "bg-green-100" : "bg-slate-100"}`}>
              <svg className={`h-5 w-5 ${enabledCount > 0 ? "text-green-600" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-6.364-6.364L4.5 8.25l4.5 4.5a4.5 4.5 0 006.364 0l1.757-1.757" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-900">
                {enabledCount > 0 ? `${enabledCount}件の連携が有効` : "連携なし"}
              </div>
              <div className="text-xs font-bold text-slate-500">
                {enabledCount > 0 ? "課題作成時に通知が送信されます" : "サービスを有効にして通知を設定してください"}
              </div>
            </div>
          </div>
        </div>

        {/* Service Cards */}
        {SERVICES.map((service) => {
          const s = settingsMap[service.key].get;
          const isExpanded = expandedService === service.key;

          return (
            <div
              key={service.key}
              className={`rounded-xl border bg-white transition-all ${s.enabled ? service.borderColor : "border-slate-200"}`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between p-5">
                <button
                  type="button"
                  onClick={() => setExpandedService(isExpanded ? null : service.key)}
                  className="flex flex-1 items-center gap-4 text-left"
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${s.enabled ? `bg-gradient-to-br ${service.color} text-white shadow-sm` : `${service.bgLight} ${service.textColor}`}`}>
                    {service.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">{service.name}</span>
                      {s.enabled && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-extrabold text-green-700">
                          接続済み
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs font-bold text-slate-500">{service.description}</div>
                  </div>
                </button>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => handleToggle(service.key, e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-orange-500 peer-checked:after:translate-x-full" />
                </label>
              </div>

              {/* Expanded Settings */}
              {isExpanded && s.enabled && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                  <div className="space-y-3">
                    {service.fields.map((field) => (
                      <div key={field.key}>
                        <div className="text-xs font-bold text-slate-600">{field.label}</div>
                        <input
                          type={field.type}
                          value={(s as Record<string, any>)[field.key] || ""}
                          onChange={(e) => {
                            const { set, get } = settingsMap[service.key];
                            set({ ...get, [field.key]: e.target.value });
                          }}
                          placeholder={field.placeholder}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-500"
                        />
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleTest(service.key)}
                        disabled={testingService === service.key}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {testingService === service.key ? "送信中..." : "テスト送信"}
                      </button>
                      {testMsg && testingService === null && expandedService === service.key && (
                        <span className="text-xs font-bold text-blue-600">{testMsg}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Collapsed but enabled: show brief info */}
              {!isExpanded && s.enabled && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedService(service.key)}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    設定を表示
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Notification Info */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
          <div className="flex gap-3">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <div>
              <div className="text-sm font-extrabold text-blue-900">通知タイミング</div>
              <div className="mt-1 text-xs font-bold text-blue-700 leading-relaxed">
                課題を新規作成したとき、有効になっているサービスに自動で通知が送信されます。
                通知には課題キー、件名、状態、優先度、担当者、案件名が含まれます。
              </div>
            </div>
          </div>
        </div>

        {/* Save Message */}
        {saveMsg && (
          <div className={`rounded-lg border px-4 py-2 text-sm font-bold ${saveMsg.includes("失敗") ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
            {saveMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            ダッシュボードに戻る
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`rounded-lg px-5 py-2.5 text-sm font-extrabold text-white shadow-sm ${saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700"}`}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-orange-500" />
        </div>
      }
    >
      <IntegrationsInner />
    </Suspense>
  );
}
