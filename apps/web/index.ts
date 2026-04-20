import express, { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { loadEnv } from "../../src/config/env.js";
import { extractCoupon, type CheckExtraction, type CouponExtraction, type IncomeExtraction, type OcrPayload } from "../../src/comparison/index.js";
import { amountsEqual, fuzzyAddressMatch, fuzzyNameMatch, normalizeForCompare, toAmount, toDigits } from "../../src/comparison/normalization.js";
import { parseOcrText } from "../../src/comparison/ocr-parser.js";
import { DEFAULT_TEST_PAYLOAD, type JsonRecord, saveOcrArtifact, sendToPowerAutomate } from "../../src/sharepoint/index.js";
import { processOcrPayload, runBatchWorkflow, type StoredCase } from "../../src/worker/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SharePointEnv = {
  POWER_AUTOMATE_WEBHOOK_URL?: string;
};

type CheckRow = {
  field: string;
  expected: string | null;
  actual: string | null;
  status: "match" | "mismatch" | "missing" | "partial";
  weight: number;
  notes?: string;
};

type ExtractField<T> = {
  rule: string;
  value: T | null;
  present: boolean;
  meta?: unknown;
};

type ExtractReport = {
  generatedAt?: string;
  fields?: Record<string, ExtractField<unknown>>;
  rawTextPreview?: string;
};

type CouponExtractReport = ExtractReport & {
  allOptions?: CouponExtraction["options"];
  input?: {
    imageLink?: string | null;
  };
};

type CheckExtractReport = ExtractReport;

type NavigaSubscriptionSummary = {
  capturedAt?: string;
  url?: string;
  subscriptionId?: string | null;
  subscriber?: {
    name?: string | null;
    id?: string | null;
  };
  deliveryAddress?: string | null;
  promotion?: string | null;
  termDetails?: {
    term?: string | null;
  };
  pricingDetails?: {
    total?: string | number | null;
  };
};

type WorkflowRunStatus = "queued" | "running" | "succeeded" | "failed";

type WorkflowRunState = {
  workflowId: string;
  status: WorkflowRunStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: {
    message: string;
    stack?: string;
  };
};

type CasePipelineStatus = {
  version: 1;
  updatedAt: string;
  ocrExtraction?: {
    status: "succeeded" | "failed";
    finishedAt: string;
    error?: {
      message: string;
      stack?: string;
    };
  };
  subscriptionWorkflow?: WorkflowRunState;
  batchWorkflow?: WorkflowRunState;
};

type CaseArtifacts = {
  checkExtract: CheckExtractReport | null;
  couponExtract: CouponExtractReport | null;
  navigaSummary: NavigaSubscriptionSummary | null;
  pipeline: CasePipelineStatus | null;
};

function getIncomeExtraction(c: StoredCase): IncomeExtraction {
  return c.incomeExtraction;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}

async function readFirstJsonOrNull<T>(dirPath: string, fileNames: string[]): Promise<T | null> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return null;
  }

  const requested = new Set(fileNames.map((name) => name.toLowerCase()));
  const match = entries.find((entry) => requested.has(entry.toLowerCase()));
  return match ? readJsonOrNull<T>(path.join(dirPath, match)) : null;
}

