import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractCheck, extractIncomeDocument } from "./index.js";
import { parseOcrPayload } from "./ocr-parser.js";
import type { OcrLine, OcrPayload, ParsedOcrDocument } from "./types.js";

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

async function loadArtifactFile(file: string): Promise<OcrPayload> {
  return JSON.parse(await readFile(path.join(rootDir, "artifacts", "ocr", file), "utf8")) as OcrPayload;
}

function buildParsedDocument(lines: Array<{ text: string; top: number; left?: number; width?: number; height?: number }>): ParsedOcrDocument {
  const parsedLines: OcrLine[] = lines.map(({ text, top, left = 0.1, width = 0.2, height = 0.02 }) => ({
    text,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }));

  return {
    fullText: parsedLines.map((line) => line.text).join("\n"),
    lines: parsedLines,
    imageLink: null,
  };
}

const sampleIncomeText = `David Soules
035
Heidi Soules
20 Hoodless Court
DATE
1 1 2 2 2 0 2 2
Brantford, ON N3T 0A8
PAY TO THE
Bayard Presse Canada Inc.
$ 56.45
ORDER OF
fifty-six dollars
45 /100 DOLLARS
Je profite de cette offre pour prolonger l'abonnement de mon enfant a J'aime Lire
2 ans (24 numeros) seulement 90.35 $
lan (12 numeros) seulement 56.45$
Nombre de copies: 1
Pour l'abonnement de: Heidi Soules no de client: 502157
2022-12-12
JAL2022AV1
JAL#CLIENT: 502157 12/01/2022
135
HEIDI SOULES
20 HOODLESS COURT
BRANTFORD ON N3T 0A8
Coordonnees et modes de paiement au verso`;

test("extractCheck pulls key fields from a combined income OCR payload", () => {
  const check = extractCheck("sample.json", sampleIncomeText);

  assert.equal(check.checkNumber, "035");
  assert.equal(check.date, "2022-11-22");
  assert.equal(check.payTo, "Bayard Presse Canada Inc.");
  assert.equal(check.amountNumber, null);
  assert.equal(check.amountWords, "fifty-six dollars");
  assert.equal(check.payerName, "Heidi Soules");
  assert.match(check.payerAddress ?? "", /20 Hoodless Court/);
});

test("extractIncomeDocument returns separate check and coupon sections", () => {
  const income = extractIncomeDocument("sample.json", sampleIncomeText);

  assert.equal(income.check.checkNumber, "035");
  assert.equal(income.coupon.subscriberClientNumber, "502157");
  assert.equal(income.coupon.promoCode, "JAL2022AV1");
  assert.equal(income.coupon.paymentAmount, 56.45);
  assert.equal(income.coupon.selectedOption?.issues, 12);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.source, "inferred");
});

const sample502157Text = `HEIDI SOULES
035
DAVID SOULES
20 HOODLESS COURT
DATE
1 1 2 2 2 0 2 2
BRANTFORD ON N3T 0A8
PAY TO THE
Publication BLD
$ 56.45
ORDER OF
MEMO J'aime
⑈035⑈ ⑆60672⑉828⑆ 0619858⑉411⑈
Je profite de cette offre pour prolonger l'abonnement de mon enfant à J'aime Lire
2 ans (24 numéros) seulement 90.35 $
lan (12 numéros) seulement 56.45$
Nombre de copies: 1
Pour l'abonnement de: Heidi Soules no de client: 502157
2022-12-12
JAL2022AV1
JAL#CLIENT: 502157 12/01/2022
135
HEIDI SOULES
20 HOODLESS COURT
BRANTFORD ON N3T 0A8
Coordonnées et modes de paiement au verso`;

