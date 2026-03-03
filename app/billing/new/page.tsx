"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, where } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "../../AppShell";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import { logActivity } from "../../../lib/activity";
import {
  type MemberProfile,
  type Customer,
  type IssuerProfile,
  type Employee,
  type BillingStatus,
  clsx,
  ymKey,
  makeBillingKey,
  getCustomerAssignees,
  generateInvoiceNumber,
  formatDate,
} from "../../../lib/billing";

export default function BillingNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [prefilled, setPrefilled] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [issuerProfiles, setIssuerProfiles] = useState<IssuerProfile[]>([]);
  const [uidNameMap, setUidNameMap] = useState<Map<string, string>>(new Map());

  // Form state
  const [customerId, setCustomerId] = useState("");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [month, setMonth] = useState(() => ymKey(new Date()));
  const [amount, setAmount] = useState("");
  const [taxType, setTaxType] = useState<"included" | "excluded">("included");
  const [issuerProfileId, setIssuerProfileId] = useState("");
  const [issueDate, setIssueDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [billingDate, setBillingDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [dueDate, setDueDate] = useState("");
  const [itemName, setItemName] = useState("業務委託費");
  const [itemDescription, setItemDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<BillingStatus>("created");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setLoading(false); router.push("/login"); return; }
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) { setLoading(false); router.push("/login"); return; }
        setProfile(prof);

        // Load customers
        const custSnap = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
        const custs = custSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Customer))
          .filter((c) => c.isActive !== false)
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setCustomers(custs);

        // Load employees
        const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
        const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
        setEmployees(emps);
        const nameMap = new Map<string, string>();
        for (const emp of emps) {
          if (emp.authUid) nameMap.set(emp.authUid, emp.name || "");
        }
        setUidNameMap(nameMap);

        // Load issuer profiles
        try {
          const bsSnap = await getDoc(doc(db, "billingSettings", prof.companyCode));
          if (bsSnap.exists()) {
            const bsData = bsSnap.data() as any;
            if (Array.isArray(bsData.profiles)) {
              setIssuerProfiles(bsData.profiles);
              const def = bsData.profiles.find((p: IssuerProfile) => p.isDefault) || bsData.profiles[0];
              if (def) setIssuerProfileId(def.id);
            }
          }
        } catch {}

        // Pre-fill from query params (e.g. from billing list "発行" button)
        if (!prefilled) {
          const qCustomerId = searchParams.get("customerId");
          const qAssigneeUid = searchParams.get("assigneeUid");
          const qMonth = searchParams.get("month");
          const qAmount = searchParams.get("amount");
          if (qCustomerId) setCustomerId(qCustomerId);
          if (qAssigneeUid) setAssigneeUid(qAssigneeUid);
          if (qMonth) setMonth(qMonth);
          if (qAmount) setAmount(qAmount);
          setPrefilled(true);
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, searchParams, prefilled]);

  // Available assignees for selected customer
  const availableAssignees = useMemo(() => {
    if (!customerId) return [];
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return [];
    const uids = getCustomerAssignees(cust);
    return uids.map((uid) => ({
      uid,
      name: uidNameMap.get(uid) || uid.slice(0, 8),
    }));
  }, [customerId, customers, uidNameMap]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const handleSubmit = async () => {
    if (!user || !profile?.companyCode) return;
    setError("");

    if (!customerId) { setError("顧客を選択してください"); return; }
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt < 0) { setError("請求金額を入力してください"); return; }

    setSaving(true);
    try {
      const billingKey = makeBillingKey(profile.companyCode, customerId, assigneeUid, month);
      const suffix = assigneeUid ? assigneeUid.slice(0, 4) : customerId.slice(0, 6);
      const invoiceNumber = generateInvoiceNumber(month, suffix);
      const issueDateFormatted = issueDate
        ? issueDate.replace(/-/g, "/")
        : formatDate(new Date());

      const now = Timestamp.now();
      const custName = selectedCustomer?.name || "";
      const assignName = uidNameMap.get(assigneeUid) || "";

      await setDoc(doc(db, "billings", billingKey), {
        id: billingKey,
        companyCode: profile.companyCode,
        customerId,
        assigneeUid: assigneeUid || null,
        month,
        status,
        amount: amt,
        notes: notes.trim() || null,
        taxType,
        issuerProfileId: issuerProfileId || null,
        invoiceNumber,
        issueDate: issueDateFormatted,
        billingDate: billingDate ? billingDate.replace(/-/g, "/") : null,
        dueDate: dueDate ? dueDate.replace(/-/g, "/") : null,
        itemName: itemName.trim() || null,
        itemDescription: itemDescription.trim() || null,
        customerName: custName,
        assigneeName: assignName || null,
        pdfGeneratedAt: now,
        createdAt: now,
        updatedAt: now,
        updatedBy: user.uid,
      });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "BILLING_CREATED",
        message: `請求書を作成しました: ${custName} ${month}`,
        link: `/billing/${billingKey}`,
      });

      router.push("/billing");
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="請求書作成" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell title="請求書作成" subtitle="新しい請求書を作成">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push("/billing")}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← 一覧に戻る
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className={clsx(
            "rounded-md px-5 py-2 text-sm font-extrabold text-white transition",
            saving ? "bg-sky-400" : "bg-sky-600 hover:bg-sky-700",
          )}
        >
          {saving ? "発行中..." : "発行"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
          {/* Customer */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">顧客 *</label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setAssigneeUid("");
              }}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            >
              <option value="">選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Assignee */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">担当者</label>
            <select
              value={assigneeUid}
              onChange={(e) => setAssigneeUid(e.target.value)}
              disabled={!customerId || availableAssignees.length === 0}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {!customerId ? "先に顧客を選択" : availableAssignees.length === 0 ? "担当者なし" : "選択してください"}
              </option>
              {availableAssignees.map((a) => (
                <option key={a.uid} value={a.uid}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Billing month */}
          <div className="md:col-span-4">
            <label className="text-xs font-extrabold text-slate-600">請求月 *</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Amount */}
          <div className="md:col-span-4">
            <label className="text-xs font-extrabold text-slate-600">請求金額（円） *</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="例：500000"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Tax type */}
          <div className="md:col-span-4">
            <label className="text-xs font-extrabold text-slate-600">消費税</label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="taxType"
                  value="included"
                  checked={taxType === "included"}
                  onChange={() => setTaxType("included")}
                  className="h-4 w-4 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-sm font-bold text-slate-700">税込</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="taxType"
                  value="excluded"
                  checked={taxType === "excluded"}
                  onChange={() => setTaxType("excluded")}
                  className="h-4 w-4 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-sm font-bold text-slate-700">税抜（+10%）</span>
              </label>
            </div>
          </div>

          {/* Issuer profile */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">発行元プロファイル</label>
            {issuerProfiles.length > 0 ? (
              <select
                value={issuerProfileId}
                onChange={(e) => setIssuerProfileId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
              >
                {issuerProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (デフォルト)" : ""}</option>
                ))}
              </select>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-400">未設定</span>
                <a
                  href="/settings/billing"
                  className="text-xs font-extrabold text-sky-600 hover:text-sky-700 underline"
                >
                  設定で追加
                </a>
              </div>
            )}
          </div>

          {/* Issue date */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">発行日</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Billing date */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">請求日</label>
            <input
              type="date"
              value={billingDate}
              onChange={(e) => setBillingDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Due date */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">支払い期限</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Item name */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">項目</label>
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="例：業務委託費"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Item description */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">内容</label>
            <input
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              placeholder="例：3月度 業務委託費"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            />
          </div>

          {/* Status */}
          <div className="md:col-span-6">
            <label className="text-xs font-extrabold text-slate-600">ステータス</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as BillingStatus)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            >
              <option value="created">作成済</option>
              <option value="confirmed">確認済</option>
              <option value="sent">送付済</option>
              <option value="no_invoice">請求なし</option>
            </select>
          </div>

          {/* Notes */}
          <div className="md:col-span-12">
            <label className="text-xs font-extrabold text-slate-600">備考</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200 resize-y"
              placeholder="備考を入力..."
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={() => router.push("/billing")}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          キャンセル
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className={clsx(
            "rounded-md px-5 py-2 text-sm font-extrabold text-white transition",
            saving ? "bg-sky-400" : "bg-sky-600 hover:bg-sky-700",
          )}
        >
          {saving ? "発行中..." : "発行"}
        </button>
      </div>
    </AppShell>
  );
}
