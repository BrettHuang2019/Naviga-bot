import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractIncomeDocument } from "./index.js";
import type { CouponExtraction, OcrPayload } from "./types.js";

const rootDir = process.cwd();
const docsPath = path.join(rootDir, "docs", "ocr-rule-guide-coupon.md");
const ocrDir = path.join(rootDir, "artifacts", "ocr");
const reportPath = path.join(rootDir, "artifacts", "json", "coupon-field-extraction-report.json");

const couponFieldMap = {
  "Coupon Client ID": "subscriberClientNumber",
  "Coupon Option Chosen and Option Price": "selectedOption",
  "Coupon Promo Code": "offerCode",
} as const satisfies Record<string, keyof CouponExtraction>;

type CouponRuleName = keyof typeof couponFieldMap;

function normalizeCouponRuleName(rule: string): CouponRuleName | null {
  const normalized = rule.replace(/^\d+\.\s*/, "").trim();
  return normalized in couponFieldMap ? (normalized as CouponRuleName) : null;
}

function extractCouponRules(markdown: string): string[] {
  const rules = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  assert.ok(rules.length > 0, "docs/ocr-rule-guide-coupon.md must contain coupon field sections");
  return rules;
}

async function loadOcrPayloads(): Promise<Array<{ file: string; payload: OcrPayload }>> {
  const entries = await readdir(ocrDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const payloads: Array<{ file: string; payload: OcrPayload }> = [];
  for (const file of jsonFiles) {
    payloads.push({
      file,
      payload: JSON.parse(await readFile(path.join(ocrDir, file), "utf8")) as OcrPayload,
    });
  }

  return payloads;
}

function selectedOptionValue(extraction: CouponExtraction): { option: string | null; price: string | null } {
  return {
    option: extraction.selectedOption?.raw ?? null,
    price: extraction.paymentAmount === null ? null : extraction.paymentAmount.toFixed(2),
  };
}

function fieldValue(extraction: CouponExtraction, field: keyof CouponExtraction): unknown {
  if (field === "selectedOption") {
    return selectedOptionValue(extraction);
  }

  return extraction[field];
}

function isPresent(value: unknown): boolean {
  if (value === null || value === "") {
    return false;
  }

  if (typeof value === "object" && value !== null && "option" in value && "price" in value) {
    const option = value as { option: string | null; price: string | null };
    return option.option !== null && option.price !== null;
  }

  return true;
}

test("extractCoupon covers and reports all fields documented in the Coupon OCR rule guide", async () => {
  const documentedRules = extractCouponRules(await readFile(docsPath, "utf8"));
  const mappedFields = documentedRules.map((rule) => {
    const normalizedName = normalizeCouponRuleName(rule);
    assert.ok(normalizedName, `Missing extractor mapping for Coupon rule: ${rule}`);

    return {
      rule,
      extractorField: couponFieldMap[normalizedName],
    };
  });

  const payloads = await loadOcrPayloads();
  assert.ok(payloads.length > 0, "Expected at least one OCR artifact to test");

  const files = payloads.map(({ file, payload }) => {
    const extraction = extractIncomeDocument(file, payload).coupon;
    const fields = Object.fromEntries(
      mappedFields.map(({ rule, extractorField }) => {
        const value = fieldValue(extraction, extractorField);
        const metaField = extractorField === "selectedOption" ? "selectedOption" : extractorField;

        return [
          extractorField,
          {
            rule,
            value,
            present: isPresent(value),
            meta: extraction.fieldMeta?.[metaField],
          },
        ];
      }),
    );

    return {
      file,
      fields,
      allOptions: extraction.options,
      rawTextPreview: extraction.rawTextPreview,
    };
  });

  const fieldCoverage = mappedFields.map(({ rule, extractorField }) => {
    const presentCount = files.filter((file) => {
      const field = file.fields[extractorField] as { present: boolean } | undefined;
      return field?.present === true;
    }).length;

    return {
      rule,
      extractorField,
      presentCount,
      missingCount: files.length - presentCount,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    input: {
      docsPath,
      ocrDir,
    },
    fieldCoverage,
    files,
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  assert.deepEqual(
    mappedFields.map((field) => field.extractorField),
    ["subscriberClientNumber", "selectedOption", "offerCode"],
  );
  assert.equal(files.length, payloads.length);
});
