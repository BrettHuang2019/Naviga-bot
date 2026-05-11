import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractIncomeDocument } from "./index.js";
import { parseOcrPayload } from "./ocr-parser.js";
import type { OcrPayload } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const includedFixtureDate = "2026-04-27";

test("included April 27 OCR artifacts parse and extract", async () => {
  const artifactDir = path.join(packageRoot, "fixtures", "ocr");
  const entries = await readdir(artifactDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`ocr-${includedFixtureDate}T`) && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  assert.equal(files.length, 4);

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(artifactDir, file), "utf8")) as OcrPayload;
    const parsed = parseOcrPayload(payload);
    const extraction = extractIncomeDocument(file, parsed);

    assert.ok(parsed.fullText.length > 0, `${file} should include OCR full text`);
    assert.ok(parsed.lines.length > 20, `${file} should include OCR lines`);
    assert.equal(extraction.check.file, file);
    assert.equal(extraction.coupon.file, file);
    assert.ok(extraction.check.rawTextPreview.length > 0, `${file} should extract check context`);
    assert.ok(extraction.coupon.rawTextPreview.length > 0, `${file} should extract coupon context`);
  }
});
