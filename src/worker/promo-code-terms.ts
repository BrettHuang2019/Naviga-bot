import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CouponExtraction } from "../comparison/index.js";
import { amountsEqual, toAmount } from "../comparison/normalization.js";
import { toNavigaPromotionLookupCode } from "./promotion-code.js";

const promoTermSchema = z.object({
  label: z.string().nullable().optional(),
  issues: z.number().int().positive().nullable().optional(),
  price: z.number().nullable().optional(),
});

const promoCodeEntrySchema = z.object({
  code: z.string().min(1),
  terms: z.array(promoTermSchema).optional(),
});

const promoCodeTermsFileSchema = z.object({
  promoCodes: z.record(z.string().min(1), promoCodeEntrySchema),
});

type PromoCodeTermsFile = z.infer<typeof promoCodeTermsFileSchema>;
type PromoCodeTerm = z.infer<typeof promoTermSchema>;

type CouponExtractReport = {
  fields?: {
    promoCode?: {
      value?: unknown;
    };
    selectedOption?: {
      value?: {
        option?: unknown;
        price?: unknown;
      };
    };
  };
};

export type PromoTermCouponSource = Partial<Pick<CouponExtraction, "promoCode" | "selectedOption" | "paymentAmount">> &
  CouponExtractReport;

export type ResolvedPromoTerm = {
  issues: number | null;
  price: number | null;
};

async function loadPromoCodeTerms(rootDir: string): Promise<PromoCodeTermsFile> {
  const filePath = path.join(rootDir, "workflow", "business-rules", "excel-promo-code-terms.json");
  return promoCodeTermsFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}

function couponPromoCode(coupon: PromoTermCouponSource): string {
  const value = typeof coupon.promoCode === "string" ? coupon.promoCode : coupon.fields?.promoCode?.value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Unable to resolve promo term: coupon promo code is missing.");
  }

  return value.trim();
}

function couponSelectedPrice(coupon: PromoTermCouponSource): number | null {
  const selectedOptionAmount = coupon.selectedOption?.amount;
  if (typeof selectedOptionAmount === "number" && Number.isFinite(selectedOptionAmount)) {
    return selectedOptionAmount;
  }

  if (typeof coupon.paymentAmount === "number" && Number.isFinite(coupon.paymentAmount)) {
    return coupon.paymentAmount;
  }

  const reportPrice = coupon.fields?.selectedOption?.value?.price;
  return typeof reportPrice === "string" ? toAmount(reportPrice) : null;
}

function couponSelectedDuration(coupon: PromoTermCouponSource): string | null {
  const rawOption =
    coupon.selectedOption?.raw ??
    (typeof coupon.fields?.selectedOption?.value?.option === "string" ? coupon.fields.selectedOption.value.option : null);
  if (typeof rawOption !== "string" || rawOption.trim().length === 0) {
    return null;
  }

  if (/\b6\s*months?\b/i.test(rawOption) || /\b6\s*mois\b/i.test(rawOption)) {
    return "6 months";
  }

  if (/\b12\s*months?\b/i.test(rawOption) || /\b12\s*mois\b/i.test(rawOption)) {
    return "12 months";
  }

  if (/\b1\s*(?:year|an)\b/i.test(rawOption)) {
    return "1 year";
  }

  if (/\b2\s*(?:years?|ans?)\b/i.test(rawOption)) {
    return "2 years";
  }

  return rawOption.trim().toLowerCase();
}

function couponSelectedIssues(coupon: PromoTermCouponSource): number | null {
  const issues = coupon.selectedOption?.issues;
  return typeof issues === "number" && Number.isInteger(issues) ? issues : null;
}

function findPromoEntry(termsFile: PromoCodeTermsFile, promoCode: string) {
  const rawCode = promoCode.trim().toUpperCase();
  const rawEntry = termsFile.promoCodes[rawCode];
  if (rawEntry) {
    return rawEntry;
  }

  const lookupCode = toNavigaPromotionLookupCode(rawCode).toUpperCase();
  const lookupEntry = termsFile.promoCodes[lookupCode];
  if (lookupEntry) {
    return lookupEntry;
  }

  throw new Error(`Unable to resolve promo term: promo code "${promoCode}" was not found in Excel promo terms.`);
}

function termLabelMatches(term: PromoCodeTerm, duration: string): boolean {
  return (term.label ?? "").trim().toLowerCase() === duration.trim().toLowerCase();
}

function selectTerm(promoCode: string, terms: PromoCodeTerm[], coupon: PromoTermCouponSource): PromoCodeTerm {
  if (terms.length === 0) {
    throw new Error(`Unable to resolve promo term: promo code "${promoCode}" has no terms.`);
  }

  const selectedPrice = couponSelectedPrice(coupon);
  const selectedDuration = couponSelectedDuration(coupon);
  const selectedIssues = couponSelectedIssues(coupon);
  const source = selectedPrice !== null ? "price" : selectedDuration !== null ? "duration" : null;

  if (!source) {
    throw new Error(`Unable to resolve promo term: coupon selected price or duration is required for "${promoCode}".`);
  }

  let candidates = selectedPrice !== null ? terms.filter((term) => amountsEqual(term.price ?? null, selectedPrice)) : [];
  let matchedSource = selectedPrice !== null ? "price" : "duration";
  if (candidates.length === 0 && selectedDuration !== null) {
    candidates = terms.filter((term) => termLabelMatches(term, selectedDuration));
    matchedSource = "duration";
  }

  if (candidates.length === 0) {
    throw new Error(`Unable to resolve promo term: no Excel term matched coupon selected ${source} for "${promoCode}".`);
  }

  const issueCheckedCandidates =
    selectedIssues === null ? candidates : candidates.filter((term) => (term.issues ?? null) === selectedIssues);
  if (issueCheckedCandidates.length === 0) {
    throw new Error(`Unable to resolve promo term: coupon selected issues do not match Excel terms for "${promoCode}".`);
  }

  if (issueCheckedCandidates.length > 1) {
    throw new Error(`Unable to resolve promo term: multiple Excel terms matched coupon selected ${matchedSource} for "${promoCode}".`);
  }

  return issueCheckedCandidates[0];
}

export async function resolvePromoTerm(rootDir: string, coupon: PromoTermCouponSource): Promise<ResolvedPromoTerm> {
  const promoCode = couponPromoCode(coupon);
  const termsFile = await loadPromoCodeTerms(rootDir);
  const entry = findPromoEntry(termsFile, promoCode);
  const term = selectTerm(promoCode, entry.terms ?? [], coupon);

  return {
    issues: term.issues ?? null,
    price: term.price ?? null,
  };
}

export async function resolvePromoTermFromFile(rootDir: string, couponExtractPath: string): Promise<ResolvedPromoTerm> {
  const coupon = JSON.parse(await readFile(couponExtractPath, "utf8")) as PromoTermCouponSource;
  return resolvePromoTerm(rootDir, coupon);
}

export async function resolvePromoTermTime(rootDir: string, coupon: PromoTermCouponSource): Promise<string> {
  const term = await resolvePromoTerm(rootDir, coupon);
  if (term.issues === null) {
    throw new Error("Unable to resolve promo term: Excel term issues are missing.");
  }

  return String(term.issues);
}

export async function resolvePromoTermTimeFromFile(rootDir: string, couponExtractPath: string): Promise<string> {
  const term = await resolvePromoTermFromFile(rootDir, couponExtractPath);
  if (term.issues === null) {
    throw new Error("Unable to resolve promo term: Excel term issues are missing.");
  }

  return String(term.issues);
}
