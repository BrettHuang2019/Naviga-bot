import { amountsEqual } from "../normalization.js";
import type { FieldVerifier } from "../types.js";

export const paymentAmountVerifier: FieldVerifier = {
  field: "paymentAmount",
  severity: "major",
  verify(ctx) {
    const normalizedOcr = ctx.ocr.paymentAmount;
    const normalizedNaviga = ctx.naviga.totalAmount;

    if (normalizedOcr === null) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_ocr", message: "OCR payment amount is missing." }],
      };
    }

    if (normalizedNaviga === null) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_naviga", message: "Naviga payment amount is missing." }],
      };
    }

    if (!amountsEqual(normalizedOcr, normalizedNaviga)) {
      return {
        field: this.field,
        status: "fail",
        normalizedOcr,
        normalizedNaviga,
        issues: [
          {
            code: "amount_tolerance_exceeded",
            message: "Payment amount does not match within tolerance.",
            meta: { tolerance: 0.02 },
          },
        ],
      };
    }

    return {
      field: this.field,
      status: "pass",
      normalizedOcr,
      normalizedNaviga,
      issues: [],
    };
  },
};
