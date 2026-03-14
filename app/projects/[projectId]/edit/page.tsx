"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { ensureProfile } from "../../../../lib/ensureProfile";
import { logActivity } from "../../../../lib/activity";
import { ensureProperties } from "../../../../lib/properties";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
};

type DealStatus = "ACTIVE" | "CONFIRMED" | "PLANNED" | "STOPPING" | "INACTIVE";

const DEAL_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "稼働中", color: "bg-green-100 text-green-700" },
  { value: "CONFIRMED", label: "稼働確定", color: "bg-blue-100 text-blue-700" },
  { value: "PLANNED", label: "稼働予定", color: "bg-sky-100 text-sky-700" },
  { value: "STOPPING", label: "停止予定", color: "bg-amber-100 text-amber-700" },
  { value: "INACTIVE", label: "停止中", color: "bg-slate-100 text-slate-700" },
] as const;

type ActivePeriod = { startedAt: any; endedAt: any };

type DealDoc = {
  companyCode: string;
  createdBy: string;
  customerId: string;
  title: string;
  genre?: string;
  description?: string;
  status: DealStatus;
  assigneeUids?: string[] | null; // 担当者（複数）
  leaderUid?: string | null; // 旧: 互換用
  subLeaderUid?: string | null; // 旧: 互換用
  revenue?: number | null;
  assigneeSales?: Record<string, number> | null;
  // status tracking (for LTV)
  firstActivatedAt?: any | null;
  activeStartedAt?: any | null;
  lastInactivatedAt?: any | null;
  activePeriods?: ActivePeriod[] | null;
};