test("extractCheck ignores coupon lines when extracting combined OCR fields", () => {
  const check = extractCheck("502157.json", sample502157Text);

  assert.equal(check.checkNumber, "035");
  assert.equal(check.date, "2022-11-22");
  assert.equal(check.payTo, "Publications BLD");
  assert.equal(check.amountNumber, null);
  assert.match(check.payerAddress ?? "", /20 Hoodless Court/i);
  assert.doesNotMatch(check.rawTextPreview, /JAL#CLIENT/i);
});

test("artifact 502157 keeps the damaged date and promo in the right regions", async () => {
  const parsed = parseOcrPayload(await loadArtifact("502157"));
  const income = extractIncomeDocument("502157.json", parsed);

  assert.equal(income.check.date, "2022-11-22");
  assert.equal(income.coupon.promoCode, "JAL2022AV1");
  assert.equal(income.coupon.subscriberClientNumber, "502157");
  assert.equal(income.coupon.paymentAmount, 56.45);
  assert.equal(income.coupon.selectedOption?.issues, 12);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.confidence, "medium");
  assert.equal(income.coupon.fieldMeta?.selectedOption?.source, "inferred");
});

test("artifact 670684 extracts the merged promo line and coupon option by amount inference", async () => {
  const parsed = parseOcrPayload(await loadArtifact("670684"));
  const income = extractIncomeDocument("670684.json", parsed);

  assert.equal(income.coupon.promoCode, "DEB2021AV1");
  assert.equal(income.coupon.paymentAmount, 48.22);
  assert.equal(income.coupon.selectedOption?.issues, 11);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.source, "normalized");
});

test("artifact 432688 preserves weak amount OCR without leaking coupon data into the check", async () => {
  const parsed = parseOcrPayload(await loadArtifact("432688"));
  const income = extractIncomeDocument("432688.json", parsed);

  assert.equal(income.check.payTo, "Publications BLD");
  assert.equal(income.check.amountNumber, 45.04);
  assert.equal(income.check.payerAddress, "1768 CROIS HENRI RENAUD, PREVOST, QC JOR 1TO");
  assert.equal(income.coupon.promoCode, "CUR2023AV1");
  assert.equal(income.coupon.paymentAmount, 45.94);
  assert.equal(income.coupon.fieldMeta?.paymentAmount?.source, "inferred");
});

test("artifact 693314 matches the one-year coupon option from the check amount", async () => {
  const parsed = parseOcrPayload(await loadArtifact("693314"));
  const income = extractIncomeDocument("693314.json", parsed);

  assert.equal(income.check.amountNumber, 45.94);
  assert.equal(income.coupon.paymentAmount, 45.94);
  assert.equal(income.coupon.selectedOption?.issues, 11);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.source, "inferred");
});

test("artifact 764622 extracts implicit cents in the payee line and prefers the explicit client number", async () => {
  const parsed = parseOcrPayload(await loadArtifact("764622"));
  const income = extractIncomeDocument("764622.json", parsed);

  assert.equal(income.coupon.subscriberClientNumber, "764622");
  assert.equal(income.coupon.promoCode, "PJQ2200AV1");
  assert.equal(income.check.payTo, "Bayard Presse Canada Inc.");
  assert.equal(income.check.amountNumber, 45.15);
  assert.equal(income.check.payerAddress, "1373 CORKERY RD, CARP, ONTARIO KOA1LO");
});

test("artifact 377408 follows the rule-guide anchors for payee, subscriber identity, and payer address", async () => {
  const parsed = parseOcrPayload(await loadArtifact("377408"));
  const income = extractIncomeDocument("377408.json", parsed);

  assert.equal(income.check.payTo, "Publications BLD");
  assert.equal(income.check.amountWords, "Quatre-vingt-six. 18 / 100 DOLLARS A Cartantque da");
  assert.equal(income.check.payerAddress, null);
  assert.equal(income.coupon.subscriberClientNumber, "377408");
  assert.equal(income.coupon.subscriberName, "ELOI FALCONI");
});

test("artifact 463769 uses the top-left payer block instead of payee or bank text", async () => {
  const parsed = parseOcrPayload(await loadArtifact("463769"));
  const income = extractIncomeDocument("463769.json", parsed);

  assert.equal(income.check.payerName, "RAYNALD CARON");
  assert.equal(income.check.payerAddress, "279 16E AV, DOLBEAU-MISTASSINI, QC G8L 2N2");
  assert.equal(income.check.amountWords, "quatre-vingt-six-18 / 100 DOLLARS fulgte.");
  assert.deepEqual(income.coupon.termGrid, {
    regular1Year: null,
    regular2Year: null,
    extra1Year: 51.68,
    extra2Year: 86.18,
  });
});

