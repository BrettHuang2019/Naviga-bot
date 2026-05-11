import { toDigits } from "../normalization.js";
import type { FieldVerifier } from "../types.js";

export const subscriberClientNumberVerifier: FieldVerifier = {
  field: "subscriberClientNumber",
  severity: "critical",
  verify(ctx) {
    const normalizedOcr = toDigits(ctx.ocr.subscriberClientNumber);
    const normalizedNaviga = toDigits(ctx.naviga.clientNumber);

    if (!normalizedOcr) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_ocr", message: "OCR subscriber client number is missing." }],
      };
    }

    if (!normalizedNaviga) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_naviga", message: "Naviga subscriber client number is missing." }],
      };
    }

    if (normalizedOcr !== normalizedNaviga) {
      return {
        field: this.field,
        status: "fail",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "mismatch", message: "Subscriber client number does not match." }],
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
