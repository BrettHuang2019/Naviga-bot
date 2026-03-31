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
  responsev2?: {
    predictionOutput?: {
      fullText?: string;
    };
  };
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
  offerCode: string | null;
  renewalCampaignCode: string | null;
  paymentAmount: number | null;
  copies: string | null;
  options: CouponOption[];
  selectedOption: CouponOption | null;
  rawTextPreview: string;
};

export type ComparisonCheck = {
  field: string;
  expected: string | null;
  actual: string | null;
  status: "match" | "mismatch" | "partial" | "missing";
  weight: number;
  notes?: string;
};

export type CandidateReport = {
  file: string;
  score: number;
  extraction: CouponExtraction;
  checks: ComparisonCheck[];
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function normalizeForCompare(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return stripDiacritics(value)
    .toUpperCase()
    .replace(/['’`]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeForCompare(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function toAmount(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const match = cleaned.match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function amountsEqual(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return false;
  }

  return Math.abs(left - right) < 0.02;
}

function fuzzyNameMatch(left: string | null, right: string | null): boolean {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  const smallerSetSize = Math.min(leftTokens.size, rightTokens.size);
  return shared >= Math.max(2, smallerSetSize);
}

function fuzzyAddressMatch(left: string | null, right: string | null): boolean {
  const leftTokens = tokenize(left);
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.length === 0 || rightTokens.size === 0) {
    return false;
  }

  const shared = leftTokens.filter((token) => rightTokens.has(token));
  return shared.length >= 3;
}

function productMatch(left: string | null, right: string | null): boolean {
  const leftValue = normalizeForCompare(left);
  const rightValue = normalizeForCompare(right);

  if (!leftValue || !rightValue) {
    return false;
  }

  return leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1] ? normalizeWhitespace(match[1]) : null;
}

function parseCouponOptions(lines: string[]): CouponOption[] {
  const options: CouponOption[] = [];

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!/(?:\b1\s*an\b|\blan\b|\b2\s*ans\b|\b11\s*nos\b|\b22\s*nos\b|\b11\s*num[eé]ros\b|\b22\s*num[eé]ros\b)/i.test(line)) {
      continue;
    }

    const amountMatches = [...line.matchAll(/(\d+[.,]\d{2})\s*\$/g)];
    const amount = amountMatches.length > 0 ? toAmount(amountMatches.at(-1)?.[1] ?? null) : null;
    const years = /\b2\s*ans\b/i.test(line) ? 2 : /(?:\b1\s*an\b|\blan\b)/i.test(line) ? 1 : null;
    const issuesMatch = line.match(/\((\d+)\s*(?:nos|num[eé]ros)/i);
    const issues = issuesMatch ? Number(issuesMatch[1]) : null;

    options.push({
      raw: line,
      years,
      issues,
      amount,
    });
  }

  return options;
}

function detectProductName(lines: string[]): string | null {
  for (const line of lines) {
    const normalized = normalizeWhitespace(line);
    if (/Pomme d'api/i.test(normalized)) {
      return "Pomme d'api";
    }
    if (/POPI/i.test(normalized)) {
      return "POPI";
    }
    if (/D[ÉE]BROUILLARDS?/i.test(normalized)) {
      return "Debrouillards";
    }
    if (/CURIUM/i.test(normalized)) {
      return "Curium";
    }
    if (/EXPLORATEU/i.test(normalized)) {
      return "Les Explorateurs";
    }
  }

  return null;
}

