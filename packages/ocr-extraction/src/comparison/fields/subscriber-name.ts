import { fuzzyNameMatch, normalizeForCompare } from "../normalization.js";
import type { FieldVerifier } from "../types.js";

export const subscriberNameVerifier: FieldVerifier = {
  field: "subscriberName",
  severity: "minor",
  verify(ctx) {
    const normalizedOcr = normalizeForCompare(ctx.ocr.subscriberName);
    const normalizedNaviga = normalizeForCompare(ctx.naviga.subscriberName);

    if (!normalizedOcr) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_ocr", message: "OCR subscriber name is missing." }],
      };
    }

    if (!normalizedNaviga) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "missing_naviga", message: "Naviga subscriber name is missing." }],
      };
    }

    if (!fuzzyNameMatch(ctx.ocr.subscriberName, ctx.naviga.subscriberName)) {
      return {
        field: this.field,
        status: "warning",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "mismatch", message: "Subscriber name does not confidently match." }],
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
