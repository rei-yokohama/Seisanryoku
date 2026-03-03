"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { InvoiceData } from "../../../lib/pdf/generateInvoice";
import { AppShell } from "../../AppShell";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import {
  type MemberProfile,
  type Customer,
  type IssuerProfile,
  type BillingRecord,
  clsx,
  statusLabel,
  statusColor,
  yen,
  parseYM,
} from "../../../lib/billing";

export default function BillingDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [billing, setBilling] = useState<BillingRecord | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [issuerProfile, setIssuerProfile] = useState<IssuerProfile | null>(null);
  const [issuerProfiles, setIssuerProfiles] = useState<IssuerProfile[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canGeneratePdf, setCanGeneratePdf] = useState(false);

  // PDF state
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfResult, setPdfResult] = useState<{ blobUrl: string; fileName: string } | null>(null);
  const [pdfTaxType, setPdfTaxType] = useState<"included" | "excluded">("included");
  const [pdfProfileId, setPdfProfileId] = useState("");
  const [showPdfDialog, setShowPdfDialog] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setLoading(false); router.push("/login"); return; }
      try {
        setError("");
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof?.companyCode) { setLoading(false); return; }
        setProfile(prof);

        // Check permissions
        const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
        const owner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
        if (owner) {
          setCanEdit(true);
          setCanGeneratePdf(true);
        } else {
          try {
            const msSnap = await getDoc(doc(db, "workspaceMemberships", `${prof.companyCode}_${u.uid}`));
            if (msSnap.exists()) {
              const bp = (msSnap.data() as any).billingPermissions || {};
              setCanEdit(bp.canEdit === true);
              setCanGeneratePdf(bp.canGeneratePdf === true);
            }
          } catch {}
        }

        // Load billing record
        const billingSnap = await getDoc(doc(db, "billings", id));
        if (!billingSnap.exists()) {
          setError("請求書が見つかりません");
          setLoading(false);
          return;
        }
        const billData = { ...billingSnap.data(), id: billingSnap.id } as BillingRecord;
        setBilling(billData);
        setPdfTaxType(billData.taxType || "included");

        // Load customer
        if (billData.customerId) {
          try {
            const custSnap = await getDoc(doc(db, "customers", billData.customerId));
            if (custSnap.exists()) {
              setCustomer({ id: custSnap.id, ...custSnap.data() } as Customer);
            }
          } catch {}
        }

        // Load issuer profiles
        try {
          const bsSnap = await getDoc(doc(db, "billingSettings", prof.companyCode));
          if (bsSnap.exists()) {
            const bsData = bsSnap.data() as any;
            if (Array.isArray(bsData.profiles)) {
              setIssuerProfiles(bsData.profiles);
              // Resolve issuer profile
              const resolved = billData.issuerProfileId
                ? bsData.profiles.find((p: IssuerProfile) => p.id === billData.issuerProfileId)
                : bsData.profiles.find((p: IssuerProfile) => p.isDefault) || bsData.profiles[0];
              if (resolved) {
                setIssuerProfile(resolved);
                setPdfProfileId(resolved.id);
              }
            }
          }
        } catch {}
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [id, router]);

  const openPdfDialog = () => {
    setPdfResult(null);
    setShowPdfDialog(true);
  };

  const closePdfDialog = () => {
    if (pdfResult) URL.revokeObjectURL(pdfResult.blobUrl);
    setPdfResult(null);
    setShowPdfDialog(false);
  };

  const handleGeneratePdf = async () => {
    if (!billing) return;
    const ip = issuerProfiles.find((p) => p.id === pdfProfileId);
    if (!ip) { alert("発行元プロファイルを選択してください"); return; }
    const amount = billing.amount ?? 0;
    if (amount <= 0) { alert("請求金額が0です"); return; }

    const { m } = parseYM(billing.month);
    const invoiceNumber = billing.invoiceNumber || billing.id.slice(0, 12);
    const issueDateStr = billing.issueDate || new Date().toISOString().slice(0, 10).replace(/-/g, "/");

    const invoiceData: InvoiceData = {
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
      recipientName: billing.customerName || customer?.name || "",
      recipientContactName: customer?.contactName || undefined,
      recipientAddress: customer?.address || undefined,
      invoiceNumber,
      issueDate: issueDateStr,
      billingMonth: `${m}月度`,
      amount,
      taxType: pdfTaxType,
    };

    setPdfGenerating(true);
    try {
      const { generateInvoice } = await import("../../../lib/pdf/generateInvoice");
      const result = await generateInvoice(invoiceData);

      // Record PDF generation timestamp
      await updateDoc(doc(db, "billings", billing.id), {
        pdfGeneratedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      setBilling((prev) => prev ? { ...prev, pdfGeneratedAt: Timestamp.now() } : prev);

      setPdfResult(result);
    } catch (e: any) {
      console.error("PDF生成失敗:", e);
      alert("PDF生成に失敗しました: " + (e?.message || ""));
    } finally {
      setPdfGenerating(false);
    }
  };

  const hasPdf = !!billing?.pdfGeneratedAt;
  const displayNumber = billing?.invoiceNumber || id.slice(0, 12);
  const custName = billing?.customerName || customer?.name || "—";
  const assignee = billing?.assigneeName || "";

  const computeTax = () => {
    if (!billing) return { subtotal: 0, tax: 0, total: 0 };
    const amt = billing.amount ?? 0;
    const tt = billing.taxType || pdfTaxType;
    if (tt === "excluded") {
      const tax = Math.floor(amt * 0.1);
      return { subtotal: amt, tax, total: amt + tax };
    }
    return { subtotal: amt, tax: 0, total: amt };
  };

  const { subtotal, tax, total } = computeTax();

  if (loading) {
    return (
      <AppShell title="請求書詳細" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (error && !billing) {
    return (
      <AppShell title="請求書詳細" subtitle="">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>
        <div className="mt-4">
          <Link href="/billing" className="text-sm font-bold text-sky-600 hover:underline">← 一覧に戻る</Link>
        </div>
      </AppShell>
    );
  }

  if (!billing) return null;

  return (
    <AppShell
      title="請求書詳細"
      subtitle={displayNumber}
      headerRight={
        <div className="flex items-center gap-2">
          {canEdit && (
            <Link
              href={`/billing/${id}/edit`}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              編集
            </Link>
          )}
          {canGeneratePdf && billing.status !== "no_invoice" && (billing.amount ?? 0) > 0 && issuerProfiles.length > 0 && (
            <button
              onClick={openPdfDialog}
              className={clsx(
                "rounded-md px-4 py-2 text-sm font-extrabold transition",
                hasPdf
                  ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  : "bg-sky-600 text-white hover:bg-sky-700",
              )}
            >
              {hasPdf ? "再発行" : "PDF発行"}
            </button>
          )}
        </div>
      }
    >
      <div className="mb-4">
        <Link href="/billing" className="text-sm font-bold text-sky-600 hover:underline">← 一覧に戻る</Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Main info card */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-extrabold text-slate-900">{displayNumber}</div>
              <div className="text-sm text-slate-500 mt-0.5">{custName}</div>
            </div>
            <span className={clsx("inline-flex items-center rounded-full px-3 py-1.5 text-xs font-extrabold", statusColor(billing.status))}>
              {statusLabel(billing.status)}
            </span>
          </div>

          <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-extrabold text-slate-400">担当者</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{assignee || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] font-extrabold text-slate-400">請求月</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {(() => { const { y, m } = parseYM(billing.month); return `${y}年${m}月`; })()}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-extrabold text-slate-400">発行日</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{billing.issueDate || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] font-extrabold text-slate-400">消費税</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {(billing.taxType || "included") === "included" ? "税込" : "税抜（+10%）"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-extrabold text-slate-400">請求日</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{billing.billingDate || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] font-extrabold text-slate-400">支払い期限</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{billing.dueDate || "—"}</div>
            </div>
          </div>

          {/* Item */}
          {(billing.itemName || billing.itemDescription) && (
            <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-extrabold text-slate-400">項目</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">{billing.itemName || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] font-extrabold text-slate-400">内容</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">{billing.itemDescription || "—"}</div>
              </div>
            </div>
          )}

          {/* Amount section */}
          <div className="border-t border-slate-100 pt-4">
            <div className="text-[11px] font-extrabold text-slate-400">請求金額</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{yen(total)}</div>
            {billing.taxType === "excluded" && (
              <div className="text-xs text-slate-500 mt-1">
                小計: {yen(subtotal)} ／ 消費税（10%）: {yen(tax)}
              </div>
            )}
            {(billing.taxType || "included") === "included" && (
              <div className="text-xs text-slate-400 mt-1">（税込）</div>
            )}
          </div>

          {/* Notes */}
          {billing.notes && (
            <div className="border-t border-slate-100 pt-4">
              <div className="text-[11px] font-extrabold text-slate-400">備考</div>
              <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{billing.notes}</div>
            </div>
          )}

          {/* PDF status */}
          {billing.pdfGeneratedAt && (
            <div className="border-t border-slate-100 pt-4">
              <div className="text-[11px] font-extrabold text-slate-400">PDF発行日時</div>
              <div className="text-sm font-bold text-emerald-700 mt-0.5">
                {billing.pdfGeneratedAt.toDate?.()
                  ? billing.pdfGeneratedAt.toDate().toLocaleString("ja-JP")
                  : "発行済"}
              </div>
            </div>
          )}
        </div>

        {/* Issuer info card */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="text-sm font-extrabold text-slate-700">発行元情報</div>
          {issuerProfile ? (
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-[11px] font-extrabold text-slate-400">プロファイル名</div>
                <div className="font-bold text-slate-900 mt-0.5">{issuerProfile.name}</div>
              </div>
              <div>
                <div className="text-[11px] font-extrabold text-slate-400">会社名</div>
                <div className="font-bold text-slate-900 mt-0.5">{issuerProfile.companyName}</div>
              </div>
              {issuerProfile.corporateNumber && (
                <div>
                  <div className="text-[11px] font-extrabold text-slate-400">法人番号</div>
                  <div className="text-slate-700 mt-0.5">{issuerProfile.corporateNumber}</div>
                </div>
              )}
              {issuerProfile.address && (
                <div>
                  <div className="text-[11px] font-extrabold text-slate-400">住所</div>
                  <div className="text-slate-700 mt-0.5">
                    {issuerProfile.postalCode && `〒${issuerProfile.postalCode} `}
                    {issuerProfile.address}
                  </div>
                </div>
              )}
              {issuerProfile.tel && (
                <div>
                  <div className="text-[11px] font-extrabold text-slate-400">電話番号</div>
                  <div className="text-slate-700 mt-0.5">{issuerProfile.tel}</div>
                </div>
              )}

              <div className="border-t border-slate-100 pt-3 mt-3">
                <div className="text-sm font-extrabold text-slate-700 mb-2">振込先</div>
                <div className="text-slate-700">
                  {issuerProfile.bankName} {issuerProfile.branchName}
                </div>
                <div className="text-slate-700">
                  {issuerProfile.accountType} {issuerProfile.accountNumber}
                </div>
                <div className="text-slate-700">
                  口座名義: {issuerProfile.accountHolder}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">発行元プロファイルが設定されていません</div>
          )}

          {/* Customer info */}
          {customer && (
            <div className="border-t border-slate-100 pt-4">
              <div className="text-sm font-extrabold text-slate-700 mb-2">顧客情報</div>
              <div className="space-y-1 text-sm">
                <div className="font-bold text-slate-900">{customer.name}</div>
                {customer.contactName && <div className="text-slate-600">担当: {customer.contactName}</div>}
                {customer.address && <div className="text-slate-600">{customer.address}</div>}
              </div>
              <Link
                href={`/customers/${customer.id}`}
                className="inline-block mt-2 text-xs font-bold text-sky-600 hover:underline"
              >
                顧客詳細 →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* PDF Dialog */}
      {showPdfDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl mx-4">
            {pdfResult ? (
              <>
                <div className="flex flex-col items-center text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                    <svg className="h-7 w-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div className="mt-3 text-base font-extrabold text-slate-900">請求書を生成しました</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{custName}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{pdfResult.fileName}</div>
                </div>
                <div className="mt-5 flex flex-col gap-2">
                  <a
                    href={pdfResult.blobUrl}
                    download={pdfResult.fileName}
                    className="flex items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-sky-700 transition"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    ダウンロード
                  </a>
                  <button
                    onClick={closePdfDialog}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    閉じる
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-base font-extrabold text-slate-900">請求書PDF発行</div>
                <div className="mt-1 text-xs font-bold text-slate-500">{custName}</div>

                {issuerProfiles.length > 1 && (
                  <div className="mt-4">
                    <label className="text-xs font-bold text-slate-600">発行元プロファイル</label>
                    <select
                      value={pdfProfileId}
                      onChange={(e) => setPdfProfileId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      {issuerProfiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (デフォルト)" : ""}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="mt-4">
                  <label className="text-xs font-bold text-slate-600">消費税</label>
                  <div className="mt-2 flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="pdfTaxType" value="included" checked={pdfTaxType === "included"} onChange={() => setPdfTaxType("included")} className="h-4 w-4 text-sky-600 focus:ring-sky-500" />
                      <span className="text-sm font-bold text-slate-700">税込</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="pdfTaxType" value="excluded" checked={pdfTaxType === "excluded"} onChange={() => setPdfTaxType("excluded")} className="h-4 w-4 text-sky-600 focus:ring-sky-500" />
                      <span className="text-sm font-bold text-slate-700">税抜（+10%）</span>
                    </label>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-2">
                  <button onClick={closePdfDialog} disabled={pdfGenerating} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    キャンセル
                  </button>
                  <button onClick={handleGeneratePdf} disabled={pdfGenerating} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-sky-700 disabled:bg-sky-400 transition">
                    {pdfGenerating ? "生成中..." : "生成"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
