import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { CouponExtraction } from "../comparison/index.js";

const termTimeRulesSchema = z.object({
  version: z.number().int().positive(),
  description: z.string().optional(),
  termTimeBySubscriptionProductCode: z.record(
    z.string().min(1),
    z.record(z.string().min(1), z.union([z.number().int().positive(), z.string().min(1)])),
  ),
});

type TermTimeRules = z.infer<typeof termTimeRulesSchema>;

type CouponExtractReport = {
  fields?: {
    subscriberClientNumber?: {
      value?: unknown;
    };
    promoCode?: {
      value?: unknown;
    };
    selectedOption?: {
      value?: {
        option?: unknown;
      };
    };
  };
};

export type TermTimeCouponSource = Partial<Pick<CouponExtraction, "promoCode" | "selectedOption">> & CouponExtractReport;
export type SubscriberClientNumberCouponSource = Partial<Pick<CouponExtraction, "subscriberClientNumber">> &
  CouponExtractReport;

async function loadTermTimeRules(rootDir: string): Promise<TermTimeRules> {
  const filePath = path.join(rootDir, "workflow", "business-rules", "subscription-term-time.yml");
  const parsed = parse(await readFile(filePath, "utf8"));
  return termTimeRulesSchema.parse(parsed);
}

function deriveProductCode(coupon: TermTimeCouponSource, configuredCodes: Set<string>): string {
  const promoCode = typeof coupon.promoCode === "string" ? coupon.promoCode : coupon.fields?.promoCode?.value;
  if (typeof promoCode !== "string" || promoCode.trim().length === 0) {
    throw new Error("Unable to derive Term/Time: coupon promo code is missing.");
  }

  const match = promoCode.trim().toUpperCase().match(/^([A-Z]+)(?=\d)/);
  if (!match) {
    throw new Error(`Unable to derive Term/Time: coupon promo code "${promoCode}" does not start with a product code.`);
  }

  const productCode = match[1];
  if (configuredCodes.has(productCode)) {
    return productCode;
  }

  const withoutLookupR = productCode.endsWith("R") ? productCode.slice(0, -1) : productCode;
  if (configuredCodes.has(withoutLookupR)) {
    return withoutLookupR;
  }

  throw new Error(`Unable to derive Term/Time: product code "${productCode}" is not configured.`);
}

function durationKeyFromCoupon(coupon: TermTimeCouponSource): string {
  const years = coupon.selectedOption?.years;
  if (years === 1 || years === 2) {
    return `${years}_year`;
  }

  const rawOption =
    coupon.selectedOption?.raw ??
    (typeof coupon.fields?.selectedOption?.value?.option === "string" ? coupon.fields.selectedOption.value.option : null);
  if (typeof rawOption !== "string" || rawOption.trim().length === 0) {
    throw new Error("Unable to derive Term/Time: selected coupon duration is missing.");
  }

  if (/\b1\s*(?:year|an)\b/i.test(rawOption)) {
    return "1_year";
  }

  if (/\b2\s*(?:years|year|ans|an)\b/i.test(rawOption)) {
    return "2_year";
  }

  throw new Error(`Unable to derive Term/Time: selected coupon duration "${rawOption}" is not configured.`);
}

export async function resolveSubscriptionTermTime(rootDir: string, coupon: TermTimeCouponSource): Promise<string> {
  const rules = await loadTermTimeRules(rootDir);
  const configuredCodes = new Set(Object.keys(rules.termTimeBySubscriptionProductCode));
  const productCode = deriveProductCode(coupon, configuredCodes);
  const durationKey = durationKeyFromCoupon(coupon);
  const termTime = rules.termTimeBySubscriptionProductCode[productCode]?.[durationKey];

  if (termTime === undefined) {
    throw new Error(`Unable to derive Term/Time: no value configured for ${productCode} ${durationKey}.`);
  }

  return String(termTime);
}

export async function resolveSubscriptionTermTimeFromFile(rootDir: string, couponExtractPath: string): Promise<string> {
  const coupon = JSON.parse(await readFile(couponExtractPath, "utf8")) as TermTimeCouponSource;
  return resolveSubscriptionTermTime(rootDir, coupon);
}

export function resolveSubscriberClientNumber(coupon: SubscriberClientNumberCouponSource): string {
  const value =
    typeof coupon.subscriberClientNumber === "string"
      ? coupon.subscriberClientNumber
      : coupon.fields?.subscriberClientNumber?.value;

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Unable to derive subscriber client number: coupon client ID is missing.");
  }

  const subscriberClientNumber = value.trim();
  if (!/^\d+$/.test(subscriberClientNumber)) {
    throw new Error(`Unable to derive subscriber client number: coupon client ID "${subscriberClientNumber}" is invalid.`);
  }

  return subscriberClientNumber;
}

export async function resolveSubscriberClientNumberFromFile(couponExtractPath: string): Promise<string> {
  const coupon = JSON.parse(await readFile(couponExtractPath, "utf8")) as SubscriberClientNumberCouponSource;
  return resolveSubscriberClientNumber(coupon);
}
