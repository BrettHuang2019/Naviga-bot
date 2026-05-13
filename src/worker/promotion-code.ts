export function toNavigaPromotionLookupCode(promoCode: string): string {
  const trimmed = promoCode.trim();
  const match = trimmed.match(/^([A-Za-z]+)(\d.*)$/);

  if (!match) {
    return trimmed;
  }

  const [, prefix, suffix] = match;
  if (prefix.length === 3) {
    return `${prefix}R${suffix}`;
  }

  if (prefix.length === 4) {
    return `${prefix.slice(0, 3)}R${suffix}`;
  }

  return trimmed;
}

export function toPromotionLookupCandidates(promoCode: string): string[] {
  const rawCode = promoCode.trim().toUpperCase();
  const candidates = [rawCode, toNavigaPromotionLookupCode(rawCode).toUpperCase()];
  for (const code of [...candidates]) {
    if (code.endsWith("AVI")) {
      candidates.push(`${code.slice(0, -1)}1`);
    }
  }

  return [...new Set(candidates)];
}