async function readCaseArtifacts(casesDir: string, caseId: string): Promise<CaseArtifacts> {
  const caseDir = path.join(casesDir, caseId);
  const [checkExtract, couponExtract, navigaSummary, pipeline] = await Promise.all([
    readFirstJsonOrNull<CheckExtractReport>(caseDir, ["check-extract.json"]),
    readFirstJsonOrNull<CouponExtractReport>(caseDir, ["coupon-extract.json"]),
    readFirstJsonOrNull<NavigaSubscriptionSummary>(caseDir, [
      "naviga-subscription-summary.json",
      "Naviga-subscription-summary.json",
    ]),
    readFirstJsonOrNull<CasePipelineStatus>(caseDir, ["pipeline.json"]),
  ]);

  return {
    checkExtract,
    couponExtract,
    navigaSummary,
    pipeline,
  };
}

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '<span class="field-value null">—</span>';
  return `<span class="field-value">${esc(String(value))}</span>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fieldRow(label: string, value: string | number | null | undefined): string {
  return `<div class="field-row"><span class="field-label">${esc(label)}</span>${fmt(value)}</div>`;
}

function emptyFieldRow(label: string): string {
  return `<div class="field-row field-row-empty"><span class="field-label">${esc(label)}</span><span class="field-value null"></span></div>`;
}

function formatCurrency(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `$${value.toFixed(2)}`;
}

function extractFieldValue<T>(report: ExtractReport | null, fieldName: string): T | null {
  const value = report?.fields?.[fieldName]?.value;
  return value === undefined ? null : (value as T | null);
}

function normalizeOptional(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function firstValue<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      if (typeof value === "string" && value.trim().length === 0) continue;
      return value;
    }
  }

  return null;
}

function normalizeAmount(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return toAmount(value ?? null);
}

function compareNames(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return normalizeForCompare(left) === normalizeForCompare(right) || fuzzyNameMatch(left, right);
}

function compareAddresses(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return normalizeForCompare(left) === normalizeForCompare(right) || fuzzyAddressMatch(left, right);
}

function allPairwise<T>(values: [T | null, T | null, T | null], compare: (left: T | null, right: T | null) => boolean): boolean {
  const [first, second, third] = values;
  return compare(first, second) && compare(first, third) && compare(second, third);
}

function englishUnder100(value: number): string | null {
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (value < 0 || value >= 100 || !Number.isInteger(value)) return null;
  if (value < 10) return ones[value];
  if (value < 20) return teens[value - 10];
  const ten = Math.floor(value / 10);
  const one = value % 10;
  return one === 0 ? tens[ten] : `${tens[ten]} ${ones[one]}`;
}

function frenchUnder100(value: number): string | null {
  const ones = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"];
  const teens = ["dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
  if (value < 0 || value >= 100 || !Number.isInteger(value)) return null;
  if (value < 10) return ones[value];
  if (value < 17) return teens[value - 10];
  if (value < 20) return `dix ${ones[value - 10]}`;
  if (value < 70) {
    const tensWords: Record<number, string> = {
      20: "vingt",
      30: "trente",
      40: "quarante",
      50: "cinquante",
      60: "soixante",
    };
    const ten = Math.floor(value / 10) * 10;
    const one = value % 10;
    return one === 0 ? tensWords[ten] : `${tensWords[ten]} ${one === 1 ? "et " : ""}${ones[one]}`;
  }
  if (value < 80) {
    const remainder = value - 60;
    return remainder === 11 ? "soixante et onze" : `soixante ${frenchUnder100(remainder)}`;
  }
  if (value < 90) {
    const remainder = value - 80;
    return remainder === 0 ? "quatre vingt" : `quatre vingt ${ones[remainder]}`;
  }

  return `quatre vingt ${frenchUnder100(value - 80)}`;
}

function amountWordsMatch(amount: number | null, words: string | null): boolean {
  if (amount === null || !words) return false;
  const normalized = normalizeForCompare(words);
  const cents = Math.round((amount - Math.floor(amount)) * 100);
  const centsText = String(cents).padStart(2, "0");
  const centsMatch = normalized.includes(centsText) || normalized.includes(`${cents} 100`);
  const whole = Math.floor(amount);
  const wholeWords = [englishUnder100(whole), frenchUnder100(whole)]
    .filter((value): value is string => value !== null)
    .map((value) => normalizeForCompare(value));
  const wholeMatch = normalized.includes(String(whole)) || wholeWords.some((value) => normalized.includes(value));
  return centsMatch && wholeMatch;
}

type ValidationStatus = "ok" | "warning" | "error";

type ValidationRow = {
  label: string;
  status: ValidationStatus;
  message: string;
  naviga?: string | number | null;
  coupon?: string | number | null;
  check?: string | number | null;
};

function validationBadge(status: ValidationStatus): string {
  const label = status === "ok" ? "OK" : status === "warning" ? "Warning" : "Error";
  const icon = status === "ok" ? "✓" : status === "warning" ? "!" : "×";
  return `<span class="validation-badge ${status}"><span class="status-icon">${icon}</span>${label}</span>`;
}

function validationValue(label: string, value: string | number | null | undefined): string {
  return `<span class="validation-value"><span>${esc(label)}</span>${fmt(value)}</span>`;
}

function formatCheckFieldName(field: string): string {
  const labels: Record<string, string> = {
    subscriberClientNumber: "Client number",
    billToNameId: "Bill-to name ID",
    subscriberName: "Subscriber name",
    billToOrRenewalName: "Bill-to or renewal name",
    paymentAmount: "Payment amount",
    renewalDate: "Renewal date",
    productName: "Product name",
    selectedOptionAmount: "Selected option amount",
    selectedOptionTerm: "Selected option term",
    payerAddress: "Payer address",
  };

  return labels[field] ?? field;
}

function getLanUrls(port: number): string[] {
  const interfaces = os.networkInterfaces();
  const lanUrls = new Set<string>();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family !== "IPv4" || address.internal) continue;
      lanUrls.add(`http://${address.address}:${port}/`);
    }
  }

  return Array.from(lanUrls).sort();
}