export default function ProjectEditPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<DealStatus>("ACTIVE");
  const [assigneeUids, setAssigneeUids] = useState<string[]>([]);
  const [revenue, setRevenue] = useState("");
  const [assigneeSales, setAssigneeSales] = useState<Record<string, string>>({});
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hasMultipleAssignees = assigneeUids.length >= 2;

  const assigneeSalesTotal = useMemo(() => {
    let sum = 0;
    for (const uid of assigneeUids) {
      const v = Number(assigneeSales[uid] || 0);
      if (!Number.isNaN(v)) sum += v;
    }
    return sum;
  }, [assigneeSales, assigneeUids]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [originalAssigneeUids, setOriginalAssigneeUids] = useState<string[]>([]);
  const [originalRevenue, setOriginalRevenue] = useState<number | null>(null);

  const loadCustomers = async (u: User, prof: MemberProfile) => {
    const merged: Customer[] = [];
    if (prof.companyCode) {
      const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    } else {
      // companyCode が未設定の過去データ救済（通常は通らない想定）
      const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
      merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(items);
    return items;
  };

  const loadEmployees = async (prof: MemberProfile) => {
    if (!prof.companyCode) {
      setEmployees([]);
      return;
    }
    const snap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setEmployees(list);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);
        const props = await ensureProperties(prof.companyCode);
        const dealCatProp = props.find((p) => p.key === "dealCategory");
        if (dealCatProp) setGenreOptions(dealCatProp.options);

        await loadCustomers(u, prof);
        await loadEmployees(prof);

        const dealSnap = await getDoc(doc(db, "deals", projectId));
        if (!dealSnap.exists()) {
          setError("案件が見つかりません");
          setLoading(false);
          return;
        }
        const d = dealSnap.data() as DealDoc;
        if (!loadedOnce) {
          setCustomerId(d.customerId || "");
          setTitle(d.title || "");
          setGenre(d.genre || "");
          setDescription(d.description || "");
          setStatus((d.status as DealStatus) || "ACTIVE");
          // 新フィールド優先、なければ旧フィールドから復元
          let initialAssignees: string[] = [];
          if (Array.isArray(d.assigneeUids) && d.assigneeUids.length > 0) {
            initialAssignees = d.assigneeUids.filter(Boolean) as string[];
          } else {
            const legacy: string[] = [];
            if (d.leaderUid) legacy.push(d.leaderUid);
            if (d.subLeaderUid && d.subLeaderUid !== d.leaderUid) legacy.push(d.subLeaderUid);
            initialAssignees = legacy;
          }
          setAssigneeUids(initialAssignees);
          setOriginalAssigneeUids(initialAssignees);
          const initialRevenue = d.revenue === null || d.revenue === undefined ? null : Number(d.revenue);
          setRevenue(initialRevenue === null ? "" : String(initialRevenue));
          setOriginalRevenue(initialRevenue);
          // 担当別売上を読み込み
          if (d.assigneeSales && typeof d.assigneeSales === "object") {
            const loaded: Record<string, string> = {};
            for (const [uid, val] of Object.entries(d.assigneeSales)) {
              loaded[uid] = val === null || val === undefined ? "" : String(val);
            }
            setAssigneeSales(loaded);
          }
          setLoadedOnce(true);
        }
      } catch (e: any) {
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        setError(code && msg ? `${code}: ${msg}` : msg || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, projectId, loadedOnce]);

  const customerName = useMemo(() => customers.find((c) => c.id === customerId)?.name || "", [customers, customerId]);

  /** ログインユーザーの表示名（プロフィール → Auth displayName → email → フォールバック） */
  const currentUserDisplayName =
    (profile?.displayName && profile.displayName.trim()) ||
    (user?.displayName && user.displayName.trim()) ||
    (user?.email && user.email.trim()) ||
    "私";

  const handleSave = async () => {
    if (!user || !profile) return;
    if (!customerId) {
      setError("顧客を選択してください");
      return;
    }
    const t = title.trim();
    if (!t) {
      setError("案件名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const revenueTrimmed = revenue.trim();
      const revenueValue: number | null = revenueTrimmed ? Number(revenueTrimmed) : null;
      if (revenueTrimmed) {
        const revenueNum = Number(revenueTrimmed);
        if (Number.isNaN(revenueNum) || revenueNum < 0) {
        setError("売上は 0 以上の数値で入力してください");
        setSaving(false);
        return;
        }
      }

      const dealRef = doc(db, "deals", projectId);
      const beforeSnap = await getDoc(dealRef);
      const before = beforeSnap.exists() ? (beforeSnap.data() as any) : null;
      const prevStatus = (before?.status as DealStatus) || "ACTIVE";
      const now = Timestamp.now();

      const finalRevenue = hasMultipleAssignees
        ? (assigneeSalesTotal > 0 ? assigneeSalesTotal : revenueValue)
        : revenueValue;
      const finalAssigneeSales = hasMultipleAssignees
        ? (() => {
            const m: Record<string, number> = {};
            for (const uid of assigneeUids) {
              const v = Number(assigneeSales[uid] || 0);
              if (!Number.isNaN(v) && v > 0) m[uid] = v;
            }
            return Object.keys(m).length > 0 ? m : null;
          })()
        : null;

      const updatePayload: Record<string, any> = {
        customerId,
        title: t,
        genre: genre.trim() || "",
        description: description.trim() || "",
        status,
        assigneeUids: assigneeUids.length > 0 ? assigneeUids : null,
        // 旧フィールドはクリア（互換性のため null に）
        leaderUid: null,
        subLeaderUid: null,
        revenue: finalRevenue,
        assigneeSales: finalAssigneeSales,
        updatedAt: now,
      };

      const statusChanged = status !== prevStatus;
      // 稼働中とみなすステータス（LTV計算用）
      const isActiveStatus = (s: DealStatus) => ["ACTIVE", "CONFIRMED", "STOPPING"].includes(s);
      const wasActive = isActiveStatus(prevStatus);
      const isNowActive = isActiveStatus(status);
      
      if (statusChanged) {
        if (!wasActive && isNowActive) {
          // 非稼働 → 稼働：開始
          updatePayload.activeStartedAt = now;
          if (!before?.firstActivatedAt) updatePayload.firstActivatedAt = now;
        } else if (wasActive && !isNowActive) {
          // 稼働 → 非稼働：停止
          const prevActiveStartedAt = before?.activeStartedAt || null;
          const startedAt = prevActiveStartedAt || before?.firstActivatedAt || before?.createdAt || now;
          const prevPeriods: any[] = Array.isArray(before?.activePeriods) ? before.activePeriods : [];
          const sanitizedPrev = prevPeriods
            .filter((p) => p && p.startedAt && p.endedAt)
            .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt }));
          updatePayload.activePeriods = [...sanitizedPrev, { startedAt, endedAt: now }];
          updatePayload.activeStartedAt = null;
          updatePayload.lastInactivatedAt = now;
          if (!before?.firstActivatedAt) updatePayload.firstActivatedAt = startedAt;
        }
      }

      await updateDoc(dealRef, updatePayload);

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "DEAL_UPDATED",
        projectId,
        entityId: projectId,
        message: `案件を更新しました: ${t}（顧客: ${customerName || "未設定"}）`,
        link: `/projects/${projectId}/detail`,
      });

      if (statusChanged) {
        const jp = (ts: any) => (ts?.toDate?.() ? (ts.toDate() as Date).toLocaleString("ja-JP") : "");
        const label = (s: DealStatus) => DEAL_STATUS_OPTIONS.find(opt => opt.value === s)?.label || s;
        const afterStartedAt = isNowActive ? now : (updatePayload.firstActivatedAt || before?.firstActivatedAt || before?.createdAt || now);
        const afterStoppedAt = !isNowActive ? now : (before?.lastInactivatedAt || "");

        // 稼働累計（停止時は periods を合算、稼働中は periods + 現在稼働分）
        const periods: any[] = !isNowActive
          ? (updatePayload.activePeriods || [])
          : (Array.isArray(before?.activePeriods) ? before.activePeriods : []);
        let totalMs = 0;
        for (const p of periods) {
          const st = p?.startedAt?.toMillis?.() ? p.startedAt.toMillis() : null;
          const en = p?.endedAt?.toMillis?.() ? p.endedAt.toMillis() : null;
          if (!st || !en) continue;
          totalMs += Math.max(0, en - st);
        }
        if (isNowActive) {
          const curStart = now.toMillis();
          // 今回の切替直後なので 0ms だが、表示の整合のため加算は行わない
          void curStart;
        }
        const totalDays = totalMs / (1000 * 60 * 60 * 24);
        const ltv = Number.isFinite(revenueValue as any) ? (revenueValue as number) : (Number(before?.revenue) || 0);

        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "DEAL_STATUS_CHANGED",
          projectId,
          entityId: projectId,
          message:
            `稼働ステータスを「${label(prevStatus)}」→「${label(status)}」に変更しました`
            + `（開始: ${jp(afterStartedAt)}${!isNowActive ? ` / 停止: ${jp(afterStoppedAt)}` : ""}`
            + ` / 稼働累計: ${totalDays.toFixed(1)}日 / 売上: ¥${(ltv || 0).toLocaleString("ja-JP")}）`,
          link: `/projects/${projectId}/detail`,
        });
      }

      // 担当者変更のアクティビティログ
      const sortedOrig = [...originalAssigneeUids].sort();
      const sortedNew = [...assigneeUids].sort();
      const assigneesChanged =
        sortedOrig.length !== sortedNew.length ||
        sortedOrig.some((uid, i) => uid !== sortedNew[i]);

      if (assigneesChanged) {
        const getAssigneeName = (uid: string) => {
          if (uid === user.uid) return currentUserDisplayName;
          const emp = employees.find((e) => e.authUid === uid);
          return emp?.name || "不明なユーザー";
        };

        const oldNames = originalAssigneeUids.length > 0
          ? originalAssigneeUids.map(getAssigneeName).join("、")
          : "未設定";
        const newNames = assigneeUids.length > 0
          ? assigneeUids.map(getAssigneeName).join("、")
          : "未設定";

        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "ASSIGNEE_CHANGED",
          projectId,
          entityId: projectId,
          message: `担当者を変更しました: ${oldNames} → ${newNames}`,
          link: `/projects/${projectId}/detail`,
        });
      }

      // 売上変更のアクティビティログ
      const revenueChanged = originalRevenue !== revenueValue;
      if (revenueChanged) {
        const formatYen = (n: number | null) => {
          if (n === null) return "未設定";
          return `¥${n.toLocaleString("ja-JP")}`;
        };
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "DEAL_UPDATED",
          projectId,
          entityId: projectId,
          message: `売上を変更しました: ${formatYen(originalRevenue)} → ${formatYen(revenueValue)}`,
          link: `/projects/${projectId}/detail`,
        });
      }

      router.push(`/projects/${projectId}/detail`);
    } catch (e: any) {
      const code = String(e?.code || "");
      const msg = String(e?.message || "");
      setError(code && msg ? `${code}: ${msg}` : msg || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="案件編集" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="案件編集"
      subtitle="案件情報を更新"
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-extrabold text-slate-900">案件編集</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}/detail`}
              className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 hover:bg-orange-50"
            >
              ← 案件詳細
            </Link>
            <button
              onClick={handleSave}
              disabled={saving || customers.length === 0}
              className="rounded-full bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

          <div className="grid grid-cols-1 gap-4">
            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">顧客 *</div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 sm:flex-1"
                >
                  {customers.length === 0 ? <option value="">顧客がありません（先に顧客を追加）</option> : null}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Link href="/customers" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  顧客を追加
                </Link>
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">案件名 *</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="例：〇〇システム開発"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">カテゴリ</div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none sm:flex-1"
                >
                  <option value="">未設定</option>
                  {genreOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <Link
                  href="/settings/properties"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  候補を編集
                </Link>
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">ステータス</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as DealStatus)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                {DEAL_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">担当者（複数選択可）</div>
              <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3 min-h-[48px]">
                {assigneeUids.length === 0 && (
                  <span className="text-sm text-slate-400">未設定</span>
                )}
                {assigneeUids.map((uid) => {
                  const emp = employees.find((e) => e.authUid === uid);
                  const name = uid === user.uid ? currentUserDisplayName : (emp?.name || "不明");
                  return (
                    <span
                      key={uid}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800"
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => setAssigneeUids((prev) => prev.filter((u) => u !== uid))}
                        className="ml-1 text-orange-500 hover:text-orange-700"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
              <select
                value=""
                onChange={(e) => {
                  const v = (e.target.value || "").trim();
                  if (!v) return;
                  setAssigneeUids((prev) => (prev.includes(v) ? prev : [...prev, v]));
                  e.target.value = "";
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
              >
                <option value="">＋ 担当者を追加...</option>
                {!assigneeUids.includes(user.uid) && (
                  <option value={user.uid}>{currentUserDisplayName}</option>
                )}
                {employees
                  .filter((e) => !!e.authUid && e.authUid !== user.uid && !assigneeUids.includes(e.authUid!))
                  .map((e) => (
                    <option key={e.id} value={e.authUid!}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </div>

            {hasMultipleAssignees ? (
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">担当別売上（円/月）</div>
                <div className="space-y-2">
                  {assigneeUids.map((uid) => {
                    const emp = employees.find((e) => e.authUid === uid);
                    const aName = uid === user.uid ? currentUserDisplayName : (emp?.name || "不明");
                    return (
                      <div key={uid} className="flex items-center gap-2">
                        <span className="w-20 truncate text-xs font-bold text-slate-700">{aName}</span>
                        <input
                          type="number"
                          value={assigneeSales[uid] || ""}
                          onChange={(e) => setAssigneeSales((prev) => ({ ...prev, [uid]: e.target.value }))}
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          placeholder="0"
                          inputMode="numeric"
                        />
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-end gap-2 text-xs font-extrabold text-slate-600 border-t border-slate-100 pt-2">
                    <span>合計:</span>
                    <span className="text-orange-600">¥{assigneeSalesTotal.toLocaleString("ja-JP")}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">売上（数値）</div>
                <input
                  value={revenue}
                  onChange={(e) => setRevenue(e.target.value)}
                  inputMode="numeric"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：500000"
                />
              </div>
            )}

            <div>
              <div className="mb-1 text-sm font-bold text-slate-700">概要</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="案件の背景・範囲・注意点など"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Link href={`/projects/${projectId}/detail`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              キャンセル
            </Link>
            <button
              onClick={handleSave}
              disabled={saving || customers.length === 0}
              className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


