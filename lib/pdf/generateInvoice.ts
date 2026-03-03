import { jsPDF } from "jspdf";

export type InvoiceData = {
  issuerCompanyName: string;
  issuerCorporateNumber?: string;
  issuerPostalCode?: string;
  issuerAddress?: string;
  issuerTel?: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  recipientName: string;
  recipientContactName?: string;
  recipientAddress?: string;
  invoiceNumber: string;
  issueDate: string;
  billingMonth: string;
  amount: number;
  taxType: "included" | "excluded";
};

let fontBase64Cache: string | null = null;

async function loadFont(pdf: jsPDF) {
  if (!fontBase64Cache) {
    const res = await fetch("/fonts/NotoSansJP-Regular.ttf");
    const buf = await res.arrayBuffer();
    fontBase64Cache = btoa(
      new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ""),
    );
  }
  pdf.addFileToVFS("NotoSansJP-Regular.ttf", fontBase64Cache);
  pdf.addFont("NotoSansJP-Regular.ttf", "NotoSansJP", "normal");
}

function yen(n: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
}

function drawLine(pdf: jsPDF, x1: number, y: number, x2: number, color = "#cbd5e1") {
  pdf.setDrawColor(color);
  pdf.setLineWidth(0.3);
  pdf.line(x1, y, x2, y);
}

