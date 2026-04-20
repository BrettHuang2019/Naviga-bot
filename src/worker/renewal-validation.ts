import { readFile } from "node:fs/promises";
import path from "node:path";
import { amountsEqual, fuzzyAddressMatch, fuzzyNameMatch, normalizeForCompare, toAmount, toDigits } from "../comparison/normalization.js";

type ExtractField<T> = {
  value: T | null;
};

type ExtractReport = {
  fields?: Record<string, ExtractField<unknown>>;
};

type CouponOption = {
  option?: string | null;
  price?: string | number | null;
};

export type NavigaSubscriptionSummary = {
  capturedAt?: string;
  url?: string;
  subscriptionId?: string | null;
  subscriber?: {
    name?: string | null;
    id?: string | null;
  };
  deliveryAddress?: string | null;
  pricingDetails?: {
    total?: string | number | null;
  };
};

type StoredCaseLike = {
  ocrExtraction?: {
    subscriberName?: string | null;
    subscriberClientNumber?: string | null;
    payerAddress?: string | null;
    paymentAmount?: string | number | null;
  };
  subscription?: {
    subscriberName?: string | null;
    clientNumber?: string | null;
    billToName?: string | null;
    totalAmount?: string | number | null;
  };
  incomeExtraction?: {
    coupon?: {
      subscriberName?: string | null;
      subscriberClientNumber?: string | null;
      payerAddress?: string | null;
      paymentAmount?: string | number | null;
    };
    check?: {
      checkNumber?: string | null;
      payerName?: string | null;
      payerAddress?: string | null;
      amountNumber?: string | number | null;
      amountWords?: string | null;
    };
  };
};

export type RenewalValidationArtifacts = {
  checkExtract: ExtractReport | null;
  couponExtract: ExtractReport | null;
  navigaSummary: NavigaSubscriptionSummary | null;
  storedCase: StoredCaseLike | null;
};

export type RenewalValidationStatus = "ok" | "warning" | "error";

export type RenewalValidationRow = {
  label: string;
  status: RenewalValidationStatus;
  message: string;
  naviga?: string | number | null;
  coupon?: string | number | null;
  check?: string | number | null;
};

export type RenewalPaymentInput = {
  checkNumber: string;
  amount: string;
};

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractFieldValue<T>(report: ExtractReport | null, fieldName: string): T | null {
  const value = report?.fields?.[fieldName]?.value;
  return value === undefined ? null : (value as T | null);
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
    const tensWords: Record<number, string> = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };
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

export async function loadRenewalValidationArtifacts(paths: {
  couponExtractPath: string;
  checkExtractPath?: string;
  navigaSummaryPath: string;
}): Promise<RenewalValidationArtifacts> {
  const caseDir = path.dirname(paths.couponExtractPath);
  const checkExtractPath = paths.checkExtractPath ?? path.join(caseDir, "check-extract.json");
  const casePath = path.join(caseDir, "case.json");

  const [checkExtract, couponExtract, navigaSummary, storedCase] = await Promise.all([
    readJsonOrNull<ExtractReport>(checkExtractPath),
    readJsonOrNull<ExtractReport>(paths.couponExtractPath),
    readJsonOrNull<NavigaSubscriptionSummary>(paths.navigaSummaryPath),
    readJsonOrNull<StoredCaseLike>(casePath),
  ]);

  return { checkExtract, couponExtract, navigaSummary, storedCase };
}

export function buildRenewalValidationRows(artifacts: RenewalValidationArtifacts): RenewalValidationRow[] {
  const couponOption = extractFieldValue<CouponOption>(artifacts.couponExtract, "selectedOption");
  const coupon = artifacts.storedCase?.incomeExtraction?.coupon;
  const check = artifacts.storedCase?.incomeExtraction?.check;

  const navigaName = firstValue(artifacts.navigaSummary?.subscriber?.name, artifacts.storedCase?.subscription?.subscriberName);
  const navigaClientNumber = firstValue(artifacts.navigaSummary?.subscriber?.id, artifacts.storedCase?.subscription?.clientNumber);
  const navigaAddress = firstValue(artifacts.navigaSummary?.deliveryAddress, artifacts.storedCase?.subscription?.billToName);
  const navigaPrice = normalizeAmount(firstValue(artifacts.navigaSummary?.pricingDetails?.total, artifacts.storedCase?.subscription?.totalAmount));

  const couponName = firstValue(
    extractFieldValue<string>(artifacts.couponExtract, "subscriberName"),
    coupon?.subscriberName,
    artifacts.storedCase?.ocrExtraction?.subscriberName,
  );
  const couponClientNumber = firstValue(
    extractFieldValue<string>(artifacts.couponExtract, "subscriberClientNumber"),
    coupon?.subscriberClientNumber,
    artifacts.storedCase?.ocrExtraction?.subscriberClientNumber,
  );
  const couponAddress = firstValue(
    extractFieldValue<string>(artifacts.couponExtract, "payerAddress"),
    coupon?.payerAddress,
    artifacts.storedCase?.ocrExtraction?.payerAddress,
  );
  const couponPrice = normalizeAmount(firstValue(couponOption?.price, coupon?.paymentAmount, artifacts.storedCase?.ocrExtraction?.paymentAmount));

  const checkName = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payerName"), check?.payerName);
  const checkAddress = firstValue(extractFieldValue<string>(artifacts.checkExtract, "payerAddress"), check?.payerAddress);
  const checkPrice = normalizeAmount(firstValue(extractFieldValue<string | number>(artifacts.checkExtract, "amountNumber"), check?.amountNumber));
  const checkAmountWords = firstValue(extractFieldValue<string>(artifacts.checkExtract, "amountWords"), check?.amountWords);

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
      naviga: navigaPrice,
      coupon: couponPrice,
      check: checkPrice,
    },
    {
      label: "Check price words",
      status: wordsMatch ? "ok" : "warning",
      message: wordsMatch ? "Check numeric amount matches amount in words." : "Check numeric amount does not clearly match amount in words.",
      check: [checkPrice, checkAmountWords].filter((value) => value !== null && value !== undefined && String(value).length > 0).join(" / ") || null,
    },
  ];
}

export function assertRenewalValidationPassed(rows: RenewalValidationRow[]): void {
  const errors = rows.filter((row) => row.status === "error");
  if (errors.length === 0) {
    return;
  }

  const detail = errors.map((row) => `${row.label}: ${row.message}`).join("; ");
  throw new Error(`Renewal validation failed. ${detail}`);
}

export function resolveRenewalPaymentInput(artifacts: RenewalValidationArtifacts): RenewalPaymentInput {
  const checkNumber = firstValue(
    extractFieldValue<string>(artifacts.checkExtract, "checkNumber"),
    artifacts.storedCase?.incomeExtraction?.check?.checkNumber,
  );
  const amount = normalizeAmount(
    firstValue(
      artifacts.navigaSummary?.pricingDetails?.total,
      extractFieldValue<string | number>(artifacts.checkExtract, "amountNumber"),
      artifacts.storedCase?.subscription?.totalAmount,
    ),
  );

  if (!checkNumber) {
    throw new Error("Missing check number for payment.");
  }

  if (amount === null) {
    throw new Error("Missing payment amount for payment.");
  }

  return {
    checkNumber,
    amount: amount.toFixed(2),
  };
}
