import test from "node:test";
import assert from "node:assert/strict";
import { billToNameIdVerifier } from "./bill-to-name-id.js";
import { paymentAmountVerifier } from "./payment-amount.js";
import { renewalDateVerifier } from "./renewal-date.js";
import { subscriberClientNumberVerifier } from "./subscriber-client-number.js";
import { subscriberNameVerifier } from "./subscriber-name.js";
import type { CouponExtraction, SubscriptionSummary, VerificationContext } from "../types.js";

function createContext(overrides?: {
  ocr?: Partial<CouponExtraction>;
  naviga?: Partial<SubscriptionSummary>;
  today?: Date;
}): VerificationContext {
  return {
    today: overrides?.today ?? new Date("2026-04-08T00:00:00.000Z"),
    ocr: {
      file: "sample.json",
      productName: "POPI",
      subscriberName: "Evelyne Dupere",
      subscriberClientNumber: "829999",
      billToNameId: "705965",
      payerName: "Francine Despots",
      payerAddress: "4985 Rue Joseph-Ponrouge, Longueuil QC J3Y 8W7",
      offerCode: "POQ2200AV2",
      renewalCampaignCode: "POQLERE23",
      renewalDate: "04/10/2026",
      paymentAmount: 53.98,
      copies: "1",
      options: [],
      selectedOption: null,
      rawTextPreview: "",
      ...overrides?.ocr,
    },
    naviga: {
      clientNumber: "829999",
      subscriberName: "Evelyne Duperé",
      productName: "POPI Quebec",
      billToName: "Francine Despots",
      billToNameId: "705965",
      renewalName: "Francine Despots",
      renewalDate: "2026-04-10",
      totalAmount: 53.98,
      renewalTerm: "11",
      term: "11",
      ...overrides?.naviga,
    },
    trace: [],
  };
}

test("subscriber client number passes on exact match", () => {
  const result = subscriberClientNumberVerifier.verify(createContext());
  assert.equal(result.status, "pass");
});

test("subscriber client number manual-reviews missing OCR", () => {
  const result = subscriberClientNumberVerifier.verify(createContext({ ocr: { subscriberClientNumber: null } }));
  assert.equal(result.status, "manual_review");
  assert.equal(result.issues[0]?.code, "missing_ocr");
});

test("bill-to name id fails on mismatch", () => {
  const result = billToNameIdVerifier.verify(createContext({ ocr: { billToNameId: "111111" } }));
  assert.equal(result.status, "fail");
  assert.equal(result.issues[0]?.code, "mismatch");
});

test("subscriber name warns on weak mismatch", () => {
  const result = subscriberNameVerifier.verify(createContext({ ocr: { subscriberName: "Completely Different" } }));
  assert.equal(result.status, "warning");
});

test("payment amount fails when tolerance is exceeded", () => {
  const result = paymentAmountVerifier.verify(createContext({ ocr: { paymentAmount: 60 } }));
  assert.equal(result.status, "fail");
  assert.equal(result.issues[0]?.code, "amount_tolerance_exceeded");
});

test("renewal date passes when dates align within window", () => {
  const result = renewalDateVerifier.verify(createContext());
  assert.equal(result.status, "pass");
});

test("renewal date fails when OCR date is more than 3 months ahead", () => {
  const result = renewalDateVerifier.verify(createContext({ ocr: { renewalDate: "08/20/2026" } }));
  assert.equal(result.status, "fail");
  assert.equal(result.issues[0]?.code, "future_date_too_far");
});

test("renewal date manual-reviews invalid Naviga date", () => {
  const result = renewalDateVerifier.verify(createContext({ naviga: { renewalDate: "not-a-date" } }));
  assert.equal(result.status, "manual_review");
  assert.equal(result.issues[0]?.code, "invalid_date");
});
