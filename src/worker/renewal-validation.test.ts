import assert from "node:assert/strict";
import test from "node:test";
import { buildRenewalValidationRows, type RenewalValidationArtifacts } from "./renewal-validation.js";

function artifactsWithPrices(params: {
  naviga: number | null;
  coupon: number | null;
  check: number | null;
  excel: number | null;
}): RenewalValidationArtifacts {
  return {
    checkExtract: {
      fields: {
        amountNumber: { value: params.check },
      },
    },
    couponExtract: {
      fields: {
        selectedOption: { value: { option: "1 year", price: params.coupon } },
      },
    },
    navigaSummary: {
      pricingDetails: {
        total: params.naviga,
      },
    },
    storedCase: null,
    excelPrice: params.excel,
  };
}

function priceRow(artifacts: RenewalValidationArtifacts) {
  const row = buildRenewalValidationRows(artifacts).find((candidate) => candidate.label === "Price");
  assert.ok(row);
  return row;
}

test("price validation ignores Excel price", () => {
  const row = priceRow(artifactsWithPrices({ naviga: 53.98, coupon: 53.98, check: 53.98, excel: 99.99 }));

  assert.equal(row.status, "ok");
  assert.equal(row.message, "Naviga, coupon, and check prices align.");
  assert.equal(row.excel, undefined);
});

test("price validation still fails when Naviga, coupon, and check differ", () => {
  const row = priceRow(artifactsWithPrices({ naviga: 53.98, coupon: 53.98, check: 60, excel: 53.98 }));

  assert.equal(row.status, "error");
  assert.equal(row.message, "Price differs across Naviga, coupon, or check.");
});
