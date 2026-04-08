import { toDigits } from "../normalization.js";
import type { FieldVerifier } from "../types.js";

export const billToNameIdVerifier: FieldVerifier = {
  field: "billToNameId",
  severity: "critical",
  verify(ctx) {
    const normalizedOcr = toDigits(ctx.ocr.billToNameId);
    const normalizedNaviga = toDigits(ctx.naviga.billToNameId);

    if (!normalizedOcr) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_ocr", message: "OCR bill-to name ID is missing." }],
      };
    }

    if (!normalizedNaviga) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_naviga", message: "Naviga bill-to name ID is missing." }],
      };
    }

    if (normalizedOcr !== normalizedNaviga) {
      return {
        field: this.field,
        status: "fail",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "mismatch", message: "Bill-to name ID does not match." }],
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
