"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { auth, db } from "../../lib/firebase";
import { ensureProfile } from "../../lib/ensureProfile";
import { resolveVisibleUids, parseDataVisibility } from "../../lib/visibilityPermissions";
import type { InvoiceData } from "../../lib/pdf/generateInvoice";
import {
  type MemberProfile,
  type Customer,
  type BillingRecord,
  type BillingStatus,
  type Employee,
  type IssuerProfile,
  clsx,
  statusLabel,
  statusColor,
  yen,
  ymKey,
  parseYM,
  addMonths,
  makeBillingKey,
  getCustomerAssignees,
  STATUS_OPTIONS,
} from "../../lib/billing";

/** 表示行: 顧客×担当者 (billing有無に関わらず生成) */
type DisplayRow = {
  customer: Customer;
  assigneeUid: string;
  assigneeName: string;
  billing: BillingRecord | undefined;
};

export default function BillingListPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [billings, setBillings] = useState<Map<string, BillingRecord>>(new Map());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [uidNameMap, setUidNameMap] = useState<Map<string, string>>(new Map());
  const [isOwner, setIsOwner] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [visibleUids, setVisibleUids] = useState<Set<string>>(new Set());
  const [issuerProfiles, setIssuerProfiles] = useState<IssuerProfile[]>([]);
  const [downloadingPdfKey, setDownloadingPdfKey] = useState<string | null>(null);

  // Filters
  const [month, setMonth] = useState(() => ymKey(new Date()));
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<BillingStatus | "ALL">("ALL");

  // Customer dropdown
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setLoading(false); return; }
      try {
        setError("");
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) {
          setProfile(null);
          setError("会社コードが未設定です（設定 > 会社 で設定してください）");
          return;
        }
        setProfile(prof);

        const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
        const owner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
        setIsOwner(owner);

        let billingPerms = { canEdit: false };
        let resolvedUids = new Set<string>();
        if (owner) {
          billingPerms = { canEdit: true };
        } else {
          try {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            if (msSnap.exists()) {
              const msData = msSnap.data() as any;
              const bp = msData.billingPermissions || {};
              billingPerms.canEdit = bp.canEdit === true;
              const vis = parseDataVisibility(msData, "billingPermissions");
              resolvedUids = await resolveVisibleUids(u.uid, prof.companyCode, vis);
            } else {
              resolvedUids = new Set([u.uid]);
            }
          } catch {
            resolvedUids = new Set([u.uid]);
          }
        }
        setCanEdit(billingPerms.canEdit);
        setVisibleUids(resolvedUids);

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
            if (Array.isArray(bsData.profiles)) {
              setIssuerProfiles(bsData.profiles);
            }
          }
        } catch {}

        // Load billings
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

  // Billing lookup helper
  const getBilling = (customerId: string, assigneeUid: string): BillingRecord | undefined => {
    if (!profile?.companyCode) return undefined;
    if (assigneeUid) {
      const key = makeBillingKey(profile.companyCode, customerId, assigneeUid, month);
      const found = billings.get(key);
      if (found) return found;
    }
    const legacyKey = makeBillingKey(profile.companyCode, customerId, "", month);
    return billings.get(legacyKey);
  };

  // Timestamp → YYYY-MM
  const tsToYM = (ts: Timestamp | null | undefined): string | null => {
    if (!ts || typeof ts.toDate !== "function") return null;
    return ymKey(ts.toDate());
  };

  // PDF download handler
  const handleDownloadPdf = async (row: DisplayRow) => {
    const b = row.billing;
    if (!b || !b.amount) return;
    const key = `${row.customer.id}_${row.assigneeUid || "_"}`;
    setDownloadingPdfKey(key);
    try {
      const ip = issuerProfiles.find((p) => p.id === b.issuerProfileId) || issuerProfiles.find((p) => p.isDefault) || issuerProfiles[0];
      if (!ip) { alert("発行元プロファイルが設定されていません"); return; }
      const { m: billingM } = parseYM(b.month);
      const pdfData: InvoiceData = {
        issuerCompanyName: ip.companyName,
        issuerCorporateNumber: ip.corporateNumber,
        issuerPostalCode: ip.postalCode,
        issuerAddress: ip.address,
        issuerTel: ip.tel,
        bankName: ip.bankName,
        branchName: ip.branchName,
        accountType: ip.accountType,
        accountNumber: ip.accountNumber,
        accountHolder: ip.accountHolder,
        recipientName: row.customer.name,
        recipientContactName: row.customer.contactName || undefined,
        recipientAddress: row.customer.address || undefined,
        invoiceNumber: b.invoiceNumber || b.id,
        issueDate: b.issueDate || "",
        billingMonth: `${billingM}月度`,
        amount: b.amount,
        taxType: b.taxType || "included",
      };
      const { generateInvoice } = await import("../../lib/pdf/generateInvoice");
      const result = await generateInvoice(pdfData);
      const a = document.createElement("a");
      a.href = result.blobUrl;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error("PDF生成エラー:", e);
      alert("PDFの生成に失敗しました");
    } finally {
      setDownloadingPdfKey(null);
    }
  };

  // Build display rows from customers (shows all customers, not just ones with billing records)
  const displayRows = useMemo(() => {
    const result: DisplayRow[] = [];

    for (const c of customers) {
      // Active check
      if (c.isActive === false) {
        const inactMonth = tsToYM(c.inactivatedAt);
        if (!inactMonth || month > inactMonth) continue;
      }
      // Customer filter
      if (customerFilter && c.id !== customerFilter) continue;

      const allAssignees = getCustomerAssignees(c);

      // Visibility filter
      let relevantAssignees: string[];
      if (visibleUids.size > 0) {
        relevantAssignees = allAssignees.filter((uid) => visibleUids.has(uid));
        if (relevantAssignees.length === 0) continue;
      } else {
        relevantAssignees = allAssignees;
      }

      if (relevantAssignees.length === 0) {
        const b = getBilling(c.id, "");
        result.push({ customer: c, assigneeUid: "", assigneeName: "", billing: b });
      } else {
        for (const uid of relevantAssignees) {
          const b = getBilling(c.id, uid);
          result.push({
            customer: c,
            assigneeUid: uid,
            assigneeName: uidNameMap.get(uid) || "",
            billing: b,
          });
        }
      }
    }

    // Status filter
    if (statusFilter !== "ALL") {
      return result.filter((r) => (r.billing?.status ?? "none") === statusFilter);
    }
    return result;
  }, [customers, month, customerFilter, statusFilter, billings, profile, visibleUids, uidNameMap]);

  // Total amount
  const totalAmount = useMemo(() => {
    return displayRows.reduce((sum, r) => {
      if ((r.billing?.status ?? "none") === "no_invoice") return sum;
      return sum + (r.billing?.amount ?? 0);
    }, 0);
  }, [displayRows]);

  const invoiceRowCount = useMemo(() => {
    return displayRows.filter((r) => (r.billing?.status ?? "none") !== "no_invoice").length;
  }, [displayRows]);

  const formatMonthLabel = (m: string) => {
    const { y, m: mo } = parseYM(m);
    return `${y}年${mo}月`;
  };

  return (
    <AppShell
      title="請求管理"
      subtitle="請求書の一覧・作成・管理"
      headerRight={
        canEdit ? (
          <Link
            href="/billing/new"
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-sky-700 transition"
          >
            ＋ 請求書を作成
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Filters */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Month navigation */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-extrabold text-sky-700 hover:bg-sky-50"
              >
                ←
              </button>
              <div className="text-sm font-extrabold text-slate-900 tracking-tight">
                {formatMonthLabel(month)}
              </div>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-extrabold text-sky-700 hover:bg-sky-50"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setMonth(ymKey(new Date()))}
                className={clsx(
                  "rounded-md px-2 py-1 text-[11px] font-extrabold transition",
                  month === ymKey(new Date()) ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-sky-700 hover:bg-sky-50",
                )}
              >
                今月
              </button>
            </div>

            {/* Customer select */}
            <div className="relative" ref={customerDropdownRef}>
              <button
                onClick={() => setCustomerDropdownOpen((v) => !v)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-extrabold transition flex items-center gap-1.5",
                  customerFilter ? "bg-sky-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                {customerFilter ? (customers.find((c) => c.id === customerFilter)?.name || "顧客") : "顧客"}
              </button>
              {customerDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-[100] w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
                  <div className="p-2 border-b border-slate-100">
                    <div className="text-[10px] font-bold text-slate-500">顧客を選択</div>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1">
                    <button
                      onClick={() => { setCustomerFilter(""); setCustomerDropdownOpen(false); }}
                      className={clsx(
                        "w-full text-left px-2 py-1.5 rounded-md text-xs font-bold",
                        !customerFilter ? "bg-sky-50 text-sky-700" : "text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      すべて
                    </button>
                    {customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setCustomerFilter(c.id); setCustomerDropdownOpen(false); }}
                        className={clsx(
                          "w-full text-left px-2 py-1.5 rounded-md text-xs font-bold truncate",
                          customerFilter === c.id ? "bg-sky-50 text-sky-700" : "text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Status select */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as BillingStatus | "ALL")}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-extrabold text-slate-700"
            >
              <option value="ALL">すべてのステータス</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{statusLabel(opt)}</option>
              ))}
            </select>

            {/* Summary */}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs font-extrabold text-slate-600">
                請求対象: {invoiceRowCount}件
              </span>
              <span className="text-xs font-extrabold text-slate-600">
                合計: <span className="text-sky-700">{yen(totalAmount)}</span>
              </span>
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-[800px] w-full text-[12px] font-bold border-collapse">
            <thead className="bg-sky-50 text-[11px] font-extrabold text-slate-900 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left whitespace-nowrap border-b border-slate-200">顧客</th>
                <th className="px-3 py-2 text-left whitespace-nowrap border-b border-slate-200">担当者</th>
                <th className="px-3 py-2 text-center whitespace-nowrap border-b border-slate-200">ステータス</th>
                <th className="px-3 py-2 text-right whitespace-nowrap border-b border-slate-200">金額</th>
                <th className="px-3 py-2 text-center whitespace-nowrap border-b border-slate-200">PDF</th>
                {canEdit && (
                  <th className="px-3 py-2 text-center whitespace-nowrap border-b border-slate-200">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-sm font-bold text-slate-500">読み込み中...</td></tr>
              ) : displayRows.length === 0 ? (
                <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-sm font-bold text-slate-500">該当する顧客がありません</td></tr>
              ) : (
                displayRows.map((row, idx) => {
                  const b = row.billing;
                  const status = b?.status ?? "none";
                  const amount = b?.amount ?? 0;
                  const hasPdf = !!b?.pdfGeneratedAt;

                  return (
                    <tr
                      key={`${row.customer.id}_${row.assigneeUid || "_"}`}
                      onClick={() => b ? router.push(`/billing/${b.id}`) : undefined}
                      className={clsx(
                        "border-b border-slate-100 transition",
                        b ? "cursor-pointer hover:bg-sky-50/50" : "",
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                      )}
                    >
                      <td className="px-3 py-2.5 text-left font-extrabold text-slate-900 whitespace-nowrap">
                        <div className="truncate max-w-[200px]" title={row.customer.name}>{row.customer.name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-left text-slate-600">
                        <div className="truncate max-w-[120px]" title={row.assigneeName}>
                          {row.assigneeName || <span className="text-slate-300">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold", statusColor(status))}>
                          {statusLabel(status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-900 whitespace-nowrap">
                        {status === "no_invoice" ? <span className="text-slate-400">—</span> : amount > 0 ? yen(amount) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {hasPdf ? (
                          <button
                            onClick={() => handleDownloadPdf(row)}
                            disabled={downloadingPdfKey === `${row.customer.id}_${row.assigneeUid || "_"}`}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700 hover:bg-emerald-200 transition"
                          >
                            {downloadingPdfKey === `${row.customer.id}_${row.assigneeUid || "_"}` ? (
                              <>生成中...</>
                            ) : (
                              <>
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                PDF
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              const params = new URLSearchParams();
                              params.set("customerId", row.customer.id);
                              if (row.assigneeUid) params.set("assigneeUid", row.assigneeUid);
                              params.set("month", month);
                              if (amount > 0) params.set("amount", String(amount));
                              router.push(`/billing/new?${params.toString()}`);
                            }}
                            className="rounded-md bg-sky-600 px-3 py-1 text-[11px] font-extrabold text-white hover:bg-sky-700 transition"
                          >
                            発行
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
