"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, setDoc, Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";

type MemberProfile = { uid: string; companyCode: string; displayName?: string };

type Customer = {
  id: string;
  name: string;
  isActive?: boolean | null;
  inactivatedAt?: Timestamp | null; // 停止した日時
};

type BillingStatus = "none" | "created" | "confirmed" | "sent" | "no_invoice";

type BillingRecord = {
  id: string; // companyCode_customerId_month
  companyCode: string;
  customerId: string;
  month: string; // YYYY-MM
  status: BillingStatus;
  amount?: number | null;
  notes?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  updatedBy?: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function ymKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseYM(key: string) {
  const [y, m] = key.split("-").map((v) => Number(v));
  return { y: y || new Date().getFullYear(), m: m || new Date().getMonth() + 1 };
}

function addMonths(key: string, delta: number) {
  const { y, m } = parseYM(key);
  const d = new Date(y, (m - 1) + delta, 1);
  return ymKey(d);
}

function labelYM(key: string) {
  const { y, m } = parseYM(key);
  return `${y}/${m}`;
}

function yen(n: number) {
  const nf = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
  return nf.format(isFinite(n) ? n : 0);
}

function statusLabel(s: BillingStatus): string {
  switch (s) {
    case "created": return "作成済";
    case "confirmed": return "確認済";
    case "sent": return "送付済";
    case "no_invoice": return "請求なし";
    default: return "未着手";
  }
}

function statusColor(s: BillingStatus): string {
  switch (s) {
    case "created": return "bg-amber-100 text-amber-800";
    case "confirmed": return "bg-blue-100 text-blue-800";
    case "sent": return "bg-emerald-100 text-emerald-800";
    case "no_invoice": return "bg-slate-100 text-slate-600";
    default: return "bg-slate-50 text-slate-400";
  }
}

const STATUS_OPTIONS: BillingStatus[] = ["none", "created", "confirmed", "sent", "no_invoice"];

export default function BillingPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => ymKey(new Date()));
  const [editMode, setEditMode] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [billings, setBillings] = useState<Map<string, BillingRecord>>(new Map());

  // フィルター
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<BillingStatus | "ALL">("ALL");
  const [isConfirmed, setIsConfirmed] = useState(false);

  // 月変更時に確定状態をlocalStorageから復元
  useEffect(() => {
    if (!profile?.companyCode) return;
    const key = `billing:confirmed:${profile.companyCode}:${month}`;
    try {
      setIsConfirmed(localStorage.getItem(key) === "true");
    } catch { setIsConfirmed(false); }
  }, [month, profile?.companyCode]);

  const toggleConfirm = () => {
    if (!profile?.companyCode) return;
    const key = `billing:confirmed:${profile.companyCode}:${month}`;
    const next = !isConfirmed;
    setIsConfirmed(next);
    setEditMode(false);
    try { localStorage.setItem(key, String(next)); } catch {}
  };

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    };
    if (customerDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [customerDropdownOpen]);

  const toggleCustomer = (id: string) => {
    setSelectedCustomers((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        setError("");
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) {
          setProfile(null);
          setCustomers([]);
          setError("会社コードが未設定です（設定 > 会社 で設定してください）");
          return;
        }
        setProfile(prof);

        // 顧客一覧取得
        const custSnap = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
        const custItems = custSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Customer))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setCustomers(custItems);

        // 請求データ取得
        const billingSnap = await getDocs(query(collection(db, "billings"), where("companyCode", "==", prof.companyCode)));
        const billingMap = new Map<string, BillingRecord>();
        for (const d of billingSnap.docs) {
          const data = d.data() as BillingRecord;
          billingMap.set(d.id, { ...data, id: d.id });
        }
        setBillings(billingMap);
      } catch (e: any) {
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        setError(code && msg ? `${code}: ${msg}` : msg || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // 現在月のデータを取得・更新
  const getBillingKey = (customerId: string, m: string) => `${profile?.companyCode}_${customerId}_${m}`;

  const getBilling = (customerId: string, m: string): BillingRecord | undefined => {
    const key = getBillingKey(customerId, m);
    return billings.get(key);
  };

  const setStatus = async (customerId: string, status: BillingStatus) => {
    if (!profile?.companyCode || !user) return;
    const key = getBillingKey(customerId, month);
    const existing = billings.get(key);

    const record: BillingRecord = {
      id: key,
      companyCode: profile.companyCode,
      customerId,
      month,
      status,
      amount: existing?.amount ?? null,
      notes: existing?.notes ?? null,
      createdAt: existing?.createdAt ?? Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedBy: user.uid,
    };

    setSaving(true);
    try {
      await setDoc(doc(db, "billings", key), record);
      setBillings((prev) => {
        const next = new Map(prev);
        next.set(key, record);
        return next;
      });
    } catch (e: any) {
      console.error("保存失敗:", e);
      setError("保存に失敗しました: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const setAmount = async (customerId: string, amount: number | null) => {
    if (!profile?.companyCode || !user) return;
    const key = getBillingKey(customerId, month);
    const existing = billings.get(key);

    const record: BillingRecord = {
      id: key,
      companyCode: profile.companyCode,
      customerId,
      month,
      status: existing?.status ?? "none",
      amount,
      notes: existing?.notes ?? null,
      createdAt: existing?.createdAt ?? Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedBy: user.uid,
    };

    setSaving(true);
    try {
      await setDoc(doc(db, "billings", key), record);
      setBillings((prev) => {
        const next = new Map(prev);
        next.set(key, record);
        return next;
      });
    } catch (e: any) {
      console.error("保存失敗:", e);
      setError("保存に失敗しました: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // Timestamp → YYYY-MM 変換
  const tsToYM = (ts: Timestamp | null | undefined): string | null => {
    if (!ts || typeof ts.toDate !== "function") return null;
    return ymKey(ts.toDate());
  };

  // 表示する顧客（稼働中 or 停止月まで表示 + フィルター適用）
  const rows = useMemo(() => {
    return customers.filter((c) => {
      // 稼働中判定: isActive が false 以外（true/undefined/null）なら稼働中扱い
      if (c.isActive !== false) {
        // 稼働中 → 表示
      } else {
        // 停止中の顧客
        const inactMonth = tsToYM(c.inactivatedAt);
        if (!inactMonth) {
          // inactivatedAt が無い停止顧客 → 表示しない
          return false;
        }
        // 停止月までは表示（例: 1/10停止 → 1月度は表示、2月度以降は非表示）
        if (month > inactMonth) return false;
      }

      // 顧客フィルター
      if (selectedCustomers.length > 0 && !selectedCustomers.includes(c.id)) {
        return false;
      }
      // ステータスフィルター
      if (statusFilter !== "ALL") {
        const b = getBilling(c.id, month);
        const s = b?.status ?? "none";
        if (s !== statusFilter) return false;
      }
      return true;
    });
  }, [customers, month, selectedCustomers, statusFilter, billings, profile]);

  // 合計金額
  const totalAmount = useMemo(() => {
    return rows.reduce((sum, c) => {
      const b = getBilling(c.id, month);
      if (b?.status === "no_invoice") return sum;
      const amount = b?.amount ?? 0;
      return sum + amount;
    }, 0);
  }, [rows, month, billings, profile]);

  return (
    <AppShell
      title="請求管理"
      subtitle="顧客ごとの月次 請求"
    >
      <div className="space-y-3">
        {/* テーブル + ツールバー */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-visible">
          <div className="flex flex-wrap items-center justify-between bg-sky-50 px-3 py-2 rounded-t-lg gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="rounded-md border border-sky-200 bg-white px-2 py-1 text-[11px] font-extrabold text-sky-700 hover:bg-sky-50"
                aria-label="前月"
              >
                ←
              </button>
              <div className="text-sm font-extrabold text-slate-900 tracking-tight">{labelYM(month)}</div>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="rounded-md border border-sky-200 bg-white px-2 py-1 text-[11px] font-extrabold text-sky-700 hover:bg-sky-50"
                aria-label="翌月"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setMonth(ymKey(new Date()))}
                className={clsx(
                  "rounded-md px-2 py-1 text-[11px] font-extrabold transition",
                  month === ymKey(new Date())
                    ? "bg-sky-600 text-white"
                    : "border border-sky-200 bg-white text-sky-700 hover:bg-sky-50",
                )}
              >
                今月
              </button>
              {isConfirmed && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white">確定済</span>
              )}
              <span className="text-xs font-extrabold text-slate-600 ml-1">
                請求対象: <span className="text-slate-900">{rows.filter((c) => getBilling(c.id, month)?.status !== "no_invoice").length}件</span>
              </span>
              <span className="text-xs font-extrabold text-slate-600">
                合計: <span className="text-sky-700">{yen(totalAmount)}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {saving && <span className="text-xs font-bold text-slate-500">保存中...</span>}
              {isConfirmed ? (
                <button
                  type="button"
                  onClick={toggleConfirm}
                  className="rounded-md bg-slate-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-600 shadow-sm transition"
                >
                  確定解除
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggleConfirm}
                  disabled={loading}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
                >
                  確定
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                disabled={loading || isConfirmed}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  editMode
                    ? "bg-orange-600 text-white hover:bg-orange-700"
                    : "border border-sky-200 bg-white text-slate-700 hover:bg-sky-50 disabled:opacity-50",
                )}
              >
                {editMode ? "完了" : "編集"}
              </button>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as BillingStatus | "ALL")}
                className="rounded-md border border-sky-200 bg-white px-2 py-1.5 text-xs font-extrabold text-slate-700"
              >
                <option value="ALL">すべて</option>
                <option value="none">未着手</option>
                <option value="created">作成済</option>
                <option value="confirmed">確認済</option>
                <option value="sent">送付済</option>
                <option value="no_invoice">請求なし</option>
              </select>

              {/* 顧客別ショートカット */}
              <div className="relative" ref={customerDropdownRef}>
                <button
                  onClick={() => setCustomerDropdownOpen((v) => !v)}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-xs font-extrabold transition flex items-center gap-1.5",
                    selectedCustomers.length > 0
                      ? "bg-sky-600 text-white"
                      : "bg-white border border-sky-200 text-slate-700 hover:bg-sky-50",
                  )}
                >
                  顧客別
                  {selectedCustomers.length > 0 && (
                    <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{selectedCustomers.length}</span>
                  )}
                </button>

                {customerDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 z-[100] w-56 rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="p-2 border-b border-slate-100">
                      <div className="text-[10px] font-bold text-slate-500">顧客を選択</div>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {customers.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">顧客データを読み込み中...</div>
                      ) : (
                        customers.map((c) => (
                          <label
                            key={c.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedCustomers.includes(c.id)}
                              onChange={() => toggleCustomer(c.id)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="text-xs font-bold text-slate-700 truncate">{c.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {selectedCustomers.length > 0 && (
                      <div className="p-2 border-t border-slate-100">
                        <button
                          onClick={() => {
                            setSelectedCustomers([]);
                            setCustomerDropdownOpen(false);
                          }}
                          className="w-full rounded-md bg-slate-100 px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-200"
                        >
                          クリア
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

        <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full text-[12px] font-bold border-separate border-spacing-0">
            <thead className="bg-sky-50 text-[11px] font-extrabold text-slate-900 sticky top-0 z-10">
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 z-20 w-[280px] px-3 py-2 text-left whitespace-nowrap border-b border-r border-slate-200 bg-sky-50">顧客</th>
                <th className="w-[160px] px-3 py-2 text-center whitespace-nowrap border-b border-r border-slate-200 bg-sky-50">ステータス</th>
                <th className="w-[200px] px-3 py-2 text-center whitespace-nowrap border-b border-slate-200 bg-sky-50">請求金額</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    読み込み中...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    該当する顧客がありません
                  </td>
                </tr>
              ) : (
                rows.map((c, idx) => {
                  const b = getBilling(c.id, month);
                  const status = b?.status ?? "none";
                  const amount = b?.amount ?? 0;
                  return (
                    <tr key={c.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                      <td className="sticky left-0 z-10 px-3 py-3 text-left font-extrabold text-slate-900 whitespace-nowrap border-r border-slate-200 bg-inherit">
                        <div className="truncate max-w-[260px]" title={c.name || "-"}>
                          <Link href={`/customers/${c.id}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center border-r border-slate-200">
                        {editMode ? (
                          <select
                            value={status}
                            onChange={(e) => setStatus(c.id, e.target.value as BillingStatus)}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-extrabold text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{statusLabel(opt)}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold", statusColor(status))}>
                            {statusLabel(status)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editMode && status !== "no_invoice" ? (
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={String(amount)}
                            onChange={(e) => {
                              const v = e.target.value.trim();
                              const n = v === "" ? 0 : Number(v);
                              if (Number.isFinite(n)) setAmount(c.id, Math.max(0, n));
                            }}
                            className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-[12px] font-extrabold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          />
                        ) : status === "no_invoice" ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className="text-slate-900">{yen(amount)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] font-bold text-slate-500">
          ※ ステータスと金額を「編集」で入力すると、Firestoreに保存されます。
        </div>
      </div>
    </AppShell>
  );
}
