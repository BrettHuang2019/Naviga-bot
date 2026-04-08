# OCR Extraction Implementation Plan

## Goal

Refactor OCR extraction so we can extract the required check and coupon fields with higher confidence from the OCR JSON artifacts in `artifacts/ocr`.

The main change is:

- stop relying mostly on `fullText` regexes
- start using OCR `lines` plus bounding boxes
- keep `fullText` only as a fallback

This plan is written for a junior engineer. Follow the phases in order. Do not try to redesign the whole verification system while doing this work.

## Background

The OCR artifacts have this structure:

- outer JSON file
- `ocrText` field contains another JSON string
- inside that inner JSON, `responsev2.predictionOutput.results[0].lines` contains the useful OCR lines with bounding boxes

The current extractor mostly works on plain text:

- `src/comparison/index.ts`
- `src/worker/index.ts`
- `src/comparison/report.ts`

This is a problem because the dataset has strong layout signals:

- the check is in the upper part of the image
- the coupon is in the lower part
- promo codes appear in a narrow band in the coupon area

The existing docs already confirm this:

- `docs/ocr-assessment.md`
- `docs/field-rules.md`

## Business Rules To Support

### Check

We need to extract:

- check number
- date
- pay to
- amount in number
- amount in words
- payer name
- payer address

We also need to validate:

- date must be within 3 months from today
- payee must be one of the accepted business names
- numeric amount must agree with words amount when possible

Accepted payees:

- Bayard Presse Canada Inc.
- Bayard Presse Canada
- Bayard Jeunesse
- Novalis
- Living with christ

### Coupon

We need to extract:

- client id / client number
- client name
- promo code above barcode
- option chosen
- price from chosen option

### Naviga comparison

We need the OCR output to support these comparisons:

- name
- address
- client number
- promo code
- duration
- price

## Current Problems

### 1. The extractor throws away useful layout data

Current extraction logic in `src/comparison/index.ts` works mostly from `fullText`.

This causes weak behavior for:

- check versus coupon splitting
- promo extraction
- option selection
- damaged dates
- merged OCR lines

### 2. One report path reads OCR incorrectly

`src/comparison/report.ts` reads `payload.responsev2?.predictionOutput?.fullText`.

That does not match the actual artifact structure in `artifacts/ocr`, where the OCR content is inside `payload.ocrText`.

Fix this as part of the task.

### 3. The code does not track extraction confidence

Right now extraction returns values, but not whether they were:

- direct
- inferred
- weak
- conflicting

We need at least lightweight confidence metadata so later workflow decisions are safer.

## High-Level Design

Build a small OCR parsing layer before field extraction.

### New flow

1. Parse outer payload.
2. Parse inner `ocrText` JSON.
3. Convert OCR `lines` into normalized line objects.
4. Split line objects into `checkRegion` and `couponRegion`.
5. Run field-specific extraction functions against each region.
6. Return extracted values plus confidence metadata.
7. Keep `fullText` extraction only as fallback.

### Important principle

Do not build one giant function with many `if` statements.

Instead:

- one parser for OCR payload shape
- one splitter for regions
- one extractor per field group

## Proposed File Changes

### Update

- `src/comparison/index.ts`
- `src/comparison/types.ts`
- `src/comparison/income-extraction.test.ts`
- `src/comparison/report.ts`
- `src/worker/index.ts`

### Likely new files

- `src/comparison/ocr-parser.ts`
- `src/comparison/ocr-parser.test.ts`

You may add one more helper file if needed, but avoid scattering logic into too many files.

## Phase 1: Parse OCR Payload Properly

### Task

Create a parser that converts the artifact into a typed structure.

### Expected input

The parser should accept the outer payload object.

### Expected output

A normalized object containing:

- `fullText`
- `lines`
- maybe `imageLink`

Each normalized line should include:

- `text`
- `top`
- `left`
- `width`
- `height`
- `bottom`
- `right`

### Rules

- trim and normalize whitespace
- discard empty lines
- preserve original line order if possible
- sort by `top`, then `left`, when region logic needs stable ordering

### Deliverable

A helper function similar to:

```ts
type OcrLine = {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};
```

### Acceptance criteria

- parser works on all files in `artifacts/ocr`
- parser throws a clear error if `ocrText` is not valid JSON
- parser throws a clear error if `results[0].lines` is missing

## Phase 2: Split Check And Coupon By Position

### Task

Replace the text-only split with a line-based split.

### Primary approach

Use coupon anchor lines such as:

- `Retournez ce coupon`
- `Je profite de cette offre`
- `Je souhaite prolonger`
- `Nombre de copies`
- `Pour l'abonnement de`

If any of these are found, use the first matching line as the start of the coupon region.

### Fallback approach

If anchors are missing:

- find a reasonable vertical threshold from line positions
- use a simple fallback threshold around `top >= 0.55`

### Output

Return:

- `checkLines`
- `couponLines`

### Acceptance criteria

- all current OCR samples split into upper check and lower coupon correctly
- no coupon line is included in the extracted check preview for the known test cases

## Phase 3: Extract Check Fields From Check Region

### Task

Move check extraction to work on `checkLines`, not global `fullText`.

### Fields

#### Check number

Use nearby placement rules:

- short digit line near the top of the check
- before the payee area
- avoid MICR line at the bottom

#### Date

Look for:

- `DATE 2023-01-23`
- `DATE` followed by a spaced-digit line like `1 1 2 2 2 0 2 2`