function statusBadge(status: string): string {
  return `<span class="status-badge ${esc(status)}">${esc(status)}</span>`;
}

function layout(title: string, breadcrumb: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)} — Naviga Review</title>
  <link rel="stylesheet" href="/style.css"/>
</head>
<body>
  <header class="site-header">
    <h1>Naviga Review</h1>
    ${breadcrumb}
  </header>
  <div class="container">
    ${body}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

function casePipelineOutcome(pipeline: CasePipelineStatus | null): WorkflowRunStatus | "pending" {
  const statuses = [
    pipeline?.ocrExtraction?.status,
    pipeline?.batchWorkflow?.status,
    pipeline?.subscriptionWorkflow?.status,
  ];
  if (statuses.includes("failed")) return "failed";
  if (pipeline?.ocrExtraction?.status === "succeeded" && pipeline?.batchWorkflow?.status === "succeeded") return "succeeded";
  return pipeline?.batchWorkflow?.status ?? pipeline?.ocrExtraction?.status ?? "pending";
}

function caseListHtml(rows: { c: StoredCase; pipeline: CasePipelineStatus | null }[]): string {
  const tableRows = rows.map(({ c, pipeline }) => {
    const status = casePipelineOutcome(pipeline);
    const score = c.verification?.bestCandidate?.score ?? "—";
    const subscriberName = c.subscription?.subscriberName ?? c.ocrExtraction.subscriberName ?? "—";
    const productName = c.subscription?.productName ?? c.ocrExtraction.productName ?? "—";
    return `<tr>
      <td><a href="/cases/${esc(c.id)}">${esc(c.id)}</a></td>
      <td>${esc(new Date(c.createdAt).toLocaleString())}</td>
      <td>${esc(subscriberName)}</td>
      <td>${esc(productName)}</td>
      <td>${score}</td>
      <td>${statusBadge(status)}</td>
    </tr>`;
  }).join("\n");

  const emptyState = rows.length === 0
    ? `<div class="empty-state">No case history found.</div>`
    : "";

  const body = `
    <div class="page-toolbar">
      <h2 class="page-title">Cases</h2>
      <form method="post" action="/cases/clear" onsubmit="return confirm('Delete all case history? This cannot be undone.');">
        <button type="submit" class="btn btn-danger">Clear history</button>
      </form>
    </div>
    ${emptyState}
    ${rows.length > 0 ? `<table class="cases-table">
      <thead>
        <tr>
          <th>Case ID</th><th>Created</th><th>Subscriber</th><th>Product</th><th>Score</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>` : ""}`;

  return layout("Cases", "", body);
}

function pipelineStageBadge(status: string | null | undefined): string {
  const label = status ?? "pending";
  const icon = label === "succeeded" ? "✓" : label === "failed" ? "×" : label === "running" || label === "queued" ? "…" : "!";
  return `<span class="status-badge ${esc(label)}"><span class="status-icon">${icon}</span>${esc(label)}</span>`;
}

