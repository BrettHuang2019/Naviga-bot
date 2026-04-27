import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { extractCheck, extractIncomeDocument } from "../../src/comparison/index.js";
import type { CheckExtraction, CouponExtraction, OcrPayload } from "../../src/comparison/types.js";

const rootDir = process.cwd();
const docsDir = path.join(rootDir, "docs");
const ocrDir = path.join(rootDir, "artifacts", "ocr");
const outputDir = path.join(rootDir, "artifacts", "json");
const checkDocsPath = path.join(docsDir, "field-rules.md");
const couponDocsPath = path.join(docsDir, "ocr-rule-guide-coupon.md");

const checkFieldMap = {
  "check num": "checkNumber",
  date: "date",
  "pay to": "payTo",
  "price in number": "amountNumber",
  "price in words": "amountWords",
  name: "payerName",
  address: "payerAddress",
} as const satisfies Record<string, keyof CheckExtraction>;

const couponFieldMap = {
  "Coupon Client ID": "subscriberClientNumber",
  "Coupon Option Chosen and Option Price": "selectedOption",
  "Coupon Term Grid: Regular vs Extra": "termGrid",
  "Coupon Promo Code": "promoCode",
} as const satisfies Record<string, keyof CouponExtraction>;

type CheckRuleName = keyof typeof checkFieldMap;
type CouponRuleName = keyof typeof couponFieldMap;

function usage(): never {
  throw new Error("Usage: node --import tsx apps/reports/generate-ocr-field-reports.ts <YYYY-MM-DD> [output-prefix]");
}

function normalizeCheckRuleName(rule: string): CheckRuleName | null {
  const normalized = rule
    .replace(/\s+-\s+.*$/, "")
    .replace(/\.$/, "")
    .trim()
    .toLowerCase();

  return normalized in checkFieldMap ? (normalized as CheckRuleName) : null;
}

function normalizeCouponRuleName(rule: string): CouponRuleName | null {
  const normalized = rule.replace(/^\d+\.\s*/, "").trim();
  return normalized in couponFieldMap ? (normalized as CouponRuleName) : null;
}

function extractCheckRules(markdown: string): string[] {
  const checkSection = markdown.match(/^# Check\s*\r?\n(?<body>[\s\S]*?)(?=^#\s|\z)/m)?.groups?.body;
  assert.ok(checkSection, "docs/field-rules.md must contain a # Check section");

  return [...checkSection.matchAll(/^\d+\.\s+(.+)$/gm)].map((match) => match[1].trim());
}

function extractCouponRules(markdown: string): string[] {
  const rules = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  assert.ok(rules.length > 0, "docs/ocr-rule-guide-coupon.md must contain coupon field sections");
  return rules;
}

async function loadOcrPayloads(ocrDate: string): Promise<Array<{ file: string; payload: OcrPayload }>> {
  const entries = await readdir(ocrDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`ocr-${ocrDate}T`) && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(jsonFiles.length > 0, `Expected OCR artifacts for ${ocrDate} in ${ocrDir}`);

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

function couponFieldValue(extraction: CouponExtraction, field: keyof CouponExtraction): unknown {
  if (field === "selectedOption") {
    return selectedOptionValue(extraction);
  }

  return extraction[field];
}

function isCouponFieldPresent(value: unknown): boolean {
  if (value === null || value === "") {
    return false;
  }

  if (typeof value === "object" && value !== null && "option" in value && "price" in value) {
    const option = value as { option: string | null; price: string | null };
    return option.option !== null && option.price !== null;
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((entry) => entry !== null && entry !== "");
  }

  return true;
}

async function writeReport(filename: string, report: unknown): Promise<string> {
  const outputPath = path.join(outputDir, filename);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  const [ocrDate, outputPrefixArg] = process.argv.slice(2);
  if (!ocrDate) {
    usage();
  }

  const outputPrefix = outputPrefixArg ?? "today";
  const payloads = await loadOcrPayloads(ocrDate);

  const checkRules = extractCheckRules(await readFile(checkDocsPath, "utf8"));
  const mappedCheckFields = checkRules.map((rule) => {
    const normalizedName = normalizeCheckRuleName(rule);
    assert.ok(normalizedName, `Missing extractor mapping for Check rule: ${rule}`);

    return {
      rule,
      extractorField: checkFieldMap[normalizedName],
    };
  });

  const checkFiles = payloads.map(({ file, payload }) => {
    const extraction = extractCheck(file, payload);
    const fields = Object.fromEntries(
      mappedCheckFields.map(({ rule, extractorField }) => [
        extractorField,
        {
          rule,
          value: extraction[extractorField],
          present: extraction[extractorField] !== null && extraction[extractorField] !== "",
          meta: extraction.fieldMeta?.[extractorField],
        },
      ]),
    );

    return {
      file,
      fields,
      rawTextPreview: extraction.rawTextPreview,
    };
  });

  const checkFieldCoverage = mappedCheckFields.map(({ rule, extractorField }) => {
    const presentCount = checkFiles.filter((file) => {
      const field = file.fields[extractorField] as { present: boolean } | undefined;
      return field?.present === true;
    }).length;

    return {
      rule,
      extractorField,
      presentCount,
      missingCount: checkFiles.length - presentCount,
    };
  });

  const checkReport = {
    generatedAt: new Date().toISOString(),
    input: {
      docsPath: checkDocsPath,
      ocrDate,
      ocrDir,
      ocrFiles: payloads.map(({ file }) => file),
    },
    fieldCoverage: checkFieldCoverage,
    files: checkFiles,
  };

  const couponRules = extractCouponRules(await readFile(couponDocsPath, "utf8"));
  const mappedCouponFields = couponRules.map((rule) => {
    const normalizedName = normalizeCouponRuleName(rule);
    assert.ok(normalizedName, `Missing extractor mapping for Coupon rule: ${rule}`);

    return {
      rule,
      extractorField: couponFieldMap[normalizedName],
    };
  });

  const couponFiles = payloads.map(({ file, payload }) => {
    const extraction = extractIncomeDocument(file, payload).coupon;
    const fields = Object.fromEntries(
      mappedCouponFields.map(({ rule, extractorField }) => {
        const value = couponFieldValue(extraction, extractorField);
        const metaField = extractorField === "selectedOption" ? "selectedOption" : extractorField;

        return [
          extractorField,
          {
            rule,
            value,
            present: isCouponFieldPresent(value),
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

  const couponFieldCoverage = mappedCouponFields.map(({ rule, extractorField }) => {
    const presentCount = couponFiles.filter((file) => {
      const field = file.fields[extractorField] as { present: boolean } | undefined;
      return field?.present === true;
    }).length;

    return {
      rule,
      extractorField,
      presentCount,
      missingCount: couponFiles.length - presentCount,
    };
  });

  const couponReport = {
    generatedAt: new Date().toISOString(),
    input: {
      docsPath: couponDocsPath,
      ocrDate,
      ocrDir,
      ocrFiles: payloads.map(({ file }) => file),
    },
    fieldCoverage: couponFieldCoverage,
    files: couponFiles,
  };

  const checkOutputPath = await writeReport(`${outputPrefix}-check-field-extraction-report.json`, checkReport);
  const couponOutputPath = await writeReport(`${outputPrefix}-coupon-field-extraction-report.json`, couponReport);

  console.log(`Wrote check report -> ${checkOutputPath}`);
  console.log(`Wrote coupon report -> ${couponOutputPath}`);
  console.log(`OCR date ${ocrDate}, files ${payloads.length}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