test("new 2026 artifacts keep seven-digit client IDs and 2600 promo codes", async () => {
  const curium = extractIncomeDocument(
    "ocr-2026-04-21T14-37-46.346Z_1008257.json",
    parseOcrPayload(await loadArtifact("1008257")),
  );
  assert.equal(curium.coupon.subscriberClientNumber, "1008257");
  assert.equal(curium.coupon.promoCode, "CUR2600AV1");
  assert.equal(curium.coupon.selectedOption?.amount, 91.93);
  assert.equal(curium.check.amountWords, "quatre-vingt-onze 93 / 100 DOLLARS");
  assert.deepEqual(curium.coupon.termGrid, {
    regular1Year: 57.43,
    regular2Year: 91.93,
    extra1Year: null,
    extra2Year: null,
  });

  const pasp = extractIncomeDocument(
    "ocr-2026-04-15T18-10-38.785Z_577779.json",
    parseOcrPayload(await loadArtifact("577779")),
  );
  assert.equal(pasp.coupon.subscriberClientNumber, "1008927");
  assert.equal(pasp.coupon.billToNameId, "577779");
  assert.equal(pasp.coupon.promoCode, "PASP2600AV1");
});

test("new 2026 artifacts handle lower check bands and unmarked one-year options", async () => {
  const prions = extractIncomeDocument(
    "ocr-2026-04-15T18-10-34.639Z_348892.json",
    parseOcrPayload(await loadArtifact("348892")),
  );
  assert.equal(prions.check.payTo, "Bayard Presse Canada Inc.");
  assert.equal(prions.coupon.selectedOption?.raw, "1 2 ans à 86,18$ taxes incl.");

  const debrouillards = extractIncomeDocument(
    "ocr-2026-04-15T18-10-43.639Z_993764.json",
    parseOcrPayload(await loadArtifact("993764")),
  );
  assert.equal(debrouillards.check.date, "2026-04-06");
  assert.equal(debrouillards.coupon.paymentAmount, 68.93);
  assert.equal(debrouillards.coupon.selectedOption?.raw, "Extra 1 an pour seulement 68,93$ taxes incluses");
  assert.deepEqual(debrouillards.coupon.termGrid, {
    regular1Year: 57.43,
    regular2Year: 91.93,
    extra1Year: 68.93,
    extra2Year: 114.92,
  });

  const liturgie = extractIncomeDocument(
    "ocr-2026-04-15T18-10-48.008Z_519581.json",
    parseOcrPayload(await loadArtifact("519581")),
  );
  assert.equal(liturgie.check.checkNumber, "172");
  assert.equal(liturgie.check.payerName, "LUCIE G LETOURNEAU");
  assert.equal(liturgie.coupon.subscriberName, "Lucie Letourneau");
  assert.equal(liturgie.coupon.selectedOption?.raw, "1 an (6 numéros) pour seulement = 74.68$ (taxes incluses).");
});