function pipelineSectionHtml(pipeline: CasePipelineStatus | null): string {
  const ocrStatus = pipeline?.ocrExtraction?.status ?? "pending";
  const batchStatus = pipeline?.batchWorkflow?.status;
  const batchError = pipeline?.batchWorkflow?.error;

  const errorHtml = batchError
    ? `<details class="raw-text-wrap" open>
        <summary>Batch workflow error</summary>
        <pre class="raw-text-content">${esc(batchError.stack ?? batchError.message)}</pre>
      </details>`
    : "";

  return `<section class="validate-section">
    <div class="section-heading">
      <h2>Pipeline</h2>
      <span>OCR extraction → batch workflow</span>
    </div>
    <div class="validation-list">
      <div class="validation-row ${esc(ocrStatus === "failed" ? "error" : ocrStatus === "succeeded" ? "ok" : "warning")}">
        <div class="validation-main">
          <div class="validation-title">OCR extraction</div>
          <div class="validation-message">Case intake + coupon/check extraction</div>
        </div>
        ${pipelineStageBadge(ocrStatus as WorkflowRunStatus)}
      </div>
      <div class="validation-row ${esc(batchStatus === "failed" ? "error" : batchStatus === "succeeded" ? "ok" : "warning")}">
        <div class="validation-main">
          <div class="validation-title">Batch workflow</div>
          <div class="validation-message">${pipeline?.batchWorkflow?.workflowId ? esc(pipeline.batchWorkflow.workflowId) : "add-subscription-to-batch"}</div>
        </div>
        ${pipelineStageBadge(batchStatus)}
      </div>
    </div>
    ${errorHtml}
  </section>`;
}

function buildValidationRows(c: StoredCase, artifacts: CaseArtifacts): ValidationRow[] {
  const income = getIncomeExtraction(c);
  const couponOption = extractFieldValue<{ option: string | null; price: string | null }>(artifacts.couponExtract, "selectedOption");
  const navigaName = firstValue(artifacts.navigaSummary?.subscriber?.name, c.subscription?.subscriberName);
  const navigaClientNumber = firstValue(artifacts.navigaSummary?.subscriber?.id, c.subscription?.clientNumber);
  const navigaAddress = firstValue(artifacts.navigaSummary?.deliveryAddress, c.subscription?.billToName);
  const navigaPrice = normalizeAmount(firstValue(artifacts.navigaSummary?.pricingDetails?.total, c.subscription?.totalAmount));

  const couponName = firstValue(
    extractFieldValue<string>(artifacts.couponExtract, "subscriberName"),
    income.coupon.subscriberName,
    c.ocrExtraction.subscriberName,
  );
  const couponClientNumber = firstValue(
    extractFieldValue<string>(artifacts.couponExtract, "subscriberClientNumber"),
    income.coupon.subscriberClientNumber,
    c.ocrExtraction.subscriberClientNumber,
  );
  const couponAddress = firstValue(
    extractFieldValue<string>(artifacts.couponExtract, "payerAddress"),
    income.coupon.payerAddress,
    c.ocrExtraction.payerAddress,
  );
  const couponPrice = normalizeAmount(firstValue<string | number>(couponOption?.price, income.coupon.paymentAmount, c.ocrExtraction.paymentAmount));

  const checkName = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payerName"), income.check.payerName);
  const checkAddress = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payerAddress"), income.check.payerAddress);
  const checkPrice = normalizeAmount(firstValue(extractFieldValue<number>(artifacts.checkExtract, "amountNumber"), income.check.amountNumber));
  const checkAmountWords = firstValue(extractFieldValue<string>(artifacts.checkExtract, "amountWords"), income.check.amountWords);

  const clientNameMatchesCoupon = compareNames(navigaName, couponName);
  const clientNameAllMatch = allPairwise([navigaName, couponName, checkName], compareNames);
  const clientNumberMatches = toDigits(navigaClientNumber) !== null && toDigits(navigaClientNumber) === toDigits(couponClientNumber);
  const addressAllMatch = allPairwise([navigaAddress, couponAddress, checkAddress], compareAddresses);
  const priceAllMatch =
    amountsEqual(navigaPrice, couponPrice) && amountsEqual(navigaPrice, checkPrice) && amountsEqual(couponPrice, checkPrice);
  const wordsMatch = amountWordsMatch(checkPrice, checkAmountWords);

  return [
    {
      label: "Client name",
      status: !clientNameMatchesCoupon ? "error" : clientNameAllMatch ? "ok" : "warning",
      message: !clientNameMatchesCoupon
        ? "Naviga client name does not match coupon client name."
        : clientNameAllMatch
          ? "Naviga, coupon, and check names align."
          : "Naviga and coupon match, but check name differs or is missing.",
      naviga: navigaName,
      coupon: couponName,
      check: checkName,
    },
    {
      label: "Client number",
      status: clientNumberMatches ? "ok" : "error",
      message: clientNumberMatches ? "Naviga and coupon client numbers align." : "Naviga client number does not match coupon client number.",
      naviga: navigaClientNumber,
      coupon: couponClientNumber,
    },
    {
      label: "Address",
      status: addressAllMatch ? "ok" : "warning",
      message: addressAllMatch ? "Naviga, coupon, and check addresses align." : "Address differs across Naviga, coupon, or check.",
      naviga: navigaAddress,
      coupon: couponAddress,
      check: checkAddress,
    },
    {
      label: "Price",
      status: priceAllMatch ? "ok" : "error",
      message: priceAllMatch ? "Naviga, coupon, and check prices align." : "Price differs across Naviga, coupon, or check.",
      naviga: navigaPrice === null ? null : formatCurrency(navigaPrice),
      coupon: couponPrice === null ? null : formatCurrency(couponPrice),
      check: checkPrice === null ? null : formatCurrency(checkPrice),
    },
    {
      label: "Check price words",
      status: wordsMatch ? "ok" : "warning",
      message: wordsMatch ? "Check numeric amount matches amount in words." : "Check numeric amount does not clearly match amount in words.",
      check: [checkPrice === null ? null : formatCurrency(checkPrice), checkAmountWords].filter(Boolean).join(" / ") || null,
    },
  ];
}

