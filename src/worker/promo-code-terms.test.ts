import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolvePromoTerm, resolvePromoTermTime } from "./promo-code-terms.js";

const rootDir = path.resolve(".");

async function writeTermsFile(promoCodes: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "promo-code-terms-"));
  const rulesDir = path.join(root, "workflow", "business-rules");
  await mkdir(rulesDir, { recursive: true });
  await writeFile(
    path.join(rulesDir, "excel-promo-code-terms.json"),
    `${JSON.stringify({ promoCodes }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

test("resolves promo term by exact promo code and selected coupon price", async () => {
  assert.deepEqual(
    await resolvePromoTerm(rootDir, {
      promoCode: "DEBR2600AV3",
      selectedOption: {
        raw: "1 year",
        years: 1,
        issues: 10,
        amount: 49.95,
      },
    }),
    { issues: 10, price: 49.95 },
  );
});

test("resolves promo term by Naviga lookup code fallback", async () => {
  assert.deepEqual(
    await resolvePromoTerm(rootDir, {
      promoCode: "PASP2600AV1",
      selectedOption: {
        raw: "2 ans pour seulement 82,95$",
        years: 2,
        issues: 12,
        amount: 82.95,
      },
    }),
    { issues: 12, price: 82.95 },
  );
});

test("resolves promo term by extra option Naviga lookup code fallback", async () => {
  const tempRoot = await writeTermsFile({
    DEBX2600AV3: {
      code: "DEBX2600AV3",
      terms: [{ label: "1 year", issues: 12, price: 56.45 }],
    },
  });

  assert.deepEqual(
    await resolvePromoTerm(tempRoot, {
      promoCode: "DEB2600AV3",
      selectedOption: {
        raw: "56,45$ 1 Year tax incl. with PLUS",
        years: 1,
        issues: 12,
        amount: 56.45,
      },
    }),
    { issues: 12, price: 56.45 },
  );
});

test("resolves promo term when coupon OCR reads AV1 as AVI", async () => {
  assert.deepEqual(
    await resolvePromoTerm(rootDir, {
      promoCode: "PGC2600AVI",
      selectedOption: {
        raw: "1 an",
        years: 1,
        issues: 12,
        amount: 44.95,
      },
    }),
    { issues: 12, price: 44.95 },
  );
});

test("resolves promo term by selected duration when price is unavailable", async () => {
  assert.equal(
    await resolvePromoTermTime(rootDir, {
      promoCode: "CUR2600AV1",
      selectedOption: {
        raw: "2 years",
        years: 2,
        issues: 18,
        amount: null,
      },
    }),
    "18",
  );
});

test("falls back to selected duration when coupon price does not match Excel price", async () => {
  assert.equal(
    await resolvePromoTermTime(rootDir, {
      promoCode: "LCL2600AV2",
      selectedOption: {
        raw: "47,20$ 1 Year tax incl.",
        years: 1,
        issues: null,
        amount: 47.2,
      },
    }),
    "12",
  );
});

test("throws clearly when no term matches", async () => {
  const tempRoot = await writeTermsFile({
    TEST2600: {
      code: "TEST2600",
      terms: [{ label: "1 year", issues: 12, price: 10 }],
    },
  });

  await assert.rejects(
    () =>
      resolvePromoTerm(tempRoot, {
        promoCode: "TEST2600",
        selectedOption: { raw: "2 years", years: 2, issues: null, amount: null },
      }),
    /no Excel term matched coupon selected duration/,
  );
});

test("throws clearly when selected term is ambiguous", async () => {
  const tempRoot = await writeTermsFile({
    TEST2600: {
      code: "TEST2600",
      terms: [
        { label: "1 year", issues: 12, price: 10 },
        { label: "12 months", issues: 12, price: 10 },
      ],
    },
  });

  await assert.rejects(
    () =>
      resolvePromoTerm(tempRoot, {
        promoCode: "TEST2600",
        selectedOption: { raw: "Selected option", years: null, issues: null, amount: 10 },
      }),
    /multiple Excel terms matched coupon selected price/,
  );
});
