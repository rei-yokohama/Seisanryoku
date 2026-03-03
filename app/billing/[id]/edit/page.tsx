"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, updateDoc, Timestamp, where } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "../../../AppShell";
import { auth, db } from "../../../../lib/firebase";
import { ensureProfile } from "../../../../lib/ensureProfile";
import { logActivity } from "../../../../lib/activity";
import {
  type MemberProfile,
  type Customer,
  type IssuerProfile,
  type Employee,
  type BillingStatus,
  clsx,
  getCustomerAssignees,
  STATUS_OPTIONS,
  statusLabel,
} from "../../../../lib/billing";

export default function BillingEditPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [issuerProfiles, setIssuerProfiles] = useState<IssuerProfile[]>([]);
  const [uidNameMap, setUidNameMap] = useState<Map<string, string>>(new Map());

  // Form state
  const [customerId, setCustomerId] = useState("");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [month, setMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [taxType, setTaxType] = useState<"included" | "excluded">("included");
  const [issuerProfileId, setIssuerProfileId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [billingDate, setBillingDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<BillingStatus>("created");
  const [invoiceNumber, setInvoiceNumber] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setLoading(false); router.push("/login"); return; }
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) { setLoading(false); router.push("/login"); return; }
        setProfile(prof);

        // Load billing
        const billingSnap = await getDoc(doc(db, "billings", id));
        if (!billingSnap.exists()) {
          setError("請求書が見つかりません");
          setLoading(false);
          return;
        }
        const bill = billingSnap.data() as any;

        // Load customers
        const custSnap = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
        const custs = custSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Customer))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setCustomers(custs);

        // Load employees
        try {
          const empSnap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          const nameMap = new Map<string, string>();
          for (const d of empSnap.docs) {
            const emp = d.data() as Employee;
            if (emp.authUid) nameMap.set(emp.authUid, emp.name || "");
          }
          setUidNameMap(nameMap);
        } catch {}

        // Load issuer profiles
        try {
          const bsSnap = await getDoc(doc(db, "billingSettings", prof.companyCode));
          if (bsSnap.exists()) {
            const bsData = bsSnap.data() as any;
            if (Array.isArray(bsData.profiles)) setIssuerProfiles(bsData.profiles);
          }
        } catch {}

        // Populate form (only once)
        if (!loadedOnce) {
          setCustomerId(bill.customerId || "");
          setAssigneeUid(bill.assigneeUid || "");
          setMonth(bill.month || "");
          setAmount(String(bill.amount ?? ""));
          setTaxType(bill.taxType || "included");
          setIssuerProfileId(bill.issuerProfileId || "");
          setIssueDate(bill.issueDate ? bill.issueDate.replace(/\//g, "-") : "");
          setBillingDate(bill.billingDate ? bill.billingDate.replace(/\//g, "-") : "");
          setDueDate(bill.dueDate ? bill.dueDate.replace(/\//g, "-") : "");
          setItemName(bill.itemName || "");
          setItemDescription(bill.itemDescription || "");
          setNotes(bill.notes || "");
          setStatus(bill.status || "created");
          setInvoiceNumber(bill.invoiceNumber || "");
          setLoadedOnce(true);
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [id, router, loadedOnce]);

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

  const handleSubmit = async () => {
    if (!user || !profile?.companyCode) return;
    setError("");

    if (!customerId) { setError("顧客を選択してください"); return; }
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt < 0) { setError("請求金額を入力してください"); return; }

    setSaving(true);
    try {
      const issueDateFormatted = issueDate ? issueDate.replace(/-/g, "/") : "";
      const custName = customers.find((c) => c.id === customerId)?.name || "";
      const assignName = uidNameMap.get(assigneeUid) || "";

      await updateDoc(doc(db, "billings", id), {
        customerId,
        assigneeUid: assigneeUid || null,
        month,
        status,
        amount: amt,
        notes: notes.trim() || null,
        taxType,
        issuerProfileId: issuerProfileId || null,
        invoiceNumber: invoiceNumber || null,
        issueDate: issueDateFormatted || null,
        billingDate: billingDate ? billingDate.replace(/-/g, "/") : null,
        dueDate: dueDate ? dueDate.replace(/-/g, "/") : null,
        itemName: itemName.trim() || null,
        itemDescription: itemDescription.trim() || null,
        customerName: custName,
        assigneeName: assignName || null,
        updatedAt: Timestamp.now(),
        updatedBy: user.uid,
      });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "BILLING_UPDATED",
        message: `請求書を更新しました: ${custName} ${month}`,
        link: `/billing/${id}`,
      });

      router.push(`/billing/${id}`);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="請求書編集" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell title="請求書編集" subtitle={invoiceNumber || id.slice(0, 12)}>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push(`/billing/${id}`)}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          ← 詳細に戻る
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className={clsx(
            "rounded-md px-5 py-2 text-sm font-extrabold text-white transition",
            saving ? "bg-sky-400" : "bg-sky-600 hover:bg-sky-700",
          )}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
          {/* Invoice number (read-only) */}
          {invoiceNumber && (
            <div className="md:col-span-6">
              <label className="text-xs font-extrabold text-slate-600">請求番号</label>
              <input
                value={invoiceNumber}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-500"
              />
            </div>
          )}

          {/* Status */}
          <div className={invoiceNumber ? "md:col-span-6" : "md:col-span-12"}>
            <label className="text-xs font-extrabold text-slate-600">ステータス</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as BillingStatus)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{statusLabel(opt)}</option>
              ))}
            </select>
          </div>

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
          {issuerProfiles.length > 0 && (
            <div className="md:col-span-6">
              <label className="text-xs font-extrabold text-slate-600">発行元プロファイル</label>
              <select
                value={issuerProfileId}
                onChange={(e) => setIssuerProfileId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
              >
                <option value="">選択してください</option>
                {issuerProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (デフォルト)" : ""}</option>
                ))}
              </select>
            </div>
          )}

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
          onClick={() => router.push(`/billing/${id}`)}
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
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </AppShell>
  );
}
