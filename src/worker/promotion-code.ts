type PromotionLookupOptions = {
  selectedOptionText?: string | null;
};

export function isExtraSubscriptionOption(optionText?: string | null): boolean {
  return /\b(?:EXTRA|PLUS)\b/i.test(optionText ?? "");
}

export function toNavigaPromotionLookupCode(promoCode: string, options: PromotionLookupOptions = {}): string {
  const trimmed = promoCode.trim();
  const match = trimmed.match(/^([A-Za-z]+)(\d.*)$/);

  if (!match) {
    return trimmed;
  }

  const [, prefix, suffix] = match;
  const lookupType = isExtraSubscriptionOption(options.selectedOptionText) ? "X" : "R";
  if (prefix.length === 3) {
    return `${prefix}${lookupType}${suffix}`;
  }

  if (prefix.length === 4) {
    return `${prefix.slice(0, 3)}${lookupType}${suffix}`;
  }

  return trimmed;
}

export function toPromotionLookupCandidates(promoCode: string, options: PromotionLookupOptions = {}): string[] {
  const rawCode = promoCode.trim().toUpperCase();
  const candidates = [rawCode, toNavigaPromotionLookupCode(rawCode, options).toUpperCase()];
  for (const code of [...candidates]) {
    if (code.endsWith("AVI")) {
      candidates.push(`${code.slice(0, -1)}1`);
    }
  }

  return [...new Set(candidates)];
}
