"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { AppShell } from "../AppShell";
import type { Notification } from "../../lib/activity";

export default function NotificationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<(Notification & { id: string })[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profSnap.exists()) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const q = query(collection(db, "notifications"), where("recipientUid", "==", u.uid));
      const unsubSnap = onSnapshot(
        q,
        (snap) => {
          const items = snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Notification & { id: string }))
            .sort((a, b) => {
              const at = (a.createdAt as any)?.toMillis?.() || 0;
              const bt = (b.createdAt as any)?.toMillis?.() || 0;
              return bt - at;
            });
          setNotifications(items);
          setLoading(false);
        },
        (e) => {
          console.error("Failed to subscribe notifications:", e);
          setLoading(false);
        }
      );
      return () => unsubSnap();
    });
    return () => unsub();
  }, [router]);

  const markAsRead = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  if (loading) {
    return (
      <AppShell title="通知" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AppShell title="通知" subtitle={`未読: ${unreadCount}件`}>
      <div className="space-y-3">
        {notifications.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
            <div className="text-sm font-bold text-slate-500">通知はありません</div>
          </div>
        ) : (
          notifications.map((n) => {
            const dt = (n.createdAt as any)?.toDate?.() ? (n.createdAt as any).toDate() as Date : null;
            return (
              <div
                key={n.id}
                className={`
                  rounded-lg border p-4 transition-colors
                  ${n.read ? "bg-white border-slate-200" : "bg-orange-50 border-orange-200"}
                `}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-extrabold text-slate-900">{n.title}</div>
                      {!n.read && (
                        <span className="rounded-full bg-orange-500 h-2 w-2"></span>
                      )}
                    </div>
                    {n.body && (
                      <div className="mt-1 text-sm text-slate-600">{n.body}</div>
                    )}
                    {dt && (
                      <div className="mt-2 text-xs text-slate-400">
                        {dt.toLocaleString("ja-JP")}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {n.link && (
                      <Link
                        href={n.link}
                        className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-700"
                        onClick={() => !n.read && markAsRead(n.id)}
                      >
                        開く
                      </Link>
                    )}
                    {!n.read && (
                      <button
                        onClick={() => markAsRead(n.id)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        既読
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AppShell>
  );
}

