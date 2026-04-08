# Verification System Plan

## Goal

Build a verification system that compares OCR-derived data against Naviga data in a way that is:

- clean to read
- easy to extend
- safe for business-rule changes
- explicit about exceptions, failures, and manual-review cases

The system should not rely on one large comparison function with ad hoc conditionals. Each business field should be verified through a small, isolated field module with stable result codes.

## Core Design

Split the verification flow into 5 layers:

1. Extraction
2. Normalization
3. Validation
4. Comparison
5. Decision

### 1. Extraction

Extraction is responsible only for pulling raw values from:

- OCR payloads
- Naviga subscription detail

Current functions already fit this pattern:

- `extractCoupon()`
- `summarizeSubscription()`

These should stay thin and should not contain business decisions such as whether a value is acceptable or whether two values are considered equivalent.

### 2. Normalization

Normalization converts raw strings into canonical values that are safe to compare.

Examples:

- names -> uppercase, no diacritics, collapsed spaces
- amount -> decimal number
- date -> parsed local date
- client number -> digits only

Normalization must be centralized and reused. Do not let each rule invent its own parsing logic.

For the initial version, normalization should happen inside each field verifier by calling shared helpers from `normalization.ts`. That keeps orchestration simple while still enforcing one common parsing and canonicalization layer.

### 3. Validation

Validation answers:

- is the OCR value structurally usable?
- is the Naviga value structurally usable?
- does the value fall inside allowed business constraints?

Examples:

- date cannot be parsed
- amount is missing
- client number is malformed
- renewal date is more than 3 months in the future

### 4. Comparison

Comparison answers:

- do the OCR and Naviga values match?
- do they partially match?
- is one side missing?

Comparison should be field-specific. Name matching, date matching, amount matching, and product matching should not share the same comparison logic.

### 5. Decision

Decision combines field results into:

- pass
- fail
- warning
- manual review

This is where severity and recommendation live. It should not be mixed into extraction or parsing.

## Proposed Structure

Recommended folder structure:

```text
src/comparison/
  index.ts
  types.ts
  normalization.ts
  registry.ts
  fields/
    subscriber-client-number.ts
    subscriber-name.ts
    bill-to-name-id.ts
    payment-amount.ts
    product-name.ts
    renewal-date.ts
    selected-option-term.ts
```

### Responsibilities

- `types.ts`
  - shared types for field verification
- `normalization.ts`
  - parsing and canonical conversion helpers
- `fields/*.ts`
  - one verifier per field
- `registry.ts`
  - exported list of field verifiers
- `index.ts`
  - orchestration only

## Field Contract

Each field verifier should expose a single contract.

```ts
type VerificationContext = {
  today: Date;
  ocr: CouponExtraction;
  naviga: SubscriptionSummary;
};

type VerificationIssueCode =
  | "missing_ocr"
  | "missing_naviga"
  | "invalid_format"
  | "mismatch"
  | "out_of_range"
  | "manual_review_required";

type FieldIssue = {
  code: VerificationIssueCode;
  message: string;
  meta?: Record<string, unknown>;
};

type FieldResult = {
  field: string;
  status: "pass" | "fail" | "warning" | "manual_review" | "not_applicable";
  normalizedOcr: unknown;
  normalizedNaviga: unknown;
  issues: FieldIssue[];
};

type FieldVerifier = {
  field: string;
  severity: "critical" | "major" | "minor" | "info";
  verify(ctx: VerificationContext): FieldResult;
};
```

Severity should be defined on the `FieldVerifier`, not returned on each `FieldResult`. Severity is a static property of the field definition. Status is runtime-specific.

`not_applicable` should remain reserved for future usage until there is a concrete business case and explicit semantics for when a field is intentionally skipped instead of passed, failed, or marked for manual review.

## Rule Authoring Standard

When a developer adds or changes a field rule, they must define:

- field name
- OCR source path
- Naviga source path
- canonical type
- required vs optional
- normalization method
- validation rules
- comparison method
- error codes
- severity
- manual-review triggers

This prevents hidden business logic from leaking into arbitrary parts of the codebase.

## Example: Renewal Date

Business rule example:

- valid if date is between today and 3 months from today

This rule should live in a dedicated field verifier, not inline in the main comparison function.

Expected logic:

1. Parse OCR date.
2. Parse Naviga date.
3. If either side is missing or unparseable, return `manual_review`.
4. If OCR date is beyond `today + 3 months`, return `fail` with `future_date_too_far`.
5. If OCR date and Naviga date differ, return `fail` with `mismatch`.
6. Otherwise return `pass`.

Recommended issue codes for this field:

- `missing_ocr`
- `missing_naviga`
- `invalid_format`
- `future_date_too_far`
- `past_date_too_old`
- `mismatch`

## Exceptions and Error Strategy

Do not encode exceptions as free-form note strings only. Every exception should have a stable code.

Examples:

- `missing_ocr`
- `missing_naviga`
- `ocr_low_confidence`
- `invalid_date`
- `invalid_amount`
- `amount_tolerance_exceeded`
- `product_not_allowed`
- `cross_title_renewal_not_permitted`
- `manual_review_required`

Benefits:

- easier UI rendering
- easier filtering and reporting
- easier analytics later
- safer refactors

Human-readable messages can still exist, but the code should be the stable contract.

## Severity Model

Not all fields should carry the same weight.

Suggested levels:

- `critical`
  - client number
  - bill-to name ID
- `major`
  - amount
  - renewal date
  - product
- `minor`
  - name fuzzy match
  - option term
- `info`
  - advisory-only checks

The final recommendation should be derived from severity-aware rules, not just a flat point score.

## Recommendation Model

Move toward rule-based recommendation logic:

- if any critical field fails -> reject
- if no critical field fails but a major field fails -> manual review
- if only minor fields fail -> warning
- if all required fields pass -> accept

Scoring can still exist for ranking candidates, but the final recommendation should not depend on score alone.

## Logging And Tracing

Field-level tracing should be part of the design from the beginning so production mismatches are debuggable.

Recommended additions:

- optional `trace` collector on `VerificationContext`
- each verifier records:
  - raw OCR value used
  - raw Naviga value used
  - normalized OCR value
  - normalized Naviga value
  - branch taken
  - issue codes emitted

Possible shape:

```ts
type VerificationTraceEntry = {
  field: string;
  rawOcr?: unknown;
  rawNaviga?: unknown;
  normalizedOcr?: unknown;
  normalizedNaviga?: unknown;
  branch: string;
  issueCodes: string[];
};

type VerificationContext = {
  today: Date;
  ocr: CouponExtraction;
  naviga: SubscriptionSummary;
  trace?: VerificationTraceEntry[];
};
```

This does not need external logging on day one. Even an in-memory trace attached to the verification report will make debugging significantly easier.

## Implementation Phases

### Phase 1: Extract Shared Types

- create shared verification result types
- move reusable normalization helpers into a dedicated module
- keep existing behavior unchanged

### Phase 2: Introduce Field Verifiers

- extract current checks into separate field modules
- add a registry to run all field verifiers
- introduce stable issue codes at the same time
- keep the existing `VerificationReport` output shape as stable as possible

Do not create a temporary verifier shape that returns only free-form messages. Those placeholders tend to become permanent.

### Phase 3: Add Date Rule Support

- implement `renewalDate` field verifier
- inject `today` through context for deterministic testing
- support rules like "within the next 3 months"

### Phase 4: Move Recommendation to Severity Rules

- reduce dependence on score-only ranking
- base final recommendation on critical and major field outcomes

### Phase 5: Testing

- unit tests for normalization helpers
- unit tests for each field verifier
- fixture-based tests for OCR/Naviga pairs
- edge-case tests for missing fields and malformed values

## Testing Strategy

Each field verifier should have its own test file with:

- happy path
- missing OCR value
- missing Naviga value
- malformed OCR value
- malformed Naviga value
- mismatch case
- exception case

For date fields specifically, tests must freeze the reference date to avoid nondeterministic failures.

## Current Codebase Mapping

Current comparison logic lives mainly in:

- `src/comparison/index.ts`

Current refactor target:

- keep `extractCoupon()` as extraction
- keep `summarizeSubscription()` as mapping
- replace `buildChecks()` with field verifier modules
- keep `verifyRenewalCandidates()` as orchestration and ranking

## Non-Goals

For the first refactor, do not:

- redesign the UI output format
- rebuild OCR extraction from scratch
- add a general-purpose rules engine DSL
- support user-authored runtime rules
- rely on `not_applicable` for normal field flow

The first goal is maintainable code structure, not maximum configurability.

## First Deliverable

The first solid milestone should include:

1. shared verification types
2. field verifier registry
3. 3 to 5 extracted field verifiers from the current checks
4. stable issue codes
5. one date field implemented with a 3-month future window rule
6. unit tests for the new field modules

## Recommended First Fields

Start with these fields because they are high value and already exist conceptually:

- `subscriberClientNumber`
- `billToNameId`
- `subscriberName`
- `paymentAmount`
- `renewalDate`

This gives a strong identity layer, a strong business-value layer, and a clean example for date-policy handling.