export async function generateInvoice(data: InvoiceData) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await loadFont(pdf);
  pdf.setFont("NotoSansJP", "normal");

  const pageW = 210;
  const marginL = 20;
  const marginR = 20;
  const contentW = pageW - marginL - marginR;
  let y = 20;

  // --- タイトル ---
  pdf.setFontSize(24);
  pdf.setTextColor("#1e293b");
  pdf.text("請求書", pageW / 2, y, { align: "center" });
  y += 12;

  // --- 請求番号・発行日（右上） ---
  pdf.setFontSize(9);
  pdf.setTextColor("#64748b");
  const rightX = pageW - marginR;
  pdf.text(`請求番号: ${data.invoiceNumber}`, rightX, y, { align: "right" });
  y += 5;
  pdf.text(`発行日: ${data.issueDate}`, rightX, y, { align: "right" });
  y += 10;

  // --- 宛先（左）と 発行元（右）を並列 ---
  const colLeftX = marginL;
  const colRightX = pageW / 2 + 10;
  let leftY = y;
  let rightY = y;

  // 宛先
  pdf.setFontSize(14);
  pdf.setTextColor("#0f172a");
  pdf.text(`${data.recipientName}  御中`, colLeftX, leftY);
  leftY += 8;

  if (data.recipientAddress) {
    pdf.setFontSize(9);
    pdf.setTextColor("#475569");
    pdf.text(data.recipientAddress, colLeftX, leftY);
    leftY += 5;
  }
  if (data.recipientContactName) {
    pdf.setFontSize(9);
    pdf.setTextColor("#475569");
    pdf.text(`担当: ${data.recipientContactName}`, colLeftX, leftY);
    leftY += 5;
  }

  // 発行元
  pdf.setFontSize(10);
  pdf.setTextColor("#0f172a");
  pdf.text(data.issuerCompanyName, colRightX, rightY);
  rightY += 5;
  pdf.setFontSize(8);
  pdf.setTextColor("#64748b");
  if (data.issuerCorporateNumber) {
    pdf.text(`法人番号: ${data.issuerCorporateNumber}`, colRightX, rightY);
    rightY += 4;
  }
  if (data.issuerPostalCode) {
    pdf.text(`〒${data.issuerPostalCode}`, colRightX, rightY);
    rightY += 4;
  }
  if (data.issuerAddress) {
    pdf.text(data.issuerAddress, colRightX, rightY);
    rightY += 4;
  }
  if (data.issuerTel) {
    pdf.text(`TEL: ${data.issuerTel}`, colRightX, rightY);
    rightY += 4;
  }

  y = Math.max(leftY, rightY) + 10;

  // --- ご請求金額 ---
  drawLine(pdf, marginL, y, pageW - marginR, "#e2e8f0");
  y += 8;
  pdf.setFontSize(11);
  pdf.setTextColor("#475569");
  pdf.text("ご請求金額", marginL, y);
  y += 8;

  let totalAmount: number;
  let subtotal: number;
  let tax: number;

  if (data.taxType === "excluded") {
    subtotal = data.amount;
    tax = Math.floor(data.amount * 0.1);
    totalAmount = subtotal + tax;
  } else {
    totalAmount = data.amount;
    subtotal = data.amount;
    tax = 0;
  }

  pdf.setFontSize(22);
  pdf.setTextColor("#0f172a");
  pdf.text(yen(totalAmount), marginL, y);
  y += 4;

  if (data.taxType === "included") {
    pdf.setFontSize(8);
    pdf.setTextColor("#94a3b8");
    pdf.text("（税込）", marginL, y + 4);
    y += 8;
  } else {
    y += 2;
  }

  y += 6;

  // --- 明細テーブル ---
  const tableX = marginL;
  const tableW = contentW;
  const col1W = tableW * 0.15; // 項目
  const col2W = tableW * 0.55; // 内容
  const col3W = tableW * 0.30; // 金額

  // ヘッダー
  pdf.setFillColor("#f1f5f9");
  pdf.rect(tableX, y, tableW, 8, "F");
  pdf.setFontSize(8);
  pdf.setTextColor("#475569");
  pdf.text("項目", tableX + 3, y + 5.5);
  pdf.text("内容", tableX + col1W + 3, y + 5.5);
  pdf.text("金額", tableX + col1W + col2W + col3W - 3, y + 5.5, { align: "right" });
  y += 8;

  // 明細行
  drawLine(pdf, tableX, y, tableX + tableW, "#e2e8f0");
  y += 6;
  pdf.setFontSize(9);
  pdf.setTextColor("#1e293b");
  pdf.text("業務委託費", tableX + 3, y);
  pdf.text(`${data.billingMonth} 業務委託費`, tableX + col1W + 3, y);
  pdf.text(yen(data.amount), tableX + col1W + col2W + col3W - 3, y, { align: "right" });
  y += 6;
  drawLine(pdf, tableX, y, tableX + tableW, "#e2e8f0");
  y += 8;

  // 小計・消費税・合計
  const sumColX = tableX + col1W + col2W;
  const sumValX = tableX + col1W + col2W + col3W - 3;

  if (data.taxType === "excluded") {
    pdf.setFontSize(9);
    pdf.setTextColor("#475569");
    pdf.text("小計", sumColX + 3, y);
    pdf.setTextColor("#1e293b");
    pdf.text(yen(subtotal), sumValX, y, { align: "right" });
    y += 6;

    pdf.setTextColor("#475569");
    pdf.text("消費税（10%）", sumColX + 3, y);
    pdf.setTextColor("#1e293b");
    pdf.text(yen(tax), sumValX, y, { align: "right" });
    y += 6;

    drawLine(pdf, sumColX, y, tableX + tableW, "#1e293b");
    y += 6;

    pdf.setFontSize(11);
    pdf.setTextColor("#475569");
    pdf.text("合計", sumColX + 3, y);
    pdf.setTextColor("#0f172a");
    pdf.text(yen(totalAmount), sumValX, y, { align: "right" });
    y += 10;
  } else {
    pdf.setFontSize(9);
    pdf.setTextColor("#475569");
    pdf.text("合計", sumColX + 3, y);
    pdf.setTextColor("#0f172a");
    pdf.setFontSize(11);
    pdf.text(yen(totalAmount), sumValX, y, { align: "right" });
    y += 6;

    pdf.setFontSize(8);
    pdf.setTextColor("#94a3b8");
    pdf.text("上記金額には消費税が含まれています", tableX, y);
    y += 10;
  }

  y += 4;

  // --- 振込先情報 ---
  drawLine(pdf, marginL, y, pageW - marginR, "#e2e8f0");
  y += 8;
  pdf.setFontSize(11);
  pdf.setTextColor("#475569");
  pdf.text("お振込先", marginL, y);
  y += 7;

  pdf.setFontSize(9);
  pdf.setTextColor("#1e293b");
  pdf.text(`${data.bankName}  ${data.branchName}`, marginL, y);
  y += 5;
  pdf.text(`${data.accountType}  ${data.accountNumber}`, marginL, y);
  y += 5;
  pdf.text(`口座名義: ${data.accountHolder}`, marginL, y);
  y += 10;

  // --- 備考 ---
  drawLine(pdf, marginL, y, pageW - marginR, "#e2e8f0");
  y += 8;
  pdf.setFontSize(11);
  pdf.setTextColor("#475569");
  pdf.text("備考", marginL, y);
  y += 7;

  pdf.setFontSize(8);
  pdf.setTextColor("#64748b");
  pdf.text("お振込手数料はお客様ご負担でお願いいたします。", marginL, y);
  y += 5;
  pdf.text(`お支払い期限: ${data.billingMonth.replace(/(\d+)月度/, "$1月末日")}`, marginL, y);

  // --- Blob を返す ---
  const fileName = `請求書_${data.recipientName}_${data.billingMonth}.pdf`;
  const blob = pdf.output("blob");
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, fileName };
}
