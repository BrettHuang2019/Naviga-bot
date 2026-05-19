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

test("inserts X as fourth letter when promo code has three letters and option has PLUS", () => {
  assert.equal(
    toNavigaPromotionLookupCode("DEB2600AV3", { selectedOptionText: "1 year tax incl. with PLUS" }),
    "DEBX2600AV3",
  );
});

test("replaces fourth letter with X when promo code has four letters and option has EXTRA", () => {
  assert.equal(
    toNavigaPromotionLookupCode("PASP2600AV1", { selectedOptionText: "Extra 1 an pour seulement 68,93$" }),
    "PASX2600AV1",
  );
});

test("keeps R when selected option has no extra keyword", () => {
  assert.equal(toNavigaPromotionLookupCode("DEB2600AV3", { selectedOptionText: "1 year tax incl." }), "DEBR2600AV3");
});

test("detects extra option keyword case-insensitively", () => {
  assert.equal(toNavigaPromotionLookupCode("PASP2600AV1", { selectedOptionText: "with plus" }), "PASX2600AV1");
});

test("leaves promo code unchanged when prefix rule does not apply", () => {
  assert.equal(toNavigaPromotionLookupCode("AB2600AV1"), "AB2600AV1");
  assert.equal(toNavigaPromotionLookupCode("ABCDE2600AV1"), "ABCDE2600AV1");
});

test("adds narrow AVI to AV1 promo lookup fallback", () => {
  assert.deepEqual(toPromotionLookupCandidates("PGC2600AVI"), ["PGC2600AVI", "PGCR2600AVI", "PGC2600AV1", "PGCR2600AV1"]);
});
