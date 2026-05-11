function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeForCompare(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return stripDiacritics(value)
    .toUpperCase()
    .replace(/['’`]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function tokenize(value: string | null | undefined): string[] {
  return normalizeForCompare(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function toDigits(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
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

export function amountsEqual(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return false;
  }

  return Math.abs(left - right) < 0.02;
}

export function fuzzyNameMatch(left: string | null, right: string | null): boolean {
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

export function fuzzyAddressMatch(left: string | null, right: string | null): boolean {
  const leftTokens = tokenize(left);
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.length === 0 || rightTokens.size === 0) {
    return false;
  }

  const shared = leftTokens.filter((token) => rightTokens.has(token));
  return shared.length >= 3;
}

export function productMatch(left: string | null, right: string | null): boolean {
  const leftValue = normalizeForCompare(left);
  const rightValue = normalizeForCompare(right);

  if (!leftValue || !rightValue) {
    return false;
  }

  return leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

export function parseLocalDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return toCanonicalDate(Number(year), Number(month), Number(day));
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return toCanonicalDate(Number(year), Number(month), Number(day));
  }

  return null;
}

function toCanonicalDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addMonthsToDateString(value: string, months: number): string {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const candidate = new Date(Date.UTC(year, month - 1 + months, day));
  return `${candidate.getUTCFullYear()}-${String(candidate.getUTCMonth() + 1).padStart(2, "0")}-${String(candidate.getUTCDate()).padStart(2, "0")}`;
}

export function compareDateStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function formatComparableValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }

  return JSON.stringify(value);
}