function validationSectionHtml(rows: ValidationRow[]): string {
  const rowsHtml = rows.map((row) => {
    const values = [
      validationValue("Naviga", row.naviga),
      validationValue("Coupon", row.coupon),
      validationValue("Check", row.check),
    ].join("");

    return `<div class="validation-row ${row.status}">
      <div class="validation-main">
        <div class="validation-title">${esc(row.label)}</div>
        <div class="validation-message">${esc(row.message)}</div>
        <div class="validation-values">${values}</div>
      </div>
      ${validationBadge(row.status)}
    </div>`;
  }).join("");

  return `<section class="validate-section">
    <div class="section-heading">
      <h2>Validate</h2>
      <span>Required checks after Naviga subscription summary capture</span>
    </div>
    <div class="validation-list">${rowsHtml}</div>
  </section>`;
}

function caseDetailHtml(c: StoredCase, artifacts: CaseArtifacts): string {
  const income = getIncomeExtraction(c);
  const coupon = income.coupon;
  const promoCode = coupon.promoCode ?? (coupon as CouponExtraction & { offerCode?: string | null }).offerCode ?? null;
  const check = income.check;
  const sub = c.subscription;
  const couponOption = extractFieldValue<{ option: string | null; price: string | null }>(artifacts.couponExtract, "selectedOption");
  const validationRows = buildValidationRows(c, artifacts);
  const pipelineHtml = pipelineSectionHtml(artifacts.pipeline);

  const optionsHtml = coupon.options.length
    ? `<ul class="options-list">${coupon.options.map(o => {
        const selected = coupon.selectedOption && (o as unknown as Record<string, unknown>).amount === (coupon.selectedOption as unknown as Record<string, unknown>).amount;
        return `<li class="${selected ? "selected" : ""}">${esc(o.raw)}</li>`;
      }).join("")}</ul>`
    : "";

  const imageHtml = c.imageLink
    ? `<div class="coupon-image-wrap">
        <a href="${esc(c.imageLink)}" target="_blank" rel="noopener">Open coupon image ↗</a>
       </div>`
    : "";

  const couponRawTextHtml = coupon.rawTextPreview
    ? `<details class="raw-text-wrap">
        <summary>Coupon OCR text</summary>
        <pre class="raw-text-content">${esc(coupon.rawTextPreview.replace(/\s*\|\s*/g, "\n"))}</pre>
       </details>`
    : "";

  const checkRawTextHtml = check.rawTextPreview
    ? `<details class="raw-text-wrap">
        <summary>Check OCR text</summary>
        <pre class="raw-text-content">${esc(check.rawTextPreview.replace(/\s*\|\s*/g, "\n"))}</pre>
       </details>`
    : "";
  const navigaSubscriberName = firstValue(artifacts.navigaSummary?.subscriber?.name, sub?.subscriberName);
  const navigaClientNumber = firstValue(artifacts.navigaSummary?.subscriber?.id, sub?.clientNumber);
  const navigaAddress = firstValue(artifacts.navigaSummary?.deliveryAddress, sub?.billToName);
  const navigaPrice = normalizeAmount(firstValue(artifacts.navigaSummary?.pricingDetails?.total, sub?.totalAmount));
  const navigaTerm = firstValue(artifacts.navigaSummary?.termDetails?.term, sub?.renewalTerm, sub?.term);
  const navigaCapturedAt = normalizeOptional(artifacts.navigaSummary?.capturedAt);
  const navigaLinkHtml = artifacts.navigaSummary?.url
    ? `<div class="coupon-image-wrap">
        <a href="${esc(artifacts.navigaSummary.url)}" target="_blank" rel="noopener">Open Naviga page ↗</a>
       </div>`
    : "";
  const couponClientNumber = firstValue(extractFieldValue<string>(artifacts.couponExtract, "subscriberClientNumber"), coupon.subscriberClientNumber);
  const couponSelectedOption = firstValue(couponOption?.option, coupon.selectedOption?.raw);
  const couponPrice = normalizeAmount(firstValue<string | number>(couponOption?.price, coupon.paymentAmount));
  const couponPromoCode = firstValue(extractFieldValue<string>(artifacts.couponExtract, "promoCode"), promoCode);
  const couponRawText = firstValue(artifacts.couponExtract?.rawTextPreview, coupon.rawTextPreview);
  const checkAmount = normalizeAmount(firstValue(extractFieldValue<number>(artifacts.checkExtract, "amountNumber"), check.amountNumber));
  const checkRawText = firstValue(artifacts.checkExtract?.rawTextPreview, check.rawTextPreview);
  const checkNumber = firstValue(extractFieldValue<string>(artifacts.checkExtract, "checkNumber"), check.checkNumber);
  const checkDate = firstValue(extractFieldValue<string>(artifacts.checkExtract, "date"), check.date);
  const checkPayTo = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payTo"), check.payTo);
  const checkName = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payerName"), check.payerName);
  const checkAddress = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payerAddress"), check.payerAddress);
  const checkAmountWords = firstValue(extractFieldValue<string>(artifacts.checkExtract, "amountWords"), check.amountWords);

  const checkCol = `
    <div class="column-card">
      <div class="column-header check">Check extract</div>
      <div class="column-body">
        ${emptyFieldRow("Client number")}
        ${fieldRow("Name", checkName)}
        ${fieldRow("Address", checkAddress)}
        ${emptyFieldRow("Promo code")}
        ${emptyFieldRow("Term/issues")}
        ${fieldRow("Price", formatCurrency(checkAmount))}
        ${fieldRow("Price in words", checkAmountWords)}
        ${fieldRow("Check number", checkNumber)}
        ${fieldRow("Check date", checkDate)}
        ${fieldRow("Pay to", checkPayTo)}
        ${checkRawText ? `<details class="raw-text-wrap">
          <summary>Check extract text</summary>
          <pre class="raw-text-content">${esc(checkRawText.replace(/\s*\|\s*/g, "\n"))}</pre>
        </details>` : checkRawTextHtml}
      </div>
    </div>`;

  const couponCol = `
    <div class="column-card">
      <div class="column-header coupon">Coupon extract</div>
      <div class="column-body">
        ${fieldRow("Client number", couponClientNumber)}
        ${emptyFieldRow("Name")}
        ${emptyFieldRow("Address")}
        ${fieldRow("Promo code", couponPromoCode)}
        ${fieldRow("Term/issues", couponSelectedOption)}
        ${fieldRow("Price", formatCurrency(couponPrice))}
        ${emptyFieldRow("Price in words")}
        ${emptyFieldRow("Check number")}
        ${emptyFieldRow("Check date")}
        ${emptyFieldRow("Pay to")}
        ${optionsHtml ? `<div class="field-row"><span class="field-label">Options</span>${optionsHtml}</div>` : ""}
        ${imageHtml}
        ${couponRawText ? `<details class="raw-text-wrap">
          <summary>Coupon extract text</summary>
          <pre class="raw-text-content">${esc(couponRawText.replace(/\s*\|\s*/g, "\n"))}</pre>
        </details>` : couponRawTextHtml}
      </div>
    </div>`;

  // --- Naviga column ---
  const navigaCol = `
    <div class="column-card">
      <div class="column-header naviga">Naviga subscription summary</div>
      <div class="column-body">
        ${fieldRow("Client number", navigaClientNumber)}
        ${fieldRow("Name", navigaSubscriberName)}
        ${fieldRow("Address", navigaAddress)}
        ${fieldRow("Promo code", artifacts.navigaSummary?.promotion ?? null)}
        ${fieldRow("Term/issues", navigaTerm ? `${navigaTerm} issues` : null)}
        ${fieldRow("Price", formatCurrency(navigaPrice))}
        ${emptyFieldRow("Price in words")}
        ${emptyFieldRow("Check number")}
        ${emptyFieldRow("Check date")}
        ${emptyFieldRow("Pay to")}
        ${fieldRow("Captured", navigaCapturedAt)}
        ${navigaLinkHtml}
      </div>
    </div>`;
  const pipelineOutcome = casePipelineOutcome(artifacts.pipeline);
  const recommendation =
    c.verification?.recommendation ??
    (pipelineOutcome === "succeeded" ? "Success" : pipelineOutcome === "failed" ? "Failed" : "Pending");

  const body = `
    <div class="case-header">
      <div>
        <div class="case-id">${esc(c.id)}</div>
        <div class="case-created">${esc(new Date(c.createdAt).toLocaleString())}</div>
      </div>
      <div class="recommendation-box ${esc(pipelineOutcome)}">${esc(recommendation)}</div>
    </div>
    ${pipelineHtml}
    <div class="case-source-columns">
      ${checkCol}
      ${couponCol}
      ${navigaCol}
    </div>
    ${validationSectionHtml(validationRows)}`;

  const breadcrumb = `<a href="/">← All cases</a>`;
  return layout(c.id, breadcrumb, body);
}

