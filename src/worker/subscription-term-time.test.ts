import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { resolveSubscriberClientNumber, resolveSubscriptionTermTime } from "./subscription-term-time.js";

const rootDir = path.resolve(".");

test("resolves Term/Time from coupon promo product code and selected years", async () => {
  assert.equal(
    await resolveSubscriptionTermTime(rootDir, {
      promoCode: "DEB2600AV3",
      selectedOption: {
        raw: "Extra 1 an pour seulement 68,93$ taxes incluses",
        years: 1,
        issues: null,
        amount: 68.93,
      },
    }),
    "10",
  );

  assert.equal(
    await resolveSubscriptionTermTime(rootDir, {
      promoCode: "CUR2600AV1",
      selectedOption: {
        raw: "2 years",
        years: 2,
        issues: null,
        amount: 91.93,
      },
    }),
    "18",
  );
});

test("resolves Term/Time from coupon extract report shape", async () => {
  assert.equal(
    await resolveSubscriptionTermTime(rootDir, {
      fields: {
        promoCode: { value: "PASP2600AV1" },
        selectedOption: { value: { option: "2 ans pour seulement 99,00$" } },
      },
    }),
    "12",
  );
});

test("resolves subscriber client number from coupon extract report shape", () => {
  assert.equal(
    resolveSubscriberClientNumber({
      fields: {
        subscriberClientNumber: { value: "993764" },
      },
    }),
    "993764",
  );
});

test("fails clearly when subscriber client number is missing", () => {
  assert.throws(() => resolveSubscriberClientNumber({ fields: {} }), /coupon client ID is missing/);
});

test("fails clearly when product code is not configured", async () => {
  await assert.rejects(
    () =>
      resolveSubscriptionTermTime(rootDir, {
        promoCode: "ABC2600AV1",
        selectedOption: {
          raw: "1 year",
          years: 1,
          issues: null,
          amount: 10,
        },
      }),
    /product code "ABC" is not configured/,
  );
});

test("fails clearly when selected duration is missing", async () => {
  await assert.rejects(
    () =>
      resolveSubscriptionTermTime(rootDir, {
        promoCode: "DEB2600AV3",
        selectedOption: null,
      }),
    /selected coupon duration is missing/,
  );
});
