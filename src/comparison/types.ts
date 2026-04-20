export type SubscriptionDetail = {
  clientNumber?: string | null;
  subscriberName?: string | null;
  sections?: {
    summary?: Record<string, string>;
    termDetails?: Record<string, string>;
    billingInfo?: Record<string, string>;
    agentGiftInfo?: Record<string, string>;
    otherInfo?: Record<string, string>;
    pricingDetails?: Record<string, string>;
    renewal?: Record<string, string>;
  };
};

export type OcrPayload = {
  ocrText: string;
  imageLink?: string;
  responsev2?: {
    predictionOutput?: {
      fullText?: string;
    };
  };
};

export type OcrLine = {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

export type ParsedOcrDocument = {
  fullText: string;
  lines: OcrLine[];
  imageLink: string | null;
};

export type ExtractionConfidence = "high" | "medium" | "low";

export type ExtractionMeta = {
  confidence: ExtractionConfidence;
  source: "direct" | "normalized" | "inferred" | "fallback" | "conflicting";
  notes?: string[];
};

export type CouponOption = {
  raw: string;
  years: number | null;
  issues: number | null;
  amount: number | null;
};

export type CouponExtraction = {
  file: string;
  productName: string | null;
  subscriberName: string | null;
  subscriberClientNumber: string | null;
  billToNameId: string | null;
  payerName: string | null;
  payerAddress: string | null;
  promoCode: string | null;
  renewalCampaignCode: string | null;
  renewalDate: string | null;
  paymentAmount: number | null;
  copies: string | null;
  options: CouponOption[];
  selectedOption: CouponOption | null;
  rawTextPreview: string;
  fieldMeta?: Partial<Record<string, ExtractionMeta>>;
};

export type CheckExtraction = {
  file: string;
  checkNumber: string | null;
  date: string | null;
  payTo: string | null;
  amountNumber: number | null;
  amountWords: string | null;
  payerName: string | null;
  payerAddress: string | null;
  rawTextPreview: string;
  fieldMeta?: Partial<Record<string, ExtractionMeta>>;
};

export type IncomeExtraction = {
  coupon: CouponExtraction;
  check: CheckExtraction;
};

export type VerificationIssueCode =
  | "missing_ocr"
  | "missing_naviga"
  | "invalid_format"
  | "invalid_date"
  | "mismatch"
  | "future_date_too_far"
  | "past_date_too_old"
  | "amount_tolerance_exceeded"
  | "manual_review_required";

export type FieldIssue = {
  code: VerificationIssueCode;
  message: string;
  meta?: Record<string, unknown>;
};

export type ComparisonCheck = {
  field: string;
  expected: string | null;
  actual: string | null;
  status: "match" | "mismatch" | "partial" | "missing";
  weight: number;
  notes?: string;
  issues?: FieldIssue[];
};

export type VerificationTraceEntry = {
  field: string;
  rawOcr?: unknown;
  rawNaviga?: unknown;
  normalizedOcr?: unknown;
  normalizedNaviga?: unknown;
  branch: string;
  issueCodes: string[];
};

export type CandidateReport = {
  file: string;
  score: number;
  extraction: CouponExtraction;
  checks: ComparisonCheck[];
  trace?: VerificationTraceEntry[];
};

export type VerificationReport = {
  generatedAt: string;
  input: {
    subscriptionDetailPath: string;
    ocrDirectoryPath: string;
  };
  subscription: {
    clientNumber: string | null;
    subscriberName: string | null;
    productName: string | null;
    billToName: string | null;
    billToNameId: string | null;
    renewalName: string | null;
    renewalDate: string | null;
    totalAmount: number | null;
    renewalTerm: string | null;
    term: string | null;
  };
  bestCandidate: CandidateReport | null;
  topCandidates: CandidateReport[];
  recommendation: string;
  verificationStrategy: string[];
};

export type SubscriptionSummary = VerificationReport["subscription"];

export type FieldResultStatus = "pass" | "fail" | "warning" | "manual_review" | "not_applicable";

export type VerificationContext = {
  today: Date;
  ocr: CouponExtraction;
  naviga: SubscriptionSummary;
  trace?: VerificationTraceEntry[];
};

export type FieldResult = {
  field: string;
  status: FieldResultStatus;
  normalizedOcr: unknown;
  normalizedNaviga: unknown;
  issues: FieldIssue[];
};

export type FieldSeverity = "critical" | "major" | "minor" | "info";

export type FieldVerifier = {
  field: string;
  severity: FieldSeverity;
  verify(ctx: VerificationContext): FieldResult;
};
