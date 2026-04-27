import { fieldVerifiers } from "./registry.js";
import {
  amountsEqual,
  formatComparableValue,
  fuzzyAddressMatch,
  normalizeForCompare,
  normalizeWhitespace,
  parseLocalDate,
  productMatch,
  toAmount,
} from "./normalization.js";
import { createParsedOcrDocumentFromFullText, parseOcrPayload, parseOcrText } from "./ocr-parser.js";
import type {
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
  FieldSeverity,
  IncomeExtraction,
  OcrLine,
  OcrPayload,
  ParsedOcrDocument,
  SubscriptionDetail,
  SubscriptionSummary,
  VerificationContext,
  VerificationReport,
  VerificationTraceEntry,
} from "./types.js";

export type {
  CandidateReport,
  CheckExtraction,
  ComparisonCheck,
  CouponExtraction,
  CouponOption,
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
} from "./types.js";

type ExtractionInput = string | OcrPayload | ParsedOcrDocument;

type ParsedCouponOption = CouponOption & {
  marked: boolean;
  mark: string | null;
  unselected: boolean;
  selectionScore: number;
};

type CouponOfferCandidate = {
  text: string;
  line: OcrLine;
};

const ACCEPTED_PAYEES = [
  "Bayard Presse Canada Inc.",
  "Bayard Presse Canada",
  "Bayard Jeunesse",
  "Novalis",
  "Living with christ",
  "Publication BLD",
  "Publications BLD",
] as const;

const COUPON_ANCHOR_PATTERN =
  /(Retournez ce coupon|Je profite de cette offre|Je souhaite prolonger|Nombre de copies|Number of copies|Pour l'abonnement de|I wish to add)/i;

const PAYEE_ANCHOR_PATTERN =
  /\b(?:PAYEZ(?:\s*[ÀA])?|PAY TO(?: THE(?: ORDER OF)?)?|L'ORDRE DE|A L'ORDRE DE|À L'ORDRE DE)\b/i;

const BANK_LINE_PATTERN = /\b(BANQUE|BANK|DESJARDINS|CAISSE|CREDIT UNION|RBC|BMO|TD|SCOTIA|NATIONALE)\b/i;

const PHONE_LINE_PATTERN = /\b(T[ÉE]L|TEL|FAX|T[ÉE]L[ÉE]COPIEUR)\b/i;
const PAYEE_REJECTION_PATTERN =
  /\b(?:SACRED\s+JOURNEY|PRIONS?\s+EN\s+[ÉE]GLISE|ABONNEMENT|RENOUVEL|EXTRA|R[ÉE]GULIER|REGULIER|WITH\s+PLUS|TAX(?:ES)?\s+INCL|YEAR(?:S)?|ANS?|NUM[ÉE]ROS?|NOS?|COP(?:Y|IES)|COUPON|PROLONGER)\b/i;

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1] ? normalizeWhitespace(match[1]) : null;
}

function resolveParsedDocument(input: ExtractionInput): ParsedOcrDocument {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") && trimmed.includes("\"responsev2\"")) {
      try {
        return parseOcrText(trimmed);
      } catch {
        return createParsedOcrDocumentFromFullText(input);
      }
    }

    return createParsedOcrDocumentFromFullText(input);
  }

  if ("ocrText" in input) {
    return parseOcrPayload(input);
  }

  return input;
}

function previewLines(lines: OcrLine[], limit = 30): string {
  return lines.slice(0, limit).map((line) => line.text).join(" | ");
}