test("extractCheck normalizes compact and fragmented dates using layout hints", () => {
  const compactYearFirst = extractCheck(
    "compact-year-first.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 20260311", top: 0.2, left: 0.58, width: 0.18 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(compactYearFirst.date, "2026-03-11");

  const compactMonthDayYear = extractCheck(
    "compact-month-day-year.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 06032026", top: 0.2, left: 0.58, width: 0.18 },
      { text: "MMDDYYYY", top: 0.22, left: 0.58, width: 0.14 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(compactMonthDayYear.date, "2026-06-03");

  const compactDayMonthYear = extractCheck(
    "compact-day-month-year.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 06032026", top: 0.2, left: 0.58, width: 0.18 },
      { text: "DDMMYYYY", top: 0.22, left: 0.58, width: 0.14 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(compactDayMonthYear.date, "2026-03-06");

  const fragmented = extractCheck(
    "fragmented-date.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE", top: 0.2, left: 0.58, width: 0.08 },
      { text: "2", top: 0.212, left: 0.67, width: 0.02 },
      { text: "026-0", top: 0.226, left: 0.69, width: 0.05 },
      { text: "3- 1", top: 0.24, left: 0.71, width: 0.05 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(fragmented.date, "2026-03-01");

  const fragmentedAboveAnchor = extractCheck(
    "fragmented-above-anchor.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "2", top: 0.184, left: 0.66, width: 0.02 },
      { text: "026-0", top: 0.196, left: 0.68, width: 0.05 },
      { text: "DATE", top: 0.2, left: 0.58, width: 0.08 },
      { text: "3- 1", top: 0.212, left: 0.71, width: 0.05 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(fragmentedAboveAnchor.date, "2026-03-01");

  const incompleteYear = extractCheck(
    "incomplete-year.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 110320", top: 0.2, left: 0.58, width: 0.14 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(incompleteYear.date, null);
});

test("2026 artifacts use layout hints for compact dates and reject incomplete years", async () => {
  const monthFirst = extractIncomeDocument(
    "ocr-2026-04-21T15-10-59.025Z_160860.json",
    parseOcrPayload(await loadArtifact("160860")),
  );
  assert.equal(monthFirst.check.date, "2026-03-06");

  const monthFirstSecond = extractIncomeDocument(
    "ocr-2026-04-21T15-11-57.950Z_244583.json",
    parseOcrPayload(await loadArtifact("244583")),
  );
  assert.equal(monthFirstSecond.check.date, "2026-03-04");

  const incompleteYear = extractIncomeDocument(
    "ocr-2026-04-21T15-10-40.127Z_167725.json",
    parseOcrPayload(await loadArtifact("167725")),
  );
  assert.equal(incompleteYear.check.date, null);
});

test("2026 artifacts merge fragmented date pieces around DATE anchors", async () => {
  const first = extractIncomeDocument(
    "ocr-2026-04-21T15-04-43.571Z_886306.json",
    parseOcrPayload(await loadArtifact("886306")),
  );
  assert.equal(first.check.date, "2026-03-01");

  const second = extractIncomeDocument(
    "ocr-2026-04-21T15-04-47.900Z_781766.json",
    parseOcrPayload(await loadArtifact("781766")),
  );
  assert.equal(second.check.date, "2026-03-04");
});

test("2026 LCL artifacts detect English coupon selections from marks and check amounts", async () => {
  const marked = extractIncomeDocument(
    "ocr-2026-04-21T15-04-52.306Z_421859.json",
    parseOcrPayload(await loadArtifact("421859")),
  );
  assert.equal(marked.coupon.paymentAmount, 47.2);
  assert.equal(marked.coupon.selectedOption?.raw, "Z 47,20$ 1 Year tax incl.");
  assert.equal(marked.coupon.fieldMeta?.selectedOption?.source, "normalized");

  const inferred = extractIncomeDocument(
    "ocr-2026-04-21T15-11-53.721Z_632675.json",
    parseOcrPayload(await loadArtifact("632675")),
  );
  assert.equal(inferred.coupon.paymentAmount, 47.2);
  assert.equal(inferred.coupon.selectedOption?.raw, "£ 47,20$ 1 Year tax incl.");
  assert.equal(inferred.coupon.fieldMeta?.selectedOption?.source, "normalized");

  const regularOneYear = extractIncomeDocument(
    "ocr-2026-04-21T15-10-59.025Z_160860.json",
    parseOcrPayload(await loadArtifact("160860")),
  );
  assert.equal(regularOneYear.coupon.paymentAmount, 50.8);
  assert.equal(regularOneYear.coupon.selectedOption?.raw, "50,80$ 1 Year tax incl.");
});

test("2026 LCL artifacts merge split coupon rows into options and term grids", async () => {
  const splitPlus = extractIncomeDocument(
    "ocr-2026-04-21T15-11-57.950Z_244583.json",
    parseOcrPayload(await loadArtifact("244583")),
  );
  assert.equal(splitPlus.coupon.paymentAmount, 56.45);
  assert.equal(splitPlus.coupon.selectedOption?.raw, "56,45$ 1 Year tax incl. with PLUS");
  assert.deepEqual(splitPlus.coupon.termGrid, {
    regular1Year: 50.8,
    regular2Year: 84.7,
    extra1Year: 56.45,
    extra2Year: 93.74,
  });

  const splitGrid = extractIncomeDocument(
    "ocr-2026-04-21T15-11-22.771Z_621058.json",
    parseOcrPayload(await loadArtifact("621058")),
  );
  assert.equal(splitGrid.coupon.paymentAmount, 86.2);
  assert.equal(splitGrid.coupon.selectedOption?.raw, "86,20$ 2 Years tax incl.");
  assert.deepEqual(splitGrid.coupon.termGrid, {
    regular1Year: 51.7,
    regular2Year: 86.2,
    extra1Year: 57.45,
    extra2Year: 95.4,
  });

  const fullBand = extractIncomeDocument(
    "ocr-2026-04-21T15-12-02.401Z_1003239.json",
    parseOcrPayload(await loadArtifact("1003239")),
  );
  assert.equal(fullBand.coupon.paymentAmount, 47.2);
  assert.equal(fullBand.coupon.selectedOption?.raw, "47,20$ 1 Year tax incl.");
  assert.deepEqual(fullBand.coupon.termGrid, {
    regular1Year: 47.2,
    regular2Year: 78.7,
    extra1Year: 52.45,
    extra2Year: 87.1,
  });
});

test("extractCheck rejects anchor noise and normalizes weak payees", () => {
  const balio = extractCheck(
    "balio-the.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 2026-03-11", top: 0.2, left: 0.58, width: 0.18 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "BALIO THE", top: 0.27, left: 0.18, width: 0.1 },
      { text: "novale", top: 0.282, left: 0.18, width: 0.1 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(balio.payTo, "Novalis");

  const livingWithChristProduct = extractCheck(
    "living-with-christ-product.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 2026-03-11", top: 0.2, left: 0.58, width: 0.18 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Living with Christ with Sacred Journey", top: 0.27, left: 0.18, width: 0.32 },
      { text: "Living with Christ", top: 0.282, left: 0.18, width: 0.18 },
      { text: "56.45", top: 0.27, left: 0.68, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
    ]),
  );
  assert.equal(livingWithChristProduct.payTo, "Living with Christ");
});

test("extractCheck prefers cleaner numeric amount candidates over damaged cents", () => {
  const check = extractCheck(
    "damaged-cents.json",
    buildParsedDocument([
      { text: "NAME", top: 0.14, left: 0.1 },
      { text: "099", top: 0.16, left: 0.7, width: 0.05 },
      { text: "DATE 2026-03-11", top: 0.2, left: 0.58, width: 0.18 },
      { text: "PAY TO THE", top: 0.26, left: 0.08, width: 0.1 },
      { text: "Publications BLD", top: 0.27, left: 0.18, width: 0.18 },
      { text: "56.400", top: 0.271, left: 0.62, width: 0.09 },
      { text: "56.45", top: 0.272, left: 0.7, width: 0.08 },
      { text: "ORDER OF", top: 0.29, left: 0.08, width: 0.08 },
      { text: "fifty-six dollars", top: 0.31, left: 0.2, width: 0.2 },
      { text: "45 /100 DOLLARS", top: 0.32, left: 0.58, width: 0.12 },
    ]),
  );

  assert.equal(check.amountNumber, 56.45);
});

test("extractIncomeDocument keeps coupon selection empty when check amount matches no option row", () => {
  const income = extractIncomeDocument(
    "no-match-selection.json",
    `NAME
099
DATE 2026-03-11
PAY TO THE
Publications BLD
$ 80.00
ORDER OF
eighty dollars
Retournez ce coupon avec votre paiement dans l'enveloppe.
Produit test
47.20 1 Year tax incl.
52.45 2 Years tax incl.
78.70 1 Year tax incl. with PLUS
87.10 2 Years tax incl. with PLUS
Pour l'abonnement de: 123456 TEST PERSON
TST2600AV1`,
  );

  assert.equal(income.coupon.selectedOption, null);
  assert.equal(income.coupon.paymentAmount, null);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.source, "conflicting");
  assert.deepEqual(income.coupon.termGrid, {
    regular1Year: 47.2,
    regular2Year: 52.45,
    extra1Year: 78.7,
    extra2Year: 87.1,
  });
});
