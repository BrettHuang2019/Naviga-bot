export {
  extractCheck,
  extractCoupon,
  extractIncomeDocument,
  summarizeSubscription,
  verifyRenewalCandidates,
} from "./comparison/index.js";

export type {
  CandidateReport,
  CheckExtraction,
  ComparisonCheck,
  CouponExtraction,
  CouponOption,
  CouponTermGrid,
  ExtractionConfidence,
  ExtractionMeta,
  FieldIssue,
  FieldResult,
  IncomeExtraction,
  OcrLine,
  OcrPayload,
  ParsedOcrDocument,
  SubscriptionDetail,
  SubscriptionSummary,
  VerificationContext,
  VerificationReport,
  VerificationTraceEntry,
} from "./comparison/types.js";

export { createParsedOcrDocumentFromFullText, parseOcrPayload, parseOcrText } from "./comparison/ocr-parser.js";

export { extractOcrJsonWithCodex } from "./codex-extraction.js";
export type { CodexExtractionOptions, CodexExtractionResult, CommandRunner, ExtractJson } from "./codex-extraction.js";