function joinLineText(lines: OcrLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

function buildMeta(confidence: ExtractionConfidence, source: ExtractionMeta["source"], notes?: string[]): ExtractionMeta {
  return notes && notes.length > 0 ? { confidence, source, notes } : { confidence, source };
}

function hasUsefulHorizontalGeometry(lines: OcrLine[]): boolean {
  return new Set(lines.map((line) => line.left.toFixed(3))).size > 1;
}

function isWithinBand(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function verticalDistance(left: OcrLine, right: OcrLine): number {
  if (left.bottom < right.top) {
    return right.top - left.bottom;
  }

  if (right.bottom < left.top) {
    return left.top - right.bottom;
  }

  return 0;
}

function rowsOverlap(left: OcrLine, right: OcrLine, tolerance = 0.012): boolean {
  return !(left.bottom + tolerance < right.top || right.bottom + tolerance < left.top);
}

function horizontalGap(left: OcrLine, right: OcrLine): number {
  if (left.right < right.left) {
    return right.left - left.right;
  }

  if (right.right < left.left) {
    return left.left - right.right;
  }

  return 0;
}

function compareDateFragmentOrder(left: OcrLine, right: OcrLine): number {
  if (Math.abs(left.top - right.top) <= 0.01) {
    return left.left - right.left || left.top - right.top;
  }

  return left.top - right.top || left.left - right.left;
}

function hasMostlyLetters(text: string): boolean {
  const letters = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  return letters > 0 && letters >= digits;
}

function isLikelyAddressLine(line: string): boolean {
  return (
    /\d/.test(line) ||
    /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i.test(line) ||
    /\b(PO\s*BOX|P\.?\s*O\.?\s*BOX|RUE|ST(?:REET)?|BOULEVARD|BLVD|CHEMIN|CROIS|CRES(?:CENT)?|AV|AVE(?:NUE)?|COURT|ROAD|RD)\b/i.test(line)
  );
}

function isStreetAddressLine(line: string): boolean {
  return (
    /\b(PO\s*BOX|P\.?\s*O\.?\s*BOX)\b/i.test(line) ||
    (/\d/.test(line) && /\b(RUE|ST(?:REET)?|BOULEVARD|BLVD|CHEMIN|CROIS|CRES(?:CENT)?|AV|AVE(?:NUE)?|COURT|ROAD|RD|RTE|ROUTE)\b/i.test(line))
  );
}

function isCityPostalLine(line: string): boolean {
  return (
    /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i.test(line) ||
    /\b(QC|ON|ONTARIO|QU[ÉE]BEC|NB|NS|AB|BC|MB|SK|PE|NL)\b/i.test(line)
  );
}

function isCouponSubscriberLine(text: string): boolean {
  return /Pour l'abonnement de/i.test(text);
}

function isIgnorableCheckLine(line: string): boolean {
  return (
    /^(DATE|PAY TO THE|PAYEZ[ÀA]?|ORDER OF|L'ORDRE DE|MEMO|POUR|#)$/i.test(line) ||
    PAYEE_ANCHOR_PATTERN.test(line) ||
    /Coordonn/i.test(line) ||
    /Je profite/i.test(line) ||
    /Retournez ce coupon/i.test(line) ||
    /Nombre de copies/i.test(line) ||
    /Pour l'abonnement de/i.test(line) ||
    /Aux parents de/i.test(line)
  );
}

function normalizeAcceptedPayee(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/\bBALIO\s+THE\b/i.test(value)) {
    return null;
  }

  if (/\bPublications?\s+BLD\b/i.test(value)) {
    return "Publications BLD";
  }

  if (/\bnova(?:le|lis|l[i1]s)\b/i.test(value)) {
    return "Novalis";
  }

  if (/\bliving\s+with\s+christ\b/i.test(value) && !/\bwith\s+sacred\s+journey\b/i.test(value)) {
    return "Living with Christ";
  }

  const normalizedValue = normalizeForCompare(value);
  for (const accepted of ACCEPTED_PAYEES) {
    const normalizedAccepted = normalizeForCompare(accepted);
    if (
      normalizedValue === normalizedAccepted ||
      normalizedValue.includes(normalizedAccepted) ||
      normalizedAccepted.includes(normalizedValue)
    ) {
      return accepted;
    }
  }

  return value;
}

function isLikelyCheckNameLine(line: OcrLine): boolean {
  if (!hasMostlyLetters(line.text)) {
    return false;
  }

  return (
    !/\d{2,}/.test(line.text) &&
    !isIgnorableCheckLine(line.text) &&
    !BANK_LINE_PATTERN.test(line.text) &&
    !PHONE_LINE_PATTERN.test(line.text)
  );
}

function cleanupPayeeCandidate(text: string): string {
  const cleaned = normalizeWhitespace(
    text
      .replace(/^(?:PAYEZ(?:\s*[ÀA])?|PAY TO(?: THE(?: ORDER OF)?)?|L'ORDRE DE|A L'ORDRE DE|À L'ORDRE DE)\s*[:.-]?\s*/i, "")
      .replace(/^[^\p{L}\d]+/u, "")
      .replace(/\s+\$?\s*\d{1,3}(?:[.,]\s*\d{2})\s*\$?\s*$/u, "")
      .replace(/\s+\$\s*\d{3,5}\s*$/u, "")
      .replace(/\s+\d{1,3}\s*\/\s*100(?:\s+DOLLARS?)?\s*$/iu, "")
      .replace(/\s+DOLLARS?\s*$/iu, ""),
  );

  if (/^(?:BALIO|PAY)\s+THE$/i.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function isPayeeCandidateText(text: string): boolean {
  const normalized = normalizeAcceptedPayee(text);
  if (normalized === null) {
    return false;
  }

  return (
    hasMostlyLetters(text) &&
    !isLikelyAddressLine(text) &&
    !BANK_LINE_PATTERN.test(text) &&
    !PHONE_LINE_PATTERN.test(text) &&
    !/\d{2}\s*\/\s*100/i.test(text) &&
    !isCouponSubscriberLine(text) &&
    !/^\s*[-.,]/.test(text) &&
    !/^[-$.,\s]+$/.test(text) &&
    !/^(?:[AMJYD]\s*){1,6}$/i.test(text) &&
    !/^(?:DATE|MEMO)$/i.test(text) &&
    !PAYEE_REJECTION_PATTERN.test(text)
  );
}

function extractMoneyCandidate(text: string): { value: string; damaged: boolean } | null {
  const match = text.match(/\$?\s*-?\s*(\d{1,3})\s*[.,]\s*(\d{2})(?!\d)\s*-?\s*\$?/);
  if (match) {
    return { value: `${match[1]}.${match[2]}`, damaged: false };
  }

  const implicitCents = text.match(/\$\s*(\d{3,5})\b/);
  if (implicitCents) {
    const digits = implicitCents[1];
    return { value: `${digits.slice(0, -2)}.${digits.slice(-2)}`, damaged: false };
  }

  const damaged = text.match(/\$?\s*-?\s*(\d{1,3})\s*[.,]\s*(\d{2})\d+\s*-?\s*\$?/);
  if (damaged) {
    return { value: `${damaged[1]}.${damaged[2]}`, damaged: true };
  }

  return null;
}

function normalizeCheckDateText(text: string): string | null {
  const normalizedText = normalizeOcrDigits(normalizeWhitespace(text).replace(/\s*-\s*/g, "-").replace(/\s*\/\s*/g, "/"));
  const yearFirst = normalizedText.match(/(\d[\d ]{3,})\s*-\s*(\d[\d ]{0,1}\d?)\s*-\s*(\d[\d ]{0,1}\d?)/);
  if (yearFirst) {
    const year = yearFirst[1].replace(/\s+/g, "");
    const month = yearFirst[2].replace(/\s+/g, "");
    const day = yearFirst[3].replace(/\s+/g, "");
    if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month) && /^\d{1,2}$/.test(day)) {
      return parseLocalDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    }
  }

  const yearFirstMissingDayHyphen = normalizedText.match(/(\d[\d ]{3,})\s*-\s*(\d[\d ]{1,2})\s+(\d[\d ]{0,1}\d?)/);
  if (yearFirstMissingDayHyphen) {
    const year = yearFirstMissingDayHyphen[1].replace(/\s+/g, "");
    const month = yearFirstMissingDayHyphen[2].replace(/\s+/g, "");
    const day = yearFirstMissingDayHyphen[3].replace(/\s+/g, "");
    if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month) && /^\d{1,2}$/.test(day)) {
      return parseLocalDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    }
  }

  return parseCheckDateCandidate(normalizedText);
}

function isLikelyDateFragmentText(text: string): boolean {
  const normalized = normalizeWhitespace(text).replace(/^DATE\b/i, "").trim();
  if (!normalized) {
    return false;
  }

  if (/^(?:[AMDJY]\s*)+$/i.test(normalized)) {
    return true;
  }

  const compactDigits = normalizeOcrDigits(normalized).replace(/[\s/-]/g, "");
  if (/^\d+$/.test(normalized) && compactDigits.length >= 3 && compactDigits.length <= 6) {
    return false;
  }

  return /^[\dOIl|\s/-]+$/.test(normalized) && compactDigits.length > 0 && compactDigits.length <= 8;
}

function extractCheckNumber(lines: OcrLine[], checkText: string): { value: string | null; meta?: ExtractionMeta } {
  const useHorizontalGeometry = hasUsefulHorizontalGeometry(lines);
  const candidates = lines
    .filter((line) => isWithinBand(line.top, 0, 0.26) && (!useHorizontalGeometry || line.left >= 0.58))
    .map((line) => ({ line, digits: line.text.replace(/\s+/g, "") }))
    .filter(({ digits }) => /^\d{3,6}$/.test(digits))
    .sort((left, right) => (useHorizontalGeometry ? right.line.left - left.line.left : left.line.top - right.line.top) || left.line.top - right.line.top);

  if (candidates.length === 1) {
    return { value: candidates[0].digits, meta: buildMeta("high", "direct") };
  }

  if (candidates.length > 1) {
    return {
      value: candidates[0].digits,
      meta: buildMeta("medium", "direct", ["Multiple upper-right check number candidates; chose the farthest-right token."]),
    };
  }

  return { value: null };
}

function extractCheckDate(lines: OcrLine[], checkText: string): { value: string | null; meta?: ExtractionMeta } {
  const useHorizontalGeometry = hasUsefulHorizontalGeometry(lines);
  const topRightLines = lines.filter((line) => line.top <= 0.3 && (!useHorizontalGeometry || line.left >= 0.45));
  const anchors = topRightLines.filter((line) => /\bDATE\b/i.test(line.text)).sort((left, right) => left.top - right.top || right.left - left.left);

  for (const anchor of anchors) {
    const inline = normalizeCheckDateText(anchor.text.replace(/^.*?\bDATE\b\s*/i, ""));
    if (inline) {
      return { value: inline, meta: buildMeta("high", "direct") };
    }

    const nearby = topRightLines
      .filter(
        (line) =>
          line !== anchor &&
          line.top >= anchor.top - 0.03 &&
          line.top <= anchor.bottom + 0.035 &&
          line.right >= anchor.left - 0.12 &&
          line.left <= anchor.right + 0.13 &&
          verticalDistance(anchor, line) <= 0.07 &&
          isLikelyDateFragmentText(line.text),
      )
      .sort(compareDateFragmentOrder);

    const mergedNearby = normalizeCheckDateText([anchor.text, ...nearby.map((line) => line.text)].join(" "));
    if (mergedNearby) {
      return {
        value: mergedNearby,
        meta: buildMeta("medium", "normalized", ["Recovered the date from a DATE anchor plus nearby OCR fragments."]),
      };
    }

    for (const candidate of nearby) {
      const merged = normalizeCheckDateText(`${anchor.text} ${candidate.text}`);
      if (merged) {
        return {
          value: merged,
          meta: buildMeta("medium", "normalized", ["Recovered the date from a DATE anchor plus a nearby OCR line."]),
        };
      }
    }
  }

  const standalone = topRightLines
    .map((line) => {
      const nearby = topRightLines
        .filter(
          (candidate) =>
            candidate !== line &&
            candidate.top >= line.top - 0.01 &&
            candidate.top <= line.bottom + 0.035 &&
            candidate.right >= line.left - 0.05 &&
            candidate.left <= line.right + 0.12 &&
            verticalDistance(line, candidate) <= 0.04 &&
            isLikelyDateFragmentText(candidate.text),
        )
        .sort(compareDateFragmentOrder);

      return {
        line,
        value: normalizeCheckDateText([line.text, ...nearby.map((candidate) => candidate.text)].join(" ")),
      };
    })
    .find((candidate) => candidate.value !== null);
  if (standalone?.value) {
    return {
      value: standalone.value,
      meta: buildMeta("medium", "normalized", ["Recovered the date from a standalone top-right date-like line."]),
    };
  }

  return { value: null };
}

function extractPayTo(lines: OcrLine[]): { value: string | null; meta?: ExtractionMeta } {
  const useHorizontalGeometry = hasUsefulHorizontalGeometry(lines);
  const anchorIndex = lines.findIndex(
    (line) =>
      isWithinBand(line.top, 0.22, 0.33) &&
      (!useHorizontalGeometry || (line.left >= 0.05 && line.left <= 0.45)) &&
      (/\bPAYEZ\b/i.test(line.text) || /\bPAY TO\b/i.test(line.text) || /^L'ORDRE DE$/i.test(line.text)),
  );

  if (anchorIndex === -1) {
    return { value: null };
  }

  const anchor = lines[anchorIndex];
  const inline = cleanupPayeeCandidate(anchor.text);
  const normalizedInline = normalizeAcceptedPayee(inline);
  if (inline && normalizedInline && isPayeeCandidateText(inline)) {
    return { value: normalizedInline, meta: buildMeta("high", "direct") };
  }

  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => {
      if (index === anchorIndex || !isWithinBand(line.top, 0.2, 0.33)) {
        return false;
      }

      if (Math.abs(index - anchorIndex) > 6) {
        return false;
      }

      if (/\bPAYEZ\b/i.test(line.text) || /\bPAY TO\b/i.test(line.text) || /^L'ORDRE DE$/i.test(line.text) || /^À$/i.test(line.text)) {
        return false;
      }

      const cleaned = cleanupPayeeCandidate(line.text);
      return cleaned.length > 0 && isPayeeCandidateText(cleaned);
    })
    .map(({ line, index }) => ({
      cleaned: cleanupPayeeCandidate(line.text),
      normalized: normalizeAcceptedPayee(cleanupPayeeCandidate(line.text)),
      score:
        (line.left > anchor.right ? 0 : 2) +
        (line.top < anchor.top ? 0 : 3) +
        Math.abs(index - anchorIndex) +
        (normalizeAcceptedPayee(cleanupPayeeCandidate(line.text)) ? 0 : 6) +
        verticalDistance(anchor, line) * 100 +
        horizontalGap(anchor, line) * 100,
    }))
    .sort((left, right) => left.score - right.score);

  if (candidates.length === 0) {
    return { value: null };
  }

  return {
    value: candidates[0].normalized ?? candidates[0].cleaned,
    meta: buildMeta(candidates.length === 1 ? "high" : "medium", "direct"),
  };
}

function extractCheckAmountNumeric(lines: OcrLine[]): { value: number | null; meta?: ExtractionMeta } {
  const useHorizontalGeometry = hasUsefulHorizontalGeometry(lines);
  const payeeAnchor = lines.find(
    (line) =>
      isWithinBand(line.top, 0.22, 0.33) &&
      (/\bPAYEZ\b/i.test(line.text) || /\bPAY TO\b/i.test(line.text) || /^L'ORDRE DE$/i.test(line.text)),
  );
  const candidates = lines
    .filter((line) => {
      if (!isWithinBand(line.top, 0.22, 0.34)) {
        return false;
      }

      if (!useHorizontalGeometry || line.left >= 0.55) {
        return true;
      }

      return (
        /\$/.test(line.text) ||
        /\b(?:Bayard|Publication|Publications)\b/i.test(line.text) ||
        (payeeAnchor !== undefined && verticalDistance(payeeAnchor, line) <= 0.035 && line.left > payeeAnchor.left)
      );
    })
    .map((line) => ({
      line,
      value: extractMoneyCandidate(line.text),
    }))
    .filter((candidate): candidate is { line: OcrLine; value: { value: string; damaged: boolean } } => candidate.value !== null)
    .sort(
      (left, right) =>
        Number(left.value.damaged) - Number(right.value.damaged) ||
        (useHorizontalGeometry ? right.line.left - left.line.left : left.line.top - right.line.top) ||
        left.line.top - right.line.top,
    );

  if (candidates.length === 0) {
    return { value: null };
  }

  const amount = Number(candidates[0].value.value);
  return {
    value: Number.isFinite(amount) ? amount : null,
    meta:
      candidates.length === 1
        ? buildMeta("high", "direct")
        : buildMeta(
            candidates[0].value.damaged ? "low" : "medium",
            "direct",
            [
              candidates[0].value.damaged
                ? "Multiple right-side amount candidates were damaged; chose the least-damaged value."
                : "Multiple right-side amount candidates; preferred the cleanest farthest-right value.",
            ],
          ),
  };
}

function extractCheckAmountWords(lines: OcrLine[]): string | null {
  const useHorizontalGeometry = hasUsefulHorizontalGeometry(lines);
  const wordsBand = lines.filter(
    (line) => isWithinBand(line.top, 0.24, 0.43) && (!useHorizontalGeometry || isWithinBand(line.left, 0.08, 0.72)),
  );
  const normalizeWords = (text: string): string =>
    normalizeWhitespace(text.replace(/^\s*[-.,·]+/, "").replace(/\s*-\s*/g, "-").replace(/\s*\/\s*/g, " / "));
  const isAmountWordLine = (line: OcrLine): boolean =>
    hasMostlyLetters(line.text) &&
    !/\d/.test(line.text) &&
    !PAYEE_ANCHOR_PATTERN.test(line.text) &&
    !BANK_LINE_PATTERN.test(line.text) &&
    !/^(?:[AMJYD]\s*){1,6}$/i.test(line.text) &&
    !/\b(MOD[ÈE]LE|CARACT[ÉE]RISTIQUES|S[ÉE]CURIT[ÉE]|D[ÉE]TAILS)\b/i.test(line.text);
  const nearbyCents = (candidate: OcrLine): OcrLine | undefined =>
    wordsBand.find(
      (line) =>
        line !== candidate &&
        /^\d{2}$/.test(line.text) &&
        Math.abs(line.top - candidate.top) <= 0.025 &&
        line.left > candidate.left,
    );
  const nearbyFraction = (candidate: OcrLine): OcrLine | undefined =>
    wordsBand.find(
      (line) =>
        line !== candidate &&
        (/\d{2}\s*\/\s*100/i.test(line.text) ||
          /\d{2}\s*\/\s*10$/i.test(line.text) ||
          /^100 DOLLARS/i.test(line.text) ||
          /^[A-Z]\s*\/\s*100 DOLLARS/i.test(line.text)) &&
        verticalDistance(candidate, line) <= 0.035,
    );
  const orderAnchor = lines.find((line) => /ORDER OF|L'ORDRE DE/i.test(line.text));
  if (orderAnchor) {
    const candidate = wordsBand.find(
      (line) =>
        line !== orderAnchor &&
        line.top >= orderAnchor.top &&
        verticalDistance(orderAnchor, line) <= 0.03 &&
        line.top <= orderAnchor.top + 0.05 &&
        isAmountWordLine(line),
    );
    if (candidate) {
      const centsLine = nearbyCents(candidate);
      const fractionLine = nearbyFraction(candidate);
      const fractionText =
        fractionLine && centsLine && !/\d{2}\s*\/\s*100/i.test(fractionLine.text)
          ? `${centsLine.text}/${fractionLine.text}`
          : fractionLine && /\d{2}\s*\/\s*10$/i.test(fractionLine.text)
            ? `${fractionLine.text.replace(/\s*\/\s*10$/i, "")}/100 DOLLARS`
          : fractionLine?.text;
      return normalizeWords([candidate.text, fractionText].filter(Boolean).join(" "));
    }
  }

  const withFraction = wordsBand.find((line) => /\d{2}\s*\/\s*100/i.test(line.text) && hasMostlyLetters(line.text));
  if (withFraction) {
    return normalizeWords(withFraction.text);
  }

  return null;
}

function extractPayerName(lines: OcrLine[]): string | null {
  if (!hasUsefulHorizontalGeometry(lines)) {
    const payToIndex = lines.findIndex((line) => PAYEE_ANCHOR_PATTERN.test(line.text));
    const candidates = lines.slice(0, Math.min(payToIndex === -1 ? 8 : payToIndex, 8));
    const filtered = candidates.filter(
      (line) => /[A-Z]/i.test(line.text) && !isLikelyAddressLine(line.text) && !isIgnorableCheckLine(line.text),
    );
    return filtered.at(-1)?.text ?? null;
  }

  const candidates = lines
    .filter(
      (line) =>
        isWithinBand(line.top, 0.14, 0.26) &&
        line.left <= 0.4 &&
        isLikelyCheckNameLine(line) &&
        !/\b(?:Bayard|Publication|Publications)\b/i.test(line.text),
    )
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const first = candidates[0];
  if (!first) {
    return null;
  }

  const merged = [first.text];
  for (const candidate of candidates.slice(1)) {
    if (candidate.top <= first.bottom + 0.02 && !isLikelyAddressLine(candidate.text)) {
      merged.push(candidate.text);
    }
  }

  return normalizeWhitespace(merged.join(" ; "));
}

function extractPayerAddress(lines: OcrLine[], payerName: string | null): string | null {
  if (!hasUsefulHorizontalGeometry(lines)) {
    const payToIndex = lines.findIndex((line) => PAYEE_ANCHOR_PATTERN.test(line.text));
    const candidates = lines.slice(0, Math.min(payToIndex === -1 ? 10 : payToIndex, 10));
    const addressLines = candidates.filter(
      (line) => isLikelyAddressLine(line.text) && !/^DATE$/i.test(line.text) && !/^\d[\d\s]+$/.test(line.text),
    );
    return addressLines.length > 0 ? addressLines.map((line) => line.text).join(", ") : null;
  }

  const nameLine = payerName
    ? lines.find((line) => payerName.split(" ; ").some((part) => normalizeForCompare(line.text) === normalizeForCompare(part)))
    : null;
  if (nameLine) {
    const ordered = lines
      .filter((line) => line.left <= Math.min(0.42, nameLine.left + 0.28))
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const startIndex = ordered.findIndex((line) => line === nameLine);
    if (startIndex !== -1) {
      const addressLines: OcrLine[] = [];
      for (let index = startIndex + 1; index < Math.min(ordered.length, startIndex + 5); index += 1) {
        const line = ordered[index];
        if (
          line.top > 0.31 ||
          PHONE_LINE_PATTERN.test(line.text) ||
          BANK_LINE_PATTERN.test(line.text) ||
          PAYEE_ANCHOR_PATTERN.test(line.text) ||
          /\bDATE\b/i.test(line.text) ||
          isCouponSubscriberLine(line.text)
        ) {
          break;
        }
        if (addressLines.length === 0) {
          if (!isStreetAddressLine(line.text) && !isCityPostalLine(line.text)) {
            break;
          }
          addressLines.push(line);
          continue;
        }
        if (verticalDistance(addressLines.at(-1)!, line) > 0.03) {
          break;
        }
        if (isStreetAddressLine(line.text) || isCityPostalLine(line.text)) {
          addressLines.push(line);
        } else {
          break;
        }
        if (addressLines.length >= 3) {
          break;
        }
      }
      if (addressLines.length > 0) {
        return normalizeWhitespace(addressLines.map((line) => line.text).join(", "));
      }
    }
  }

  const fallback = lines
    .filter(
      (line) =>
        line.top >= 0.19 &&
        line.top <= 0.31 &&
        line.left <= 0.42 &&
        (isStreetAddressLine(line.text) || isCityPostalLine(line.text)) &&
        !PHONE_LINE_PATTERN.test(line.text) &&
        !BANK_LINE_PATTERN.test(line.text) &&
        !PAYEE_ANCHOR_PATTERN.test(line.text) &&
        !/\bDATE\b/i.test(line.text),
    )
    .sort((left, right) => left.top - right.top || left.left - right.left);
  return fallback.length > 0 ? normalizeWhitespace(fallback.map((line) => line.text).join(", ")) : null;
}

function splitIncomeDocumentLines(document: ParsedOcrDocument): { checkLines: OcrLine[]; couponLines: OcrLine[] } {
  const anchorIndex = document.lines.findIndex((line) => COUPON_ANCHOR_PATTERN.test(line.text));
  if (anchorIndex !== -1) {
    if (hasUsefulHorizontalGeometry(document.lines)) {
      const anchor = document.lines[anchorIndex];
      const offerStartTop =
        document.lines
          .slice(0, anchorIndex)
          .filter((line) => line.top >= Math.max(0.45, anchor.top - 0.2) && hasCouponOptionLabel(line.text) && extractDecimalAmounts(line.text).length > 0)
          .map((line) => line.top)
          .sort((left, right) => left - right)[0] ?? anchor.top;
      const couponStartTop = Math.min(anchor.top, offerStartTop);

      return {
        checkLines: document.lines.filter((line) => line.top < couponStartTop),
        couponLines: document.lines.filter((line) => line.top >= couponStartTop),
      };
    }

    return {
      checkLines: document.lines.slice(0, anchorIndex),
      couponLines: document.lines.slice(anchorIndex),
    };
  }

  const tops = document.lines.map((line) => line.top);
  const maxTop = tops.length > 0 ? Math.max(...tops) : 1;
  const minTop = tops.length > 0 ? Math.min(...tops) : 0;
  const threshold = maxTop <= 1.25 ? 0.55 : minTop + (maxTop - minTop) * 0.55;

  return {
    checkLines: document.lines.filter((line) => line.top < threshold),
    couponLines: document.lines.filter((line) => line.top >= threshold),
  };
}

type CompactDateLayout = "year-first" | "month-first" | "day-first" | null;

function detectCompactDateLayout(text: string): CompactDateLayout {
  const normalized = normalizeWhitespace(text).toUpperCase().replace(/[^A-Z]/g, "");

  if (
    /(YYYYMMDD|AAAAMMJJ|AAAAMMDD)/.test(normalized) ||
    /(?:Y{4}M{2}D{2}|A{4}M{2}J{2}|A{4}M{2}D{2})/.test(normalized)
  ) {
    return "year-first";
  }

  if (/(MMDDYYYY|MMJJAAAA)/.test(normalized) || /(?:M{2}D{2}Y{4}|M{2}J{2}A{4})/.test(normalized)) {
    return "month-first";
  }

  if (/(DDMMYYYY|JJMMAAAA)/.test(normalized) || /(?:D{2}M{2}Y{4}|J{2}M{2}A{4})/.test(normalized)) {
    return "day-first";
  }

  return null;
}

function parseMonthDayYearDigits(digits: string, layout: CompactDateLayout): string | null {
  if (digits.length === 8 && /^20\d{6}$/.test(digits)) {
    return parseLocalDate(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
  }

  if (digits.length !== 8) {
    return null;
  }

  const monthFirst = parseLocalDate(`${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`);
  const dayFirst = parseLocalDate(`${digits.slice(2, 4)}/${digits.slice(0, 2)}/${digits.slice(4, 8)}`);

  if (layout === "month-first") {
    return monthFirst;
  }

  if (layout === "day-first") {
    return dayFirst;
  }

  if (layout === "year-first") {
    return null;
  }

  if (monthFirst && !dayFirst) {
    return monthFirst;
  }

  if (dayFirst && !monthFirst) {
    return dayFirst;
  }

  return null;
}

function parseCheckDateCandidate(text: string): string | null {
  const normalized = normalizeWhitespace(text).replace(/\s*-\s*/g, "-").replace(/\s*\/\s*/g, "/");
  const direct = parseLocalDate(normalized.replace(/^DATE\s+/i, ""));
  if (direct) {
    return direct;
  }

  return parseMonthDayYearDigits(normalizeOcrDigits(text).replace(/\D/g, ""), detectCompactDateLayout(text));
}

function extractDecimalAmounts(text: string): number[] {
  return [...text.matchAll(/(\d+[.,]\d{2})/g)]
    .map((match) => toAmount(match[1]))
    .filter((value): value is number => value !== null);
}

function extractAmounts(text: string, options: { allowImplicitCents?: boolean } = {}): number[] {
  const explicit = extractDecimalAmounts(text);
  if (explicit.length > 0) {
    return explicit;
  }

  if (!options.allowImplicitCents) {
    return [];
  }

  return [...text.matchAll(/\$\s*(\d{3,5})(?!\d)/g)]
    .map((match) => Number(match[1]) / 100)
    .filter((value) => Number.isFinite(value) && value > 0 && value < 10000);
}

function correctAmountWithWrittenCents(amount: number, lines: OcrLine[], amountLineIndex: number): number {
  const currentCents = Math.round((amount - Math.trunc(amount)) * 100);
  const nearby = lines.slice(amountLineIndex + 1, Math.min(lines.length, amountLineIndex + 7));

  for (let index = 0; index < nearby.length; index += 1) {
    const text = normalizeWhitespace(nearby[index].text);
    const inline = text.match(/\b(\d{2})\s*\/\s*100\b/i);
    const split = text.match(/^(\d{2})$/) && /100\s+DOLLARS?/i.test(nearby[index + 1]?.text ?? "");
    const cents = inline?.[1] ?? (split ? text : null);

    if (cents && Number(cents) !== currentCents) {
      return Math.trunc(amount) + Number(cents) / 100;
    }
  }

  return amount;
}

function extractCheckAmountFromLines(lines: OcrLine[]): number | null {
  const payToIndex = lines.findIndex((line) => /PAY TO THE|PAYEZ[ÀA]?/i.test(line.text));
  const orderIndex = lines.findIndex((line) => /ORDER OF|L'ORDRE DE/i.test(line.text));
  const searchPool = lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => {
      if (payToIndex !== -1 && Math.abs(index - payToIndex) <= 2) {
        return true;
      }
      if (orderIndex !== -1 && index >= Math.max(0, orderIndex - 3) && index <= orderIndex + 3) {
        return true;
      }
      return false;
    });

  for (const { line, index } of searchPool) {
    const amount = extractAmounts(line.text, { allowImplicitCents: true }).at(-1);
    if (amount !== undefined) {
      return correctAmountWithWrittenCents(amount, lines, index);
    }
  }

  for (const [index, line] of lines.slice(0, Math.min(lines.length, 12)).entries()) {
    const amount = extractAmounts(line.text, { allowImplicitCents: true }).at(-1);
    if (amount !== undefined) {
      return correctAmountWithWrittenCents(amount, lines, index);
    }
  }

  return null;
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeOcrDigits(text: string): string {
  return text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
}

function findStandaloneClientNumberTokens(text: string): string[] {
  return [...normalizeOcrDigits(text).matchAll(/(?<!\d)(\d{6,7})(?!\d)/g)].map((match) => match[1]);
}

type ClientCandidate = {
  value: string;
  priority: number;
  confidence: ExtractionConfidence;
  source: ExtractionMeta["source"];
  line: string;
};

function extractCouponClientNumber(lines: OcrLine[]): { value: string | null; meta?: ExtractionMeta } {
  const candidates: ClientCandidate[] = [];
  const subscriberAnchors = lines.filter((line) => /Pour l'abonnement de/i.test(line.text));

  for (const line of lines) {
    const text = normalizeWhitespace(line.text);
    const lowerPriorityRegion = line.top < 0.5;
    if (lowerPriorityRegion) {
      continue;
    }

    const hasSubscriberAnchor = /Pour l'abonnement de/i.test(text);
    const hasClientAnchor = /\bno\s*,?\s*de\s+client\b|\bno\s+client\b|\bNo\s+Client\s*#\b|#\s*CLIENT\b/i.test(text);
    const nearSubscriberBlock = subscriberAnchors.some((anchor) => verticalDistance(anchor, line) <= 0.035);
    const clientNumberTokens = findStandaloneClientNumberTokens(text);

    if (hasSubscriberAnchor && hasClientAnchor) {
      for (const value of clientNumberTokens) {
        candidates.push({ value, priority: 1, confidence: "high", source: "direct", line: text });
      }
      continue;
    }

    if (hasClientAnchor) {
      for (const value of clientNumberTokens) {
        candidates.push({
          value,
          priority: hasSubscriberAnchor ? 1 : nearSubscriberBlock || subscriberAnchors.length === 0 ? 2 : 5,
          confidence: /#\s*CLIENT\b|\bNo\s+Client\s*#/i.test(text) ? "medium" : "high",
          source: "direct",
          line: text,
        });
      }
      continue;
    }

    if (hasSubscriberAnchor) {
      for (const value of clientNumberTokens) {
        candidates.push({ value, priority: 3, confidence: "high", source: "direct", line: text });
      }
      continue;
    }

    if (/^[A-Z]{3,4}\s+\d{6,7}\s+\d{1,2}\/\d{1,2}\/\d{4}$/i.test(text)) {
      for (const value of clientNumberTokens) {
        candidates.push({ value, priority: 4, confidence: "medium", source: "fallback", line: text });
      }
    }
  }

  if (candidates.length === 0) {
    return { value: null };
  }

  const bestPriority = Math.min(...candidates.map((candidate) => candidate.priority));
  const strongest = candidates.filter((candidate) => candidate.priority === bestPriority);
  const strongestValues = uniqueValues(strongest.map((candidate) => candidate.value));

  if (strongestValues.length > 1) {
    return {
      value: null,
      meta: buildMeta("low", "conflicting", [
        `Multiple equally strong coupon client candidates found: ${strongestValues.join(", ")}.`,
      ]),
    };
  }

  const weakerConflicts = uniqueValues(candidates.filter((candidate) => candidate.value !== strongestValues[0]).map((candidate) => candidate.value));
  const best = strongest[0];
  return {
    value: best.value,
    meta: buildMeta(
      weakerConflicts.length > 0 ? "medium" : best.confidence,
      weakerConflicts.length > 0 ? "conflicting" : best.source,
      weakerConflicts.length > 0
        ? [`Ignored weaker coupon client candidate(s): ${weakerConflicts.join(", ")}.`]
        : best.priority === 4
          ? [`Used product/date fallback line: ${best.line}.`]
          : undefined,
    ),
  };
}

function extractCouponPromoCode(lines: OcrLine[]): { value: string | null; meta?: ExtractionMeta } {
  const candidates = uniqueValues(
    lines
      .filter((line) => line.top >= 0.55)
      .flatMap((line) => {
        const upper = line.text.toUpperCase();
        return [...upper.matchAll(/[A-Z]{3,4}[0-9]{4}[A-Z0-9]{2,}/g)].map((match) => ({
          value: match[0],
          cleanLine: upper.trim() === match[0],
          preferredBand: line.top >= 0.6 && line.top <= 0.72,
          line: line.text,
        }));
      }),
  );

  const values = uniqueValues(candidates.map((candidate) => candidate.value));
  if (values.length === 0) {
    return { value: null, meta: buildMeta("low", "conflicting", ["No promo-like coupon token was found."]) };
  }

  if (values.length === 1) {
    const candidate = candidates.find((item) => item.value === values[0])!;
    const numericBlock = Number(candidate.value.match(/[0-9]{4}/)?.[0] ?? NaN);
    const notes =
      Number.isFinite(numericBlock) && numericBlock < 2020 && numericBlock !== 2200
        ? ["Promo token numeric block may be OCR-damaged."]
        : undefined;
    return {
      value: candidate.value,
      meta: buildMeta(candidate.cleanLine && candidate.preferredBand && !notes ? "high" : "medium", candidate.cleanLine ? "direct" : "normalized", notes),
    };
  }

  const preferredValues = uniqueValues(candidates.filter((candidate) => candidate.preferredBand).map((candidate) => candidate.value));
  if (preferredValues.length === 1) {
    return {
      value: preferredValues[0],
      meta: buildMeta("medium", "conflicting", [`Multiple promo candidates found: ${values.join(", ")}; chose the one in the coupon promo band.`]),
    };
  }

  return {
    value: null,
    meta: buildMeta("low", "conflicting", [`Multiple coupon promo candidates found: ${values.join(", ")}.`]),
  };
}

function leadingOptionMark(text: string): { mark: string | null; marked: boolean; unselected: boolean; score: number } {
  const trimmed = text.trimStart();
  const mark = trimmed.match(/^[XxLM1₡€¢•*0£₪Z]/u)?.[0] ?? null;
  if (!mark) {
    return { mark: null, marked: false, unselected: false, score: 0 };
  }

  if (mark === "0") {
    return { mark, marked: false, unselected: true, score: -1 };
  }

  if (mark === "1" && !/^1\s+(?=(?:2\s*ans?|Extra|R[ée]gulier|6\s*mois))/i.test(trimmed)) {
    return { mark: null, marked: false, unselected: false, score: 0 };
  }

  return { mark, marked: true, unselected: false, score: /[XxLM1]/.test(mark) ? 3 : 2 };
}

function detectCouponOptionYears(text: string): number | null {
  if (/\b2\s*(?:ans?|years?)\b/i.test(text)) {
    return 2;
  }

  if (/(?:\b1\s*(?:an|ans|year|years)\b|\b1an\b|\blan\b|\balan\b)/i.test(text)) {
    return 1;
  }

  return null;
}

function hasCouponOptionLabel(text: string): boolean {
  return (
    detectCouponOptionYears(text) !== null ||
    /\b6\s*mois\b/i.test(text) ||
    /\b(?:11|12|22|24)\s*(?:nos|num[eé]ros)\b/i.test(text)
  );
}

function isAmountOnlyCouponLine(text: string): boolean {
  return extractDecimalAmounts(text).length > 0 && !hasCouponOptionLabel(text);
}

function isLabelOnlyCouponLine(text: string): boolean {
  return extractDecimalAmounts(text).length === 0 && detectCouponOptionYears(text) !== null;
}

function canMergeCouponOfferLines(left: OcrLine, right: OcrLine): boolean {
  return rowsOverlap(left, right, 0.018) || (verticalDistance(left, right) <= 0.025 && horizontalGap(left, right) <= 0.18);
}

function addCouponOfferCandidate(
  candidates: CouponOfferCandidate[],
  seen: Set<string>,
  line: OcrLine,
  text: string,
): void {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return;
  }

  const key = `${line.top.toFixed(3)}:${line.left.toFixed(3)}:${normalized}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push({ text: normalized, line });
}

function buildCouponOfferCandidates(lines: OcrLine[]): CouponOfferCandidate[] {
  const candidates: CouponOfferCandidate[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    addCouponOfferCandidate(candidates, seen, line, line.text);
    for (const neighbor of lines) {
      if (neighbor === line || !canMergeCouponOfferLines(line, neighbor)) {
        continue;
      }

      if (isAmountOnlyCouponLine(line.text) && isLabelOnlyCouponLine(neighbor.text)) {
        addCouponOfferCandidate(candidates, seen, line, `${line.text} ${neighbor.text}`);
      }

      if (isLabelOnlyCouponLine(line.text) && isAmountOnlyCouponLine(neighbor.text)) {
        addCouponOfferCandidate(candidates, seen, neighbor, `${neighbor.text} ${line.text}`);
      }
    }
  }

  return candidates;
}

function parseCouponOption(line: OcrLine): ParsedCouponOption | null {
  const text = normalizeWhitespace(line.text);
  if (!hasCouponOptionLabel(text)) {
    return null;
  }

  const amount = extractDecimalAmounts(text).at(-1) ?? null;
  if (amount === null) {
    return null;
  }

  const issuesMatch = text.match(/\((\d+)\s*(?:nos|num[eé]ros)/i);
  const mark = leadingOptionMark(text);
  return {
    raw: text,
    years: detectCouponOptionYears(text),
    issues: issuesMatch ? Number(issuesMatch[1]) : null,
    amount,
    marked: mark.marked,
    mark: mark.mark,
    unselected: mark.unselected,
    selectionScore: mark.score,
  };
}

function emptyCouponTermGrid(): CouponTermGrid {
  return {
    regular1Year: null,
    regular2Year: null,
    extra1Year: null,
    extra2Year: null,
  };
}

type CouponTermGridKey = keyof CouponTermGrid;

function detectCouponTermGridKey(text: string): CouponTermGridKey | null {
  const normalized = normalizeWhitespace(text);
  const years = detectCouponOptionYears(normalized);
  if (years === null) {
    return null;
  }

  const isExtra = /\bEXTRA\b/i.test(normalized) || /\bWITH\s+PLUS\b/i.test(normalized) || /\bPLUS\b/i.test(normalized);
  if (isExtra) {
    return years === 2 ? "extra2Year" : "extra1Year";
  }

  if (/\bR[ÉE]GULIER\b/i.test(normalized) || /\bREGULIER\b/i.test(normalized) || years !== null) {
    return years === 2 ? "regular2Year" : "regular1Year";
  }

  return null;
}

function extractCouponTermGrid(lines: OcrLine[]): { value: CouponTermGrid; meta?: ExtractionMeta } {
  const termGrid = emptyCouponTermGrid();
  const useHorizontalGeometry = hasUsefulHorizontalGeometry(lines);
  const subscriberAnchorIndex = lines.findIndex((line) => /Pour l'abonnement de/i.test(line.text));
  const offerLines = (subscriberAnchorIndex === -1 ? lines : lines.slice(0, subscriberAnchorIndex)).filter(
    (line) => !useHorizontalGeometry || line.top >= 0.5,
  );
  const candidates = buildCouponOfferCandidates(offerLines);
  const scored = new Map<CouponTermGridKey, { amount: number; score: number; line: string }>();
  const conflicts: string[] = [];

  for (const candidate of candidates) {
    const key = detectCouponTermGridKey(candidate.text);
    if (!key) {
      continue;
    }

    const amount = extractDecimalAmounts(candidate.text).at(-1);
    if (amount === undefined) {
      continue;
    }

    const score =
      (/\bEXTRA\b/i.test(candidate.text) || /\bWITH\s+PLUS\b/i.test(candidate.text) ? 3 : 0) +
      (/\bR[ÉE]GULIER\b/i.test(candidate.text) || /\bREGULIER\b/i.test(candidate.text) ? 2 : 0) +
      (/\b(?:1|2)\s*(?:ans?|years?)\b/i.test(candidate.text) ? 1 : 0) +
      normalizeWhitespace(candidate.text).length / 1000;
    const previous = scored.get(key);

    if (!previous || score > previous.score) {
      if (previous && previous.line !== candidate.text) {
        conflicts.push(`Duplicate ${key} row; kept "${normalizeWhitespace(candidate.text)}".`);
      }
      scored.set(key, { amount, score, line: normalizeWhitespace(candidate.text) });
    } else if (previous.line !== candidate.text) {
      conflicts.push(`Duplicate ${key} row; kept "${previous.line}".`);
    }
  }

  for (const [key, candidate] of scored.entries()) {
    termGrid[key] = candidate.amount;
  }

  if (scored.size === 0) {
    return { value: termGrid, meta: buildMeta("low", "conflicting", ["No regular/extra coupon term rows were captured."]) };
  }

  return {
    value: termGrid,
    meta: buildMeta(conflicts.length > 0 ? "medium" : "high", conflicts.length > 0 ? "conflicting" : "direct", conflicts),
  };
}

function chooseCouponOption(
  options: ParsedCouponOption[],
  checkAmount: number | null,
): { selectedOption: ParsedCouponOption | null; selectedOptionMeta?: ExtractionMeta; paymentAmount: number | null; paymentAmountMeta?: ExtractionMeta } {
  if (options.length === 0) {
    return {
      selectedOption: null,
      selectedOptionMeta: buildMeta("low", "conflicting", ["No coupon option rows were captured."]),
      paymentAmount: null,
      paymentAmountMeta: buildMeta("low", "conflicting", ["No coupon option amount was captured."]),
    };
  }

  const amountMatches =
    checkAmount === null ? [] : options.filter((option) => option.amount !== null && amountsEqual(option.amount, checkAmount));
  const markedOptions = options
    .filter((option) => option.marked && option.amount !== null)
    .sort((left, right) => right.selectionScore - left.selectionScore);

  const bestMarked = markedOptions[0] ?? null;
  const amountMatch = amountMatches[0] ?? null;

  if (bestMarked && amountMatch && bestMarked !== amountMatch) {
    return {
      selectedOption: amountMatch,
      selectedOptionMeta: buildMeta("low", "conflicting", [
        `Marked option amount ${bestMarked.amount?.toFixed(2)} conflicts with check amount ${checkAmount?.toFixed(2)}.`,
      ]),
      paymentAmount: amountMatch.amount,
      paymentAmountMeta: buildMeta("low", "conflicting", ["Selected option by check amount despite a conflicting explicit mark."]),
    };
  }

  if (bestMarked) {
    const damagedMark = bestMarked.selectionScore < 3;
    const supportedByAmount = checkAmount !== null && bestMarked.amount !== null && amountsEqual(bestMarked.amount, checkAmount);
    if (checkAmount !== null && amountMatches.length === 0 && damagedMark) {
      return {
        selectedOption: null,
        selectedOptionMeta: buildMeta("low", "conflicting", [
          `No coupon option price matches check amount ${checkAmount.toFixed(2)} and only weak mark-like rows were found.`,
        ]),
        paymentAmount: null,
        paymentAmountMeta: buildMeta("low", "conflicting", ["Did not force a payment amount from weak mark-only coupon rows."]),
      };
    }

    const confidence: ExtractionConfidence = damagedMark ? "medium" : "high";
    return {
      selectedOption: bestMarked,
      selectedOptionMeta: buildMeta(
        checkAmount !== null && !supportedByAmount ? "low" : confidence,
        checkAmount !== null && !supportedByAmount ? "conflicting" : damagedMark ? "normalized" : "direct",
        checkAmount !== null && !supportedByAmount
          ? [`Marked option amount ${bestMarked.amount?.toFixed(2)} does not match check amount ${checkAmount.toFixed(2)}.`]
          : undefined,
      ),
      paymentAmount: bestMarked.amount,
      paymentAmountMeta: buildMeta(
        checkAmount !== null && !supportedByAmount ? "low" : confidence,
        checkAmount !== null && !supportedByAmount ? "conflicting" : damagedMark ? "normalized" : "direct",
        supportedByAmount
          ? ["Damaged option mark is supported by the check amount."]
          : checkAmount !== null
            ? [`Price came from a marked row even though no option matched check amount ${checkAmount.toFixed(2)}.`]
            : undefined,
      ),
    };
  }

  if (amountMatch) {
    return {
      selectedOption: amountMatch,
      selectedOptionMeta: buildMeta("medium", "inferred", ["Selected coupon option by matching its price to the check amount."]),
      paymentAmount: amountMatch.amount,
      paymentAmountMeta: buildMeta("medium", "inferred", ["Coupon option price matches the check amount."]),
    };
  }

  const strongestMarked = options.filter((option) => option.marked).sort((left, right) => right.selectionScore - left.selectionScore);
  const strongestMark = strongestMarked[0] ?? null;
  const nextStrongestMark = strongestMarked[1] ?? null;
  if (strongestMark && strongestMark.selectionScore >= 3 && (!nextStrongestMark || nextStrongestMark.selectionScore < strongestMark.selectionScore)) {
    return {
      selectedOption: strongestMark,
      selectedOptionMeta: buildMeta("low", "normalized", ["Selected the strongest mark-like coupon option without amount support."]),
      paymentAmount: strongestMark.amount,
      paymentAmountMeta:
        strongestMark.amount === null
          ? buildMeta("low", "conflicting", ["Selected coupon option did not include a readable price."])
          : buildMeta("low", "normalized", ["Price came from a weakly selected coupon option."]),
    };
  }

  return {
    selectedOption: null,
    selectedOptionMeta: buildMeta("low", "conflicting", ["No explicit coupon mark or check-amount match was available."]),
    paymentAmount: null,
    paymentAmountMeta: buildMeta("low", "conflicting", ["No selected coupon option amount was captured."]),
  };
}

function detectProductName(lines: OcrLine[]): string | null {
  for (const line of lines) {
    const normalized = normalizeWhitespace(line.text);
    if (/Pomme d'api/i.test(normalized)) return "Pomme d'api";
    if (/POPI/i.test(normalized)) return "POPI";
    if (/D[ÉE]BROUILLARDS?/i.test(normalized)) return "Debrouillards";
    if (/CURIUM/i.test(normalized)) return "Curium";
    if (/EXPLORATEU/i.test(normalized)) return "Les Explorateurs";
    if (/J['’]?AIME\s+LIRE/i.test(normalized) || /MES PREMIERS/i.test(normalized)) return "J'aime Lire";
  }

  return null;
}

export function extractCoupon(file: string, input: ExtractionInput): CouponExtraction {
  const document = resolveParsedDocument(input);
  const { checkLines, couponLines } = splitIncomeDocumentLines(document);
  const lines = couponLines.length > 0 ? couponLines : document.lines;
  const fullText = document.fullText || joinLineText(document.lines);

  const subscriberClientNumber = extractCouponClientNumber(lines);

  const subscriberAnchorIndex = lines.findIndex((line) => /Pour l'abonnement de/i.test(line.text));
  let subscriberName: string | null = null;
  let subscriberNameMeta: ExtractionMeta | undefined;
  if (subscriberAnchorIndex !== -1) {
    const anchor = lines[subscriberAnchorIndex];
    const inline = anchor.text.match(/Pour l'abonnement de\s*:?\s*(.+?)(?:\s+no\s+de\s+client|\s*$)/i);
    if (inline?.[1]) {
      subscriberName = normalizeWhitespace(inline[1].replace(/^\d{4,}\s+/, "").replace(/\s+\d{6,7}\s*$/, ""));
      subscriberNameMeta = buildMeta("high", "direct");
    } else {
      const sameBand = lines.filter((line) => line.top >= anchor.top - 0.02 && line.top <= anchor.bottom + 0.02);
      const nextName = sameBand.find(
        (line) => line.left > anchor.left && !/no\s+de\s+client/i.test(line.text) && /[A-Z]/i.test(line.text),
      );
      if (nextName) {
        subscriberName = nextName.text;
        subscriberNameMeta = buildMeta("high", "direct");
      }
    }
  }
  const billToNameId =
    lines.map((line) => line.text.match(/\b[A-Z]{3,4}\s*#\s*CLIENT\s*[:#]?\s*(\d{4,})/i)).find((match) => match)?.[1] ??
    lines.map((line) => line.text.match(/No\s+Client\s*#\s*(\d{4,})/i)).find((match) => match)?.[1] ??
    null;

  const promoCode = extractCouponPromoCode(lines);
  const renewalCampaignCode =
    lines
      .map((line) => line.text.toUpperCase().replace(/\s+/g, "").match(/([A-Z]{3,4}LERE\d{2})/))
      .find((match) => match)?.[1] ?? null;
  const renewalDate =
    lines
      .map((line) => line.text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? line.text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1] ?? null)
      .map((value) => (value ? parseLocalDate(value) : null))
      .find((value) => value !== null) ?? null;
  const copies =
    lines.find((line) => /Nombre de copies/i.test(line.text))?.text.match(/Nombre de copies\s*:\s*(\d+)/i)?.[1] ??
    null;
  const productName = detectProductName(lines);
  const optionCandidates = buildCouponOfferCandidates(lines);
  const options = optionCandidates
    .map((candidate) => parseCouponOption(candidate.line.text === candidate.text ? candidate.line : { ...candidate.line, text: candidate.text }))
    .filter((line): line is ParsedCouponOption => line !== null);
  const checkAmountNumeric = extractCheckAmountNumeric(checkLines).value;
  const checkAmountForOptionMatch = checkAmountNumeric ?? extractCheckAmountFromLines(checkLines);
  const optionChoice = chooseCouponOption(options, checkAmountForOptionMatch);
  const termGrid = extractCouponTermGrid(lines);

  const payerAnchorIndex = lines.findIndex(
    (line) => promoCode.value !== null && line.text.toUpperCase().replace(/\s+/g, "").includes(promoCode.value),
  );
  const payerName = (() => {
    if (payerAnchorIndex !== -1) {
      for (let index = payerAnchorIndex + 1; index < Math.min(lines.length, payerAnchorIndex + 7); index += 1) {
        const line = lines[index];
        if (/^\d{4}-\d{2}-\d{2}$/.test(line.text) || /Coordonn/i.test(line.text) || /^#?\d+$/.test(line.text)) {
          continue;
        }
        if (/[A-Z]/i.test(line.text) && !/\d{3,}/.test(line.text)) {
          return line.text;
        }
      }
    }

    const topNameCandidates = lines.slice(0, 8).filter((line) => /[A-Z]/i.test(line.text) && !/\d{2,}/.test(line.text));
    return topNameCandidates.at(1)?.text ?? topNameCandidates.at(0)?.text ?? null;
  })();

  const payerAddress = (() => {
    if (payerAnchorIndex !== -1) {
      const addressLines: string[] = [];
      for (let index = payerAnchorIndex + 1; index < Math.min(lines.length, payerAnchorIndex + 8); index += 1) {
        const line = lines[index];
        if (/Coordonn/i.test(line.text) || /^\d{4}-\d{2}-\d{2}$/.test(line.text)) {
          break;
        }
        if (/\d/.test(line.text)) {
          addressLines.push(line.text);
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
    subscriberClientNumber: subscriberClientNumber.value,
    billToNameId: billToNameId ?? null,
    payerName,
    payerAddress,
    promoCode: promoCode.value,
    renewalCampaignCode: renewalCampaignCode ?? null,
    renewalDate,
    paymentAmount: optionChoice.paymentAmount,
    termGrid: termGrid.value,
    copies: copies ?? null,
    options: options.map(({ marked: _marked, mark: _mark, unselected: _unselected, selectionScore: _selectionScore, ...option }) => option),
    selectedOption: optionChoice.selectedOption
      ? (({ marked: _marked, mark: _mark, unselected: _unselected, selectionScore: _selectionScore, ...option }) => option)(
          optionChoice.selectedOption,
        )
      : null,
    rawTextPreview: previewLines(lines),
    fieldMeta: {
      subscriberClientNumber: subscriberClientNumber.meta,
      subscriberName: subscriberNameMeta,
      billToNameId: billToNameId ? buildMeta("medium", "direct") : undefined,
      promoCode: promoCode.meta,
      renewalCampaignCode: renewalCampaignCode ? buildMeta("medium", "direct") : undefined,
      selectedOption: optionChoice.selectedOptionMeta,
      paymentAmount: optionChoice.paymentAmountMeta,
      termGrid: termGrid.meta,
    },
  };
}

export function extractCheck(file: string, input: ExtractionInput): CheckExtraction {
  const document = resolveParsedDocument(input);
  const { checkLines } = splitIncomeDocumentLines(document);
  const lines = checkLines.length > 0 ? checkLines : document.lines;
  const checkText = joinLineText(lines);
  const memoIndex = lines.findIndex((line) => /^MEMO\b/i.test(line.text));
  const payToIndex = lines.findIndex((line) => PAYEE_ANCHOR_PATTERN.test(line.text));
  const checkNumber = extractCheckNumber(lines, checkText);
  const date = extractCheckDate(lines, checkText);
  const payTo = extractPayTo(lines);
  const amountNumber = extractCheckAmountNumeric(lines);
  const amountWords = extractCheckAmountWords(lines);
  const payerName = extractPayerName(lines);
  const payerAddress = extractPayerAddress(lines, payerName);
  const previewEnd = memoIndex !== -1 ? memoIndex : Math.min(lines.length, payToIndex !== -1 ? payToIndex + 12 : 12);

  return {
    file,
    checkNumber: checkNumber.value,
    date: date.value,
    payTo: payTo.value,
    amountNumber: amountNumber.value,
    amountWords,
    payerName,
    payerAddress,
    rawTextPreview: previewLines(lines.slice(0, previewEnd)),
    fieldMeta: {
      checkNumber: checkNumber.meta,
      date: date.meta,
      payTo: payTo.meta,
      amountNumber: amountNumber.meta,
    },
  };
}

export function extractIncomeDocument(file: string, input: ExtractionInput): IncomeExtraction {
  const document = resolveParsedDocument(input);
  return {
    coupon: extractCoupon(file, document),
    check: extractCheck(file, document),
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
    renewalDate:
      subscription.sections?.termDetails?.["Start Date"] ??
      subscription.sections?.billingInfo?.["Billing Date"] ??
      subscription.sections?.termDetails?.["Entered Date"] ??
      null,
    totalAmount: toAmount(subscription.sections?.pricingDetails?.Total),
    renewalTerm: subscription.sections?.renewal?.["Renewal Term"] ?? null,
    term: subscription.sections?.termDetails?.Term ?? null,
  };
}

function appendTrace(
  trace: VerificationTraceEntry[],
  field: string,
  branch: string,
  rawOcr: unknown,
  rawNaviga: unknown,
  normalizedOcr: unknown,
  normalizedNaviga: unknown,
  issues: FieldIssue[],
): void {
  trace.push({
    field,
    rawOcr,
    rawNaviga,
    normalizedOcr,
    normalizedNaviga,
    branch,
    issueCodes: issues.map((issue) => issue.code),
  });
}

function getSeverityWeight(severity: FieldSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "major":
      return 3;
    case "minor":
      return 2;
    case "info":
      return 1;
  }
}

function toCheckStatus(result: FieldResult): ComparisonCheck["status"] {
  if (result.status === "pass") {
    return "match";
  }

  if (result.status === "warning") {
    return "partial";
  }

  if (result.status === "not_applicable") {
    return "missing";
  }

  if (result.status === "manual_review") {
    return result.issues.some((issue) => issue.code === "missing_ocr" || issue.code === "missing_naviga") ? "missing" : "partial";
  }

  return "mismatch";
}

function buildChecks(subscription: SubscriptionSummary, extraction: CouponExtraction, today = new Date()): {
  checks: ComparisonCheck[];
  trace: VerificationTraceEntry[];
  fieldResults: FieldResult[];
} {
  const trace: VerificationTraceEntry[] = [];
  const context: VerificationContext = {
    today,
    ocr: extraction,
    naviga: subscription,
    trace,
  };

  const fieldResults = fieldVerifiers.map((verifier) => {
    const result = verifier.verify(context);
    appendTrace(
      trace,
      verifier.field,
      result.status,
      extraction[verifier.field as keyof CouponExtraction],
      subscription[verifier.field as keyof SubscriptionSummary],
      result.normalizedOcr,
      result.normalizedNaviga,
      result.issues,
    );
    return result;
  });

  const checks: ComparisonCheck[] = fieldResults.map((result, index) => {
    const verifier = fieldVerifiers[index];
    return {
      field: result.field,
      expected: formatComparableValue(result.normalizedNaviga),
      actual: formatComparableValue(result.normalizedOcr),
      status: toCheckStatus(result),
      weight: getSeverityWeight(verifier.severity),
      notes: result.issues.map((issue) => issue.code).join(", ") || undefined,
      issues: result.issues,
    } satisfies ComparisonCheck;
  });

  checks.push({
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

  const subscriptionTermNumber = Number(subscription.renewalTerm ?? subscription.term ?? "");
  checks.push({
    field: "selectedOptionTerm",
    expected: Number.isFinite(subscriptionTermNumber) ? String(subscriptionTermNumber) : null,
    actual:
      extraction.selectedOption?.issues !== null && extraction.selectedOption?.issues !== undefined
        ? String(extraction.selectedOption.issues)
        : extraction.selectedOption?.years !== null && extraction.selectedOption?.years !== undefined
          ? String(extraction.selectedOption.years * 11)
          : null,
    status:
      Number.isFinite(subscriptionTermNumber) &&
      ((extraction.selectedOption?.issues !== null && extraction.selectedOption?.issues !== undefined) ||
        (extraction.selectedOption?.years !== null && extraction.selectedOption?.years !== undefined))
        ? extraction.selectedOption?.issues === subscriptionTermNumber ||
          (extraction.selectedOption?.years !== null &&
            extraction.selectedOption?.years !== undefined &&
            extraction.selectedOption.years * 11 === subscriptionTermNumber)
          ? "match"
          : "mismatch"
        : "missing",
    weight: 2,
    notes: extraction.selectedOption?.raw ?? undefined,
  });

  checks.push({
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

  return { checks, trace, fieldResults };
}

function scoreFieldResults(fieldResults: FieldResult[]): number {
  return fieldResults.reduce((total, result) => {
    const verifier = fieldVerifiers.find((candidate) => candidate.field === result.field);
    const weight = verifier ? getSeverityWeight(verifier.severity) : 0;

    if (result.status === "pass") {
      return total + weight;
    }

    if (result.status === "warning") {
      return total + Math.max(1, Math.floor(weight / 2));
    }

    if (result.status === "fail") {
      return total - weight;
    }

    return total;
  }, 0);
}

function summarizeRecommendation(bestCandidate: CandidateReport | null): string {
  if (!bestCandidate) {
    return "No OCR candidate was available to verify against the Naviga subscription.";
  }

  const byField = new Map(bestCandidate.checks.map((check) => [check.field, check]));
  const criticalFailure = ["subscriberClientNumber", "billToNameId"].some((field) => byField.get(field)?.status === "mismatch");
  const criticalReview = ["subscriberClientNumber", "billToNameId"].some((field) => byField.get(field)?.status === "missing");
  const majorFailure = ["paymentAmount", "renewalDate", "productName"].some((field) => byField.get(field)?.status === "mismatch");
  const minorIssues = ["subscriberName", "selectedOptionTerm", "payerAddress"].some(
    (field) => byField.get(field)?.status === "mismatch" || byField.get(field)?.status === "partial" || byField.get(field)?.status === "missing",
  );

  if (criticalFailure) {
    return "Reject this candidate. A critical identity field failed verification.";
  }

  if (criticalReview || majorFailure) {
    return "Send this candidate to manual review. Identity or major business fields need explanation before renewal confirmation.";
  }

  if (minorIssues) {
    return "The candidate is acceptable but should be reviewed for minor inconsistencies before final confirmation.";
  }

  return "Accept the best candidate. Critical identity fields and the primary business checks align.";
}

export function verifyRenewalCandidates(
  subscription: SubscriptionSummary,
  extractions: CouponExtraction[],
  options: { today?: Date } = {},
): Pick<VerificationReport, "bestCandidate" | "topCandidates" | "recommendation" | "verificationStrategy"> {
  const today = options.today ?? new Date();

  const candidates = extractions
    .map<CandidateReport>((extraction) => {
      const { checks, trace, fieldResults } = buildChecks(subscription, extraction, today);
      return {
        file: extraction.file,
        score: scoreFieldResults(fieldResults),
        extraction,
        checks,
        trace,
      };
    })
    .sort((left, right) => right.score - left.score);

  const bestCandidate = candidates.at(0) ?? null;

  return {
    bestCandidate,
    topCandidates: candidates.slice(0, 5),
    recommendation: summarizeRecommendation(bestCandidate),
    verificationStrategy: [
      "Verify critical identity fields through dedicated field modules with stable issue codes.",
      "Normalize OCR and Naviga values before comparison so business rules share one parsing layer.",
      "Treat subscriber client number and bill-to name ID as critical identity keys.",
      "Treat payment amount, renewal date, and product alignment as major business checks.",
      "Send missing or structurally invalid field values to manual review instead of treating them as silent mismatches.",
    ],
  };
}
