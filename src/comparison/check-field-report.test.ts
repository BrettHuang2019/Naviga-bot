import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractCheck } from "./index.js";
import type { CheckExtraction, OcrPayload } from "./types.js";

const rootDir = process.cwd();
const docsPath = path.join(rootDir, "docs", "field-rules.md");
const ocrDir = path.join(rootDir, "artifacts", "ocr");
const reportPath = path.join(rootDir, "artifacts", "json", "check-field-extraction-report.json");

const checkFieldMap = {
  "check num": "checkNumber",
  date: "date",
  "pay to": "payTo",
  "price in number": "amountNumber",
  "price in words": "amountWords",
  name: "payerName",
  address: "payerAddress",
} as const satisfies Record<string, keyof CheckExtraction>;

type CheckFieldName = keyof typeof checkFieldMap;

function normalizeRuleName(rule: string): CheckFieldName | null {
  const normalized = rule
    .replace(/\s+-\s+.*$/, "")
    .replace(/\.$/, "")
    .trim()
    .toLowerCase();

  return normalized in checkFieldMap ? (normalized as CheckFieldName) : null;
}

function extractCheckRules(markdown: string): string[] {
  const checkSection = markdown.match(/^# Check\s*\r?\n(?<body>[\s\S]*?)(?=^#\s|\z)/m)?.groups?.body;
  assert.ok(checkSection, "docs/field-rules.md must contain a # Check section");

  return [...checkSection.matchAll(/^\d+\.\s+(.+)$/gm)].map((match) => match[1].trim());
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

test("extractCheck covers and reports all fields documented in the Check rules", async () => {
  const documentedRules = extractCheckRules(await readFile(docsPath, "utf8"));
  const mappedFields = documentedRules.map((rule) => {
    const normalizedName = normalizeRuleName(rule);
    assert.ok(normalizedName, `Missing extractor mapping for Check rule: ${rule}`);

    return {
      rule,
      extractorField: checkFieldMap[normalizedName],
    };
  });

  const payloads = await loadOcrPayloads();
  assert.ok(payloads.length > 0, "Expected at least one OCR artifact to test");

  const files = payloads.map(({ file, payload }) => {
    const extraction = extractCheck(file, payload);
    const fields = Object.fromEntries(
      mappedFields.map(({ rule, extractorField }) => [
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
    ["checkNumber", "date", "payTo", "amountNumber", "amountWords", "payerName", "payerAddress"],
  );
  assert.equal(files.length, payloads.length);
});
