import { addMonthsToDateString, compareDateStrings, parseLocalDate } from "../normalization.js";
import type { FieldVerifier } from "../types.js";

export const renewalDateVerifier: FieldVerifier = {
  field: "renewalDate",
  severity: "major",
  verify(ctx) {
    const today = parseLocalDate(ctx.today.toISOString().slice(0, 10));
    const normalizedOcr = parseLocalDate(ctx.ocr.renewalDate);
    const normalizedNaviga = parseLocalDate(ctx.naviga.renewalDate);

    if (!normalizedOcr) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [
          {
            code: ctx.ocr.renewalDate ? "invalid_date" : "missing_ocr",
            message: ctx.ocr.renewalDate ? "OCR renewal date is invalid." : "OCR renewal date is missing.",
          },
        ],
      };
    }

    if (!normalizedNaviga) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [
          {
            code: ctx.naviga.renewalDate ? "invalid_date" : "missing_naviga",
            message: ctx.naviga.renewalDate ? "Naviga renewal date is invalid." : "Naviga renewal date is missing.",
          },
        ],
      };
    }

    if (!today) {
      return {
        field: this.field,
        status: "manual_review",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "manual_review_required", message: "Reference date could not be normalized." }],
      };
    }

    const maxDate = addMonthsToDateString(today, 3);

    if (compareDateStrings(normalizedOcr, today) < 0) {
      return {
        field: this.field,
        status: "fail",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "past_date_too_old", message: "OCR renewal date is earlier than today." }],
      };
    }

    if (compareDateStrings(normalizedOcr, maxDate) > 0) {
      return {
        field: this.field,
        status: "fail",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "future_date_too_far", message: "OCR renewal date is more than 3 months in the future." }],
      };
    }

    if (normalizedOcr !== normalizedNaviga) {
      return {
        field: this.field,
        status: "fail",
        normalizedOcr,
        normalizedNaviga,
        issues: [{ code: "mismatch", message: "Renewal date does not match Naviga." }],
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