Normalize to `YYYY-MM-DD`.

#### Pay to

Use the area after `PAY TO THE` or `PAYEZ`.

Normalize output to one of the accepted payee names when OCR is close enough.

Example:

- `Bayard Presse Canada inc.` -> `Bayard Presse Canada Inc.`

#### Amount in number

Prefer the amount nearest the payee/order block.

Do not accidentally use coupon amounts.

#### Amount in words

Look after `ORDER OF` or `L'ORDRE DE`.

#### Payer name and address

Use the top-left block before the payee section.

Keep it simple:

- top text lines without many digits are likely names
- lines with street number or postal code are likely address lines

### Acceptance criteria

- current tests still pass
- known weak files do not produce obviously wrong coupon-derived check values

## Phase 4: Extract Coupon Fields From Coupon Region

### Task

Move coupon extraction to work on `couponLines`.

### Fields

#### Client number

Anchor to:

- `Pour l'abonnement de`
- `no de client`
- `#CLIENT`

Prefer explicit client labels over loose digit matches.

#### Client name

Prefer the name attached to `Pour l'abonnement de`.

If OCR merges the client number and name into one line, strip the number carefully.

#### Promo code

Use coupon lines only.

Search each line for a substring matching a promo pattern like:

```txt
[A-Z]{3}[0-9]{4}AV[0-9A-Z]+
```

Return the substring, not the whole line.

If multiple different promo-like values are found, mark the field for review.

#### Option rows

Parse option lines into structured rows with:

- raw text
- years
- issues count
- amount

#### Option chosen

Use this order:

1. explicit mark if captured
2. exact amount match to check amount
3. otherwise leave unselected and mark low confidence

Do not pretend an inferred option is explicit.

#### Price from chosen option

If selected option is known, use that amount.

Otherwise:

- try to match one option amount to the check amount
- if still unclear, return null and mark for review

### Acceptance criteria

- promo extraction works across all current OCR samples
- chosen option is marked as inferred when not directly visible
- weak files remain weak instead of producing fake confidence

## Phase 5: Add Confidence Metadata

### Task

Extend extraction results with confidence and notes.

Do not over-engineer this. A small structure is enough.

Example:

```ts
type ExtractionConfidence = "high" | "medium" | "low";
```

Possible fields:

- `offerCodeConfidence`
- `selectedOptionConfidence`
- `paymentAmountConfidence`
- `checkDateConfidence`

Or add a generic metadata object if that is cleaner.

### Guidance

Use:

- `high` for direct anchored extraction with one clear candidate
- `medium` for normalized or inferred values with one reasonable candidate
- `low` for ambiguous or conflicting values

### Acceptance criteria

- at least the fragile fields report confidence
- confidence is used in previews or later decisions only if easy to wire in

## Phase 6: Fix The Report Loader

### Task

Fix `src/comparison/report.ts` so it parses the artifact shape correctly.

### Required change

Instead of expecting:

- `payload.responsev2.predictionOutput.fullText`

it should:

1. parse `payload.ocrText`
2. read `responsev2.predictionOutput`
3. call the new OCR-based extraction entry point

### Acceptance criteria

- report generation works with files from `artifacts/ocr`

## Phase 7: Tests

### Minimum tests to add

#### Unit tests for parser

- parses a valid artifact
- rejects missing `ocrText`
- rejects invalid inner JSON
- returns normalized lines

#### Extraction tests

Use real examples from `artifacts/ocr` or small fixture strings modeled on them.

Cover:

- check/coupon split by line position
- promo code extraction from merged line like `DEB2021AV1 2022-12-21`
- spaced date parsing
- option selected by amount inference
- check extraction does not leak coupon values

#### Regression tests

At minimum add cases representing:

- `502157` for damaged date OCR
- `670684` for merged promo line
- `432688` for weak amount OCR
- `764622` for suspicious promo OCR

### Test command

Run:

```bash
npm test
```

Also run:

```bash
npm run typecheck
```

## Implementation Notes

### Keep the first version simple

Do not add:

- image analysis
- signature detection
- fuzzy ML logic
- large scoring systems

This task is still rule-based OCR extraction.

### Use fallback carefully

The order should be:

1. region-aware line extraction
2. local fallback within the same region
3. whole-text fallback only if needed

If whole-text fallback is used, do not label the result high confidence automatically.

### Normalize business names

Create a small helper for accepted payee names so extraction and validation do not each invent their own list.

### Do not silently invent values

If the field is weak, return:

- `null`
- low confidence
- a review note

That is better than returning a wrong value confidently.

## Suggested Task Breakdown

### PR 1

- add OCR parser
- add line normalization
- add region split
- add parser tests

### PR 2

- move check extraction to parsed lines
- move coupon extraction to parsed lines
- keep old regex fallback only where needed

### PR 3

- add confidence metadata
- fix report loader
- add regression tests from artifact files

If the work is small enough, PR 2 and PR 3 can be combined.

## Definition Of Done

This task is done when:

- OCR artifacts are parsed from `ocrText`
- extraction uses line bounding boxes as the primary signal
- check and coupon are split by position or stable anchors
- required fields are extracted from the correct region
- weak values are surfaced as weak, not hidden
- report generation reads the actual artifact format
- tests cover the known weak samples

## Nice-To-Have After This Task

Do not include this in the first implementation unless everything else is already done.

- richer confidence notes in UI
- payee-name fuzzy normalization helper shared with validation
- artifact-based snapshot tests
- field-level extraction debug output for manual review
