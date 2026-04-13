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
  assert.equal(income.coupon.offerCode, "JAL2022AV1");
  assert.equal(income.coupon.paymentAmount, null);
  assert.equal(income.coupon.selectedOption, null);
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
  assert.equal(income.coupon.offerCode, "JAL2022AV1");
  assert.equal(income.coupon.subscriberClientNumber, "502157");
  assert.equal(income.coupon.paymentAmount, null);
  assert.equal(income.coupon.selectedOption, null);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.confidence, "low");
});

test("artifact 670684 extracts the merged promo line and coupon option by amount inference", async () => {
  const parsed = parseOcrPayload(await loadArtifact("670684"));
  const income = extractIncomeDocument("670684.json", parsed);

  assert.equal(income.coupon.offerCode, "DEB2021AV1");
  assert.equal(income.coupon.paymentAmount, 48.22);
  assert.equal(income.coupon.selectedOption?.issues, 11);
  assert.equal(income.coupon.fieldMeta?.selectedOption?.source, "direct");
});

test("artifact 432688 preserves weak amount OCR without leaking coupon data into the check", async () => {
  const parsed = parseOcrPayload(await loadArtifact("432688"));
  const income = extractIncomeDocument("432688.json", parsed);

  assert.equal(income.check.payTo, "Publications BLD");
  assert.equal(income.check.amountNumber, 45.04);
  assert.equal(income.check.payerAddress, "1768 CROIS HENRI RENAUD, PREVOST, QC JOR 1TO");
  assert.equal(income.coupon.offerCode, "CUR2023AV1");
  assert.equal(income.coupon.paymentAmount, null);
  assert.equal(income.coupon.fieldMeta?.paymentAmount?.confidence, "low");
});

test("artifact 764622 extracts implicit cents in the payee line and prefers the explicit client number", async () => {
  const parsed = parseOcrPayload(await loadArtifact("764622"));
  const income = extractIncomeDocument("764622.json", parsed);

  assert.equal(income.coupon.subscriberClientNumber, "764622");
  assert.equal(income.coupon.offerCode, "PJQ2200AV1");
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
