import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseOcrPayload, parseOcrText } from "./ocr-parser.js";
import type { OcrPayload } from "./types.js";

const rootDir = process.cwd();

async function loadArtifact(id: string): Promise<OcrPayload> {
  const artifactDir = path.join(rootDir, "artifacts", "ocr");
  const entries = await readdir(artifactDir);
  const file = entries.find((entry) => entry.includes(`_${id}.json`));
  if (!file) {
    throw new Error(`Missing OCR artifact for ${id}`);
  }

  return JSON.parse(await readFile(path.join(artifactDir, file), "utf8")) as OcrPayload;
}

test("parseOcrPayload parses a valid artifact and normalizes line geometry", async () => {
  const payload = await loadArtifact("670684");
  const parsed = parseOcrPayload(payload);

  assert.ok(parsed.fullText.includes("DEB2021AV1"));
  assert.ok(parsed.lines.length > 20);
  assert.equal(parsed.lines[0]?.text.length > 0, true);
  assert.equal(typeof parsed.lines[0]?.top, "number");
  assert.equal(parsed.lines[0]?.bottom > parsed.lines[0]?.top, true);
});

test("parseOcrPayload rejects missing ocrText", () => {
  assert.throws(() => parseOcrPayload({ ocrText: "" }), /missing ocrText/i);
});

test("parseOcrText rejects invalid inner JSON", () => {
  assert.throws(() => parseOcrText("{bad json"), /not valid JSON/i);
});

test("parseOcrText rejects missing lines", () => {
  const payload = JSON.stringify({
    responsev2: {
      predictionOutput: {
        fullText: "hello",
        results: [{}],
      },
    },
  });

  assert.throws(() => parseOcrText(payload), /missing responsev2\.predictionOutput\.results\[0\]\.lines/i);
});
