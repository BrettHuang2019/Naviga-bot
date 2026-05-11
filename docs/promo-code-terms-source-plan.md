# Promo Code Terms Source Plan

## Goal

Use `workflow/business-rules/excel-promo-code-terms.json` as the source of truth for subscription issues and price.

The system compares four sources for price:

- Check extract
- Coupon extract
- Naviga info
- Excel info from `excel-promo-code-terms.json`

For prototyping, no backward compatibility with old cases or old term/time settings is required.

## Current State

The batch workflow currently derives `NAVIGA_TERM_TIME` from `workflow/business-rules/subscription-term-time.yml`.

That value is then typed into Naviga batch field `#InputData_BatchTerm`.

The frontend currently validates price across three sources:

- Check
- Coupon
- Naviga

The old frontend term/time settings page has been replaced by the issues detail frontend.

## New Source Of Truth

`workflow/business-rules/excel-promo-code-terms.json` is generated from Excel promo code data and contains the required truth data.

Only these fields are needed from the Excel source:

- `issues`
- `price`

Example resolved shape:

```ts
type ResolvedPromoTerm = {
  issues: number | null;
  price: number | null;
};
```

## Backend Plan

### 1. Add Promo Terms Resolver

Create a resolver module, likely:

```text
src/worker/promo-code-terms.ts
```

Responsibilities:

- Load `workflow/business-rules/excel-promo-code-terms.json`
- Look up coupon promo code in `promoCodes`
- Select the matching term from `terms[]`
- Return only `issues` and `price`

### 2. Promo Code Lookup

Lookup should first try the raw coupon promo code.

If raw lookup misses, try the existing Naviga lookup conversion:

```ts
toNavigaPromotionLookupCode(promoCode)
```

Examples:

- `DEB2600AV3` -> `DEBR2600AV3`
- `PASP2600AV1` -> `PASR2600AV1`

### 3. Term Selection

Select the term from the promo entry using this order:

1. Match coupon selected price to Excel term price.
2. If price is unavailable, match coupon selected duration to Excel term label.
3. If coupon selected issues exist, use them as an additional consistency check.

Failure behavior:

- No promo code match: error
- No term match: error
- Multiple possible terms: error

This is acceptable for the prototype because bad or ambiguous data should surface immediately.

### 4. Batch Workflow

Replace current `resolveSubscriptionTermTime(...)` usage.

New behavior:

```ts
const excelTerm = await resolvePromoTerm(rootDir, couponExtraction);
env.NAVIGA_TERM_TIME = String(excelTerm.issues);
```

The workflow file can keep using the same env var and same Naviga selector:

```yaml
target: termTimeInput
value: env:NAVIGA_TERM_TIME
```

The source of `NAVIGA_TERM_TIME` changes from manual YAML mapping to Excel promo terms.

### 5. Use Issues Detail Frontend

Use the issues detail frontend that replaced the old term/time settings page.

The issues detail frontend should read from `workflow/business-rules/excel-promo-code-terms.json` and expose the Excel-derived issues/price details used by the workflow and validation.

No need to preserve `workflow/business-rules/subscription-term-time.yml` for this prototype.

## Frontend Plan

### Case Detail Layout

Keep three main columns:

- Check extract
- Coupon extract
- Naviga subscription summary

Do not add a fourth column.

Add a small Excel section inside the Naviga column:

```text
Excel promo terms
Issues: 12
Price: $56.45
```

This keeps the UI compact while still showing the source-of-truth values beside Naviga.

### Validation Values

Extend validation rows to support:

```ts
excel?: string | number | null;
```

Render validation values in this order:

```text
Check | Coupon | Naviga | Excel
```

## Validation Rules

### Price

Rule:

```text
Naviga price = Coupon price = Check price = Excel price
```

Status:

- `ok` only when all four values are present and equal.
- `error` if any value is missing or different.

Message when failing:

```text
Price differs across Naviga, coupon, check, or Excel.
```

### Issues

Rule:

```text
Naviga issues = Excel issues
```

Coupon issues may be shown if extracted, but Excel remains the source of truth.

Status:

- `ok` when Naviga issues and Excel issues match.
- `error` when missing or different.

## Suggested Tests

Add tests for:

- Promo code lookup exact match.
- Promo code lookup with `toNavigaPromotionLookupCode(...)` fallback.
- Term selection by selected coupon price.
- Term selection by selected coupon duration fallback.
- Ambiguous or missing term throws a clear error.
- Batch workflow env sets `NAVIGA_TERM_TIME` from Excel `issues`.
- Price validation is `ok` only when Naviga, coupon, check, and Excel prices all match.
- Frontend case detail renders Excel `issues` and `price` inside the Naviga column.

## Files Likely To Change

- `src/worker/promo-code-terms.ts`
- `src/worker/index.ts`
- `src/worker/promo-code-terms.test.ts`
- `apps/web/index.ts`
- Possibly remove or hide `/settings/subscription-term-time`

## Open Decisions

- Whether resolved Excel info should be stored in case artifacts or computed live in the frontend for each case.

For prototype speed, compute live first. Persist later only if case reproducibility becomes important.
