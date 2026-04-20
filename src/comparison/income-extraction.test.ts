import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractCheck, extractIncomeDocument } from "./index.js";
import { parseOcrPayload } from "./ocr-parser.js";
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

async function loadArtifactFile(file: string): Promise<OcrPayload> {
  return JSON.parse(await readFile(path.join(rootDir, "artifacts", "ocr", file), "utf8")) as OcrPayload;
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
});

test("new 2026 artifacts keep seven-digit client IDs and 2600 promo codes", async () => {
  const curium = extractIncomeDocument(
    "ocr-2026-04-15T18-10-29.986Z.json",
    parseOcrPayload(await loadArtifactFile("ocr-2026-04-15T18-10-29.986Z.json")),
  );
  assert.equal(curium.coupon.subscriberClientNumber, "1008257");
  assert.equal(curium.coupon.promoCode, "CUR2600AV1");
  assert.equal(curium.coupon.selectedOption?.amount, 91.93);
  assert.equal(curium.check.amountWords, "quatre-vingt-onze 93 / 100 DOLLARS");

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

  const liturgie = extractIncomeDocument(
    "ocr-2026-04-15T18-10-48.008Z_519581.json",
    parseOcrPayload(await loadArtifact("519581")),
  );
  assert.equal(liturgie.check.checkNumber, "172");
  assert.equal(liturgie.check.payerName, "LUCIE G LETOURNEAU");
  assert.equal(liturgie.coupon.subscriberName, "Lucie Letourneau");
  assert.equal(liturgie.coupon.selectedOption?.raw, "1 an (6 numéros) pour seulement = 74.68$ (taxes incluses).");
});
