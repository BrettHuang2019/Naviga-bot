import test from "node:test";
import assert from "node:assert/strict";
import { amountsEqual, normalizeForCompare, parseLocalDate, toAmount, toDigits } from "./normalization.js";

test("normalizeForCompare strips accents and punctuation", () => {
  assert.equal(normalizeForCompare("Évelyne Duperé"), "EVELYNE DUPERE");
});

test("toAmount parses currency text", () => {
  assert.equal(toAmount("53,98 $"), 53.98);
});

test("toDigits keeps only digits", () => {
  assert.equal(toDigits("POQ #CLIENT:705965"), "705965");
});

test("parseLocalDate accepts iso and slash dates", () => {
  assert.equal(parseLocalDate("2026-04-08"), "2026-04-08");
  assert.equal(parseLocalDate("4/8/2026"), "2026-04-08");
});

test("amountsEqual uses small tolerance", () => {
  assert.equal(amountsEqual(10, 10.01), true);
  assert.equal(amountsEqual(10, 10.03), false);
});
