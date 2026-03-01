"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import { AppShell } from "../../AppShell";

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

export default function WebhookSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState("");

  const [discord, setDiscord] = useState<ServiceSettings>({ enabled: false, webhookUrl: "" });
  const [slack, setSlack] = useState<ServiceSettings>({ enabled: false, webhookUrl: "" });
  const [chatwork, setChatwork] = useState<ServiceSettings>({ enabled: false, apiToken: "", roomId: "" });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/login"); return; }
      setUser(u);
      try {
        const prof = await ensureProfile(u);
        if (!prof?.companyCode) { router.push("/login"); return; }
        setProfile(prof as MemberProfile);

        const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
        const owner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
        setIsOwner(owner);

        const whSnap = await getDoc(doc(db, "webhookSettings", prof.companyCode));
        if (whSnap.exists()) {
          const data = whSnap.data() as any;
          if (data.discord) setDiscord({ enabled: false, webhookUrl: "", ...data.discord });
          if (data.slack) setSlack({ enabled: false, webhookUrl: "", ...data.slack });
          if (data.chatwork) setChatwork({ enabled: false, apiToken: "", roomId: "", ...data.chatwork });
        }
      } catch (e) {
        console.warn("webhook settings load failed:", e);
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
    } catch (e) {
      console.warn("save failed:", e);
      setSaveMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (service: "discord" | "slack" | "chatwork") => {
    setTestingService(service);
    setTestMsg("");
    try {
      const settings =
        service === "discord" ? discord :
        service === "slack" ? slack : chatwork;
      const res = await fetch("/api/webhook-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, settings }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestMsg(`${service}: テスト送信しました`);
      } else {
        setTestMsg(`${service}: ${data.error || "送信失敗"}`);
      }
    } catch {
      setTestMsg(`${service}: 送信に失敗しました`);
    } finally {
      setTestingService(null);
      setTimeout(() => setTestMsg(""), 5000);
    }
  };

  if (loading) {
    return (
      <AppShell title="Webhook設定" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Webhook設定" subtitle="外部サービスへの通知">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-lg font-extrabold text-slate-900">Webhook通知設定</div>
          <div className="mt-1 text-sm font-bold text-slate-500">
            課題作成時にChatwork・Discord・Slackへ自動通知します。
          </div>

          {/* Discord */}
          <div className="mt-6 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎮</span>
                <span className="text-sm font-extrabold text-slate-900">Discord</span>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={discord.enabled}
                  onChange={(e) => setDiscord((s) => ({ ...s, enabled: e.target.checked }))}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-orange-500 peer-checked:after:translate-x-full" />
              </label>
            </div>
            {discord.enabled && (
              <div className="mt-3">
                <div className="text-xs font-bold text-slate-600">Webhook URL</div>
                <input
                  value={discord.webhookUrl || ""}
                  onChange={(e) => setDiscord((s) => ({ ...s, webhookUrl: e.target.value }))}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500 disabled:bg-slate-50"
                />
                <button
                  onClick={() => handleTest("discord")}
                  disabled={!discord.webhookUrl || testingService === "discord"}
                  className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testingService === "discord" ? "送信中..." : "テスト送信"}
                </button>
              </div>
            )}
          </div>

          {/* Slack */}
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">💬</span>
                <span className="text-sm font-extrabold text-slate-900">Slack</span>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={slack.enabled}
                  onChange={(e) => setSlack((s) => ({ ...s, enabled: e.target.checked }))}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-orange-500 peer-checked:after:translate-x-full" />
              </label>
            </div>
            {slack.enabled && (
              <div className="mt-3">
                <div className="text-xs font-bold text-slate-600">Webhook URL</div>
                <input
                  value={slack.webhookUrl || ""}
                  onChange={(e) => setSlack((s) => ({ ...s, webhookUrl: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/..."
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500 disabled:bg-slate-50"
                />
                <button
                  onClick={() => handleTest("slack")}
                  disabled={!slack.webhookUrl || testingService === "slack"}
                  className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testingService === "slack" ? "送信中..." : "テスト送信"}
                </button>
              </div>
            )}
          </div>

          {/* Chatwork */}
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">📨</span>
                <span className="text-sm font-extrabold text-slate-900">Chatwork</span>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={chatwork.enabled}
                  onChange={(e) => setChatwork((s) => ({ ...s, enabled: e.target.checked }))}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-orange-500 peer-checked:after:translate-x-full" />
              </label>
            </div>
            {chatwork.enabled && (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs font-bold text-slate-600">APIトークン</div>
                  <input
                    value={chatwork.apiToken || ""}
                    onChange={(e) => setChatwork((s) => ({ ...s, apiToken: e.target.value }))}
                      type="password"
                    placeholder="Chatwork APIトークン"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-600">ルームID</div>
                  <input
                    value={chatwork.roomId || ""}
                    onChange={(e) => setChatwork((s) => ({ ...s, roomId: e.target.value }))}
                      placeholder="例: 123456789"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500 disabled:bg-slate-50"
                  />
                </div>
                <button
                  onClick={() => handleTest("chatwork")}
                  disabled={!chatwork.apiToken || !chatwork.roomId || testingService === "chatwork"}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testingService === "chatwork" ? "送信中..." : "テスト送信"}
                </button>
              </div>
            )}
          </div>

          {testMsg && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700">
              {testMsg}
            </div>
          )}

          {saveMsg && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-bold text-green-700">
              {saveMsg}
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
              <Link
                href="/settings"
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                戻る
              </Link>
              <button
                onClick={handleSave}
                disabled={saving}
                className={`rounded-md px-4 py-2 text-sm font-extrabold text-white ${saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700"}`}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
        </div>
      </div>
    </AppShell>
  );
}
