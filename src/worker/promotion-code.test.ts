import assert from "node:assert/strict";
import test from "node:test";
import { toNavigaPromotionLookupCode, toPromotionLookupCandidates } from "./promotion-code.js";

test("inserts R as fourth letter when promo code has three letters before number", () => {
  assert.equal(toNavigaPromotionLookupCode("DEB2600AV3"), "DEBR2600AV3");
  assert.equal(toNavigaPromotionLookupCode("ASP2600AV1"), "ASPR2600AV1");
});

test("replaces fourth letter with R when promo code has four letters before number", () => {
  assert.equal(toNavigaPromotionLookupCode("PASP2600AV1"), "PASR2600AV1");
});

test("leaves promo code unchanged when prefix rule does not apply", () => {
  assert.equal(toNavigaPromotionLookupCode("AB2600AV1"), "AB2600AV1");
  assert.equal(toNavigaPromotionLookupCode("ABCDE2600AV1"), "ABCDE2600AV1");
});

test("adds narrow AVI to AV1 promo lookup fallback", () => {
  assert.deepEqual(toPromotionLookupCandidates("PGC2600AVI"), ["PGC2600AVI", "PGCR2600AVI", "PGC2600AV1", "PGCR2600AV1"]);
});