// ---------------------------------------------------------------------------
// Review router
// ---------------------------------------------------------------------------

function createReviewRouter(rootDir: string): Router {
  const casesDir = path.join(rootDir, "artifacts", "cases");
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // GET / — case list
  router.get("/", async (_req: Request, res: Response) => {
    let entries: string[];
    try {
      entries = await fs.readdir(casesDir);
    } catch {
      entries = [];
    }

    const rows = (
      await Promise.all(
        entries.map(async (id) => {
          const caseFile = path.join(casesDir, id, "case.json");
          const c = await readJsonOrNull<StoredCase>(caseFile);
          if (!c) return null;
          const artifacts = await readCaseArtifacts(casesDir, id);
          return { c, pipeline: artifacts.pipeline };
        })
      )
    )
      .filter((r): r is { c: StoredCase; pipeline: CasePipelineStatus | null } => r !== null)
      .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt));

    res.send(caseListHtml(rows));
  });

  router.post("/cases/clear", async (_req: Request, res: Response) => {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(casesDir);
    } catch {
      entries = [];
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(casesDir, entry);
        await fs.rm(entryPath, { recursive: true, force: true });
      })
    );

    res.redirect(303, "/");
  });

  // GET /cases/:id — case detail
  router.get("/cases/:id", async (req: Request, res: Response) => {
    const id = String(req.params["id"]);
    const caseFile = path.join(casesDir, id, "case.json");
    const c = await readJsonOrNull<StoredCase>(caseFile);
    if (!c) {
      res.status(404).send("Case not found");
      return;
    }
    const artifacts = await readCaseArtifacts(casesDir, id);
    res.send(caseDetailHtml(c, artifacts));
  });

  return router;
}