export function extractCoupon(file: string, fullText: string): CouponExtraction {
  const lines = fullText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);

  const paymentAmount = (() => {
    const currencyLines = lines.filter((line) => /\$\s*$|^\$?\s*\d+[.,]\d{2}\s*\$?$/.test(line) || /\d+[.,]\d{2}\s*\$/.test(line));
    for (const line of currencyLines) {
      const amount = toAmount(line);
      if (amount !== null) {
        return amount;
      }
    }
    return null;
  })();

  const subscriberLine = firstMatch(fullText, /Pour l'abonnement de\s*:?\s*([^\n]+)/i);
  const subscriberClientNumber =
    firstMatch(fullText, /Pour l'abonnement de\s*:?.*?no\s+de\s+client\s*[:#]?\s*(\d{4,})/i) ??
    firstMatch(fullText, /Pour l'abonnement de\s*:?\s*(\d{4,})\s+[^\n]+/i) ??
    firstMatch(fullText, /Renouv\.\s*client\s*:\s*(\d{4,})/i);
  const subscriberName = (() => {
    if (!subscriberLine) {
      return null;
    }

    let value = subscriberLine
      .replace(/^\d{4,}\s+/, "")
      .replace(/no\s+de\s+client\s*[:#]?\s*\d{4,}/i, "")
      .replace(/[()]/g, "");

    value = normalizeWhitespace(value);
    return value || null;
  })();

  const billToNameId =
    firstMatch(fullText, /\b[A-Z]{3}\s*#CLIENT\s*[:#]?\s*(\d{4,})/i) ??
    firstMatch(fullText, /\b#\s*(\d{4,})\s+\d{2}\/\d{2}\/\d{4}/i);

  const offerCode = firstMatch(fullText, /\b([A-Z]{3}\d{4}AV[0-9A-Z]+)\b/);
  const renewalCampaignCode = firstMatch(fullText, /\b([A-Z]{3,4}LERE\d{2})\b/);
  const copies = firstMatch(fullText, /Nombre de copies\s*:\s*(\d+)/i);
  const productName = detectProductName(lines);
  const options = parseCouponOptions(lines);
  const selectedOption = options.find((option) => amountsEqual(option.amount, paymentAmount)) ?? null;

  const payerName = (() => {
    const payerAnchorIndex = lines.findIndex((line) => offerCode !== null && line.includes(offerCode));
    if (payerAnchorIndex !== -1) {
      for (let index = payerAnchorIndex + 1; index < Math.min(lines.length, payerAnchorIndex + 7); index += 1) {
        const line = lines[index];
        if (/^\d{4}-\d{2}-\d{2}$/.test(line) || /Coordonn/i.test(line) || /^#?\d+$/.test(line)) {
          continue;
        }
        if (/[A-Z]/i.test(line) && !/\d{3,}/.test(line)) {
          return line;
        }
      }
    }

    const topNameCandidates = lines.slice(0, 6).filter((line) => /[A-Z]/i.test(line) && !/\d{2,}/.test(line));
    return topNameCandidates.at(1) ?? topNameCandidates.at(0) ?? null;
  })();

  const payerAddress = (() => {
    const payerAnchorIndex = lines.findIndex((line) => offerCode !== null && line.includes(offerCode));
    if (payerAnchorIndex !== -1) {
      const addressLines: string[] = [];
      for (let index = payerAnchorIndex + 1; index < Math.min(lines.length, payerAnchorIndex + 8); index += 1) {
        const line = lines[index];
        if (/Coordonn/i.test(line) || /^\d{4}-\d{2}-\d{2}$/.test(line)) {
          break;
        }
        if (/\d/.test(line)) {
          addressLines.push(line);
        }
      }
      if (addressLines.length > 0) {
        return addressLines.join(", ");
      }
    }

    return null;
  })();

  return {
    file,
    productName,
    subscriberName,
    subscriberClientNumber,
    billToNameId,
    payerName,
    payerAddress,
    offerCode,
    renewalCampaignCode,
    paymentAmount,
    copies,
    options,
    selectedOption,
    rawTextPreview: lines.slice(0, 30).join(" | "),
  };
}

export function summarizeSubscription(subscription: SubscriptionDetail): SubscriptionSummary {
  return {
    clientNumber: subscription.clientNumber ?? null,
    subscriberName: subscription.subscriberName ?? null,
    productName: subscription.sections?.summary?.["Subscription Product"] ?? null,
    billToName: subscription.sections?.billingInfo?.["Bill-To"] ?? null,
    billToNameId: subscription.sections?.agentGiftInfo?.["Bill-To Name ID"] ?? null,
    renewalName: subscription.sections?.renewal?.["Renewal Name"] ?? null,
    totalAmount: toAmount(subscription.sections?.pricingDetails?.Total),
    renewalTerm: subscription.sections?.renewal?.["Renewal Term"] ?? null,
    term: subscription.sections?.termDetails?.Term ?? null,
  };
}

function buildChecks(subscription: SubscriptionSummary, extraction: CouponExtraction): ComparisonCheck[] {
  const checks: ComparisonCheck[] = [];
  const selectedOption = extraction.selectedOption;

  const pushCheck = (check: ComparisonCheck) => {
    checks.push(check);
  };

  const subscriptionAmount = subscription.totalAmount;
  const subscriptionTermNumber = Number(subscription.renewalTerm ?? subscription.term ?? "");

  pushCheck({
    field: "subscriberClientNumber",
    expected: subscription.clientNumber,
    actual: extraction.subscriberClientNumber,
    status:
      subscription.clientNumber && extraction.subscriberClientNumber
        ? subscription.clientNumber === extraction.subscriberClientNumber
          ? "match"
          : "mismatch"
        : "missing",
    weight: 4,
  });

  pushCheck({
    field: "subscriberName",
    expected: subscription.subscriberName,
    actual: extraction.subscriberName,
    status:
      subscription.subscriberName && extraction.subscriberName
        ? fuzzyNameMatch(subscription.subscriberName, extraction.subscriberName)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 4,
  });

  pushCheck({
    field: "billToNameId",
    expected: subscription.billToNameId,
    actual: extraction.billToNameId,
    status:
      subscription.billToNameId && extraction.billToNameId
        ? subscription.billToNameId === extraction.billToNameId
          ? "match"
          : "mismatch"
        : "missing",
    weight: 4,
  });

  pushCheck({
    field: "billToOrRenewalName",
    expected: subscription.billToName ?? subscription.renewalName,
    actual: extraction.payerName,
    status:
      (subscription.billToName || subscription.renewalName) && extraction.payerName
        ? fuzzyNameMatch(subscription.billToName ?? subscription.renewalName, extraction.payerName) ||
          fuzzyNameMatch(subscription.renewalName, extraction.payerName)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 3,
  });

  pushCheck({
    field: "productName",
    expected: subscription.productName,
    actual: extraction.productName,
    status:
      subscription.productName && extraction.productName
        ? productMatch(subscription.productName, extraction.productName)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 3,
  });

  pushCheck({
    field: "paymentAmount",
    expected: subscriptionAmount !== null ? subscriptionAmount.toFixed(2) : null,
    actual: extraction.paymentAmount !== null ? extraction.paymentAmount.toFixed(2) : null,
    status:
      subscriptionAmount !== null && extraction.paymentAmount !== null
        ? amountsEqual(subscriptionAmount, extraction.paymentAmount)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 3,
  });

  pushCheck({
    field: "selectedOptionAmount",
    expected: subscriptionAmount !== null ? subscriptionAmount.toFixed(2) : null,
    actual: selectedOption?.amount !== null && selectedOption?.amount !== undefined ? selectedOption.amount.toFixed(2) : null,
    status:
      subscriptionAmount !== null && selectedOption?.amount !== null && selectedOption?.amount !== undefined
        ? amountsEqual(subscriptionAmount, selectedOption.amount)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 2,
    notes: selectedOption?.raw ?? undefined,
  });

  pushCheck({
    field: "selectedOptionTerm",
    expected: Number.isFinite(subscriptionTermNumber) ? String(subscriptionTermNumber) : null,
    actual:
      selectedOption?.issues !== null && selectedOption?.issues !== undefined
        ? String(selectedOption.issues)
        : selectedOption?.years !== null && selectedOption?.years !== undefined
          ? String(selectedOption.years * 11)
          : null,
    status:
      Number.isFinite(subscriptionTermNumber) &&
      ((selectedOption?.issues !== null && selectedOption?.issues !== undefined) ||
        (selectedOption?.years !== null && selectedOption?.years !== undefined))
        ? selectedOption?.issues === subscriptionTermNumber ||
          (selectedOption?.years !== null && selectedOption?.years !== undefined && selectedOption.years * 11 === subscriptionTermNumber)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 2,
    notes: selectedOption?.raw ?? undefined,
  });

  pushCheck({
    field: "payerAddress",
    expected: subscription.billToName,
    actual: extraction.payerAddress,
    status:
      extraction.payerAddress && subscription.billToName
        ? fuzzyAddressMatch(subscription.billToName, extraction.payerAddress)
          ? "partial"
          : "missing"
        : "missing",
    weight: 0,
    notes: "Address comparison is low-confidence because Naviga export does not expose normalized payer-address components separately in this report.",
  });

  return checks;
}

function scoreChecks(checks: ComparisonCheck[]): number {
  return checks.reduce((total, check) => {
    if (check.status === "match") {
      return total + check.weight;
    }
    if (check.status === "partial") {
      return total + Math.max(1, Math.floor(check.weight / 2));
    }
    if (check.status === "mismatch") {
      return total - check.weight;
    }
    return total;
  }, 0);
}

export function verifyRenewalCandidates(
  subscription: SubscriptionSummary,
  extractions: CouponExtraction[],
): Pick<VerificationReport, "bestCandidate" | "topCandidates" | "recommendation" | "verificationStrategy"> {
  const candidates = extractions
    .map<CandidateReport>((extraction) => {
      const checks = buildChecks(subscription, extraction);
      return {
        file: extraction.file,
        score: scoreChecks(checks),
        extraction,
        checks,
      };
    })
    .sort((left, right) => right.score - left.score);

  const bestCandidate = candidates.at(0) ?? null;
  const exactIdentityConfirmed =
    bestCandidate !== null &&
    bestCandidate.checks.some((check) => check.field === "subscriberClientNumber" && check.status === "match") &&
    bestCandidate.checks.some((check) => check.field === "billToNameId" && check.status === "match");
  const businessMismatchDetected =
    bestCandidate !== null &&
    bestCandidate.checks.some(
      (check) =>
        (check.field === "productName" || check.field === "paymentAmount" || check.field === "selectedOptionAmount") &&
        check.status === "mismatch",
    );

  return {
    bestCandidate,
    topCandidates: candidates.slice(0, 5),
    recommendation: exactIdentityConfirmed
      ? businessMismatchDetected
        ? "A strong identity match was found, but the coupon product or payment amount conflicts with Naviga. Do not confirm this renewal as the same subscription without an upstream explanation."
        : "A high-confidence one-to-one OCR match was found and the key business fields align. Review the bestCandidate checks, then accept the renewal."
      : "No OCR file produced a full one-to-one confirmation on the strongest identity keys. Use the ranked candidates to review mismatches before trusting the renewal link.",
    verificationStrategy: [
      "Treat subscriber client number and bill-to name ID as the strongest one-to-one identity keys.",
      "Use subscriber name and payer name as secondary confirmation because OCR can distort accents and spacing.",
      "Use payment amount and selected offer term to confirm the chosen renewal option, not the payer identity.",
      "Treat product title as a business-rule confirmation; it should align with the Naviga subscription product unless the workflow allows cross-title renewals.",
      "Ignore back-side-only OCR files for identity confirmation because they typically contain payment preference fields rather than subscriber linkage.",
    ],
  };
}