// ---------------------------------------------------------------------------
// SharePoint router (existing)
// ---------------------------------------------------------------------------

function createSharePointRouter(env: SharePointEnv = {}): Router {
  const router = Router();
  const rootDir = process.cwd();
  const timestampedMessage = (message: string) => `[${new Date().toISOString()}] ${message}`;
  const runIntakeWorkflow = async (payload: OcrPayload): Promise<void> => {
    try {
      const storedCase = await processOcrPayload(payload, { persistOcrArtifact: false, runSubscriptionWorkflow: false });

      console.log(timestampedMessage(`Stored case at ${storedCase.paths.caseFile}`));

      const subscriberClientNumber = storedCase.subscriberClientNumber;
      if (!subscriberClientNumber) {
        console.error(timestampedMessage("Cannot start batch workflow: subscriber client number missing in stored case."));
        return;
      }

      const offerCode =
        (storedCase.ocrExtraction as CouponExtraction & { offerCode?: string | null }).offerCode ?? null;

      await runBatchWorkflow({
        subscriberClientNumber,
        promoCode: storedCase.ocrExtraction.promoCode ?? offerCode,
        couponExtraction: storedCase.ocrExtraction,
        couponExtractPath: storedCase.paths.couponExtract,
        pipelinePath: storedCase.paths.pipeline,
        rootDir,
        workflowId: "add-subscription-to-batch",
        keepOpen: false,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);

      console.error(timestampedMessage("SharePoint OCR workflow failed after intake acknowledgement:"));
      console.error(timestampedMessage(message));
    }
  };

  router.post("/intake", async (request: Request, response: Response) => {
    try {
      const ocrText = typeof request.body?.ocrText === "string" ? request.body.ocrText : "";
      const parsedOcr = ocrText ? parseOcrText(ocrText) : null;
      const { subscriberClientNumber } = parsedOcr ? extractCoupon("", parsedOcr) : { subscriberClientNumber: null };
      const artifactPath = await saveOcrArtifact(request.body, subscriberClientNumber);

      console.log(timestampedMessage("Received SharePoint OCR intake payload:"));
      console.dir(request.body, { depth: null });
      console.log(timestampedMessage(`Saved OCR artifact to ${artifactPath}`));

      response.status(202).json({
        artifactPath,
        accepted: true,
        workflowQueued: true,
      });

      void runIntakeWorkflow(request.body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(timestampedMessage("Failed to save SharePoint OCR artifact:"));
      console.error(timestampedMessage(message));

      response.status(500).json({
        error: "Failed to save OCR artifact",
        details: message,
      });
    }
  });

  router.post("/test-power-automate", async (request: Request, response: Response) => {
    const webhookUrl =
      typeof request.body?.webhookUrl === "string" && request.body.webhookUrl.length > 0
        ? request.body.webhookUrl
        : env.POWER_AUTOMATE_WEBHOOK_URL;
    const payload =
      typeof request.body?.payload === "object" && request.body.payload !== null
        ? (request.body.payload as JsonRecord)
        : DEFAULT_TEST_PAYLOAD;

    if (typeof webhookUrl !== "string" || webhookUrl.length === 0) {
      response.status(400).json({
        error: "webhookUrl is required or POWER_AUTOMATE_WEBHOOK_URL must be set",
      });
      return;
    }

    try {
      const result = await sendToPowerAutomate(webhookUrl, payload);

      console.log("Sent payload to Power Automate:");
      console.dir({ webhookUrl, payload, result }, { depth: null });

      response.status(result.ok ? 200 : 502).json({
        webhookUrl,
        payload,
        powerAutomate: result,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error("Failed to send payload to Power Automate:");
      console.error(message);

      response.status(500).json({
        webhookUrl,
        payload,
        error: message,
      });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    ...process.env,
  };
  const portValue = env.PORT ?? "3001";
  const host = env.HOST ?? "0.0.0.0";
  const port = Number(portValue);

  if (!Number.isFinite(port)) {
    throw new Error(`Invalid PORT "${portValue}"`);
  }

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static("apps/web/public"));
  app.use("/api/sharepoint", createSharePointRouter(env));
  app.use("/", createReviewRouter(rootDir));

  app.listen(port, host, () => {
    console.log(`Web server listening on ${host}:${port}`);
    console.log(`Review UI:        http://localhost:${port}/`);
    console.log(`SharePoint API:   http://localhost:${port}/api/sharepoint`);

    const lanUrls = getLanUrls(port);
    if (lanUrls.length > 0) {
      console.log(`LAN Review UI:    ${lanUrls[0]}`);
      if (lanUrls.length > 1) {
        for (const url of lanUrls.slice(1)) {
          console.log(`LAN Review UI:    ${url}`);
        }
      }
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
