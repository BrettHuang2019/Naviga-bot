# OCR Assessment for `artifacts/ocr`

## Scope

This document assesses the 9 OCR outputs in [artifacts/ocr](C:\Documents\GitHub\Naviga-bot\artifacts\ocr) for a combined image that contains:

- a `check` in the upper portion
- a `coupon` in the lower portion

The goal is to judge whether each OCR result is good enough to confidently separate the two regions and extract the requested fields.

## Confidence scale

- `High`: usable without much manual review
- `Medium`: probably usable, but needs a quick human check
- `Low`: not safe to trust without manual review
- `No`: cannot be determined confidently from OCR text alone

## Overall conclusion

All 9 OCR results can be confidently split into `check` and `coupon` by position. The OCR payloads include line-level bounding boxes, so the upper/lower layout split is defensible.

The dataset is mostly workable for structured extraction, but these fields are weak across the set:

- `signature present / absent` on the check
- `selected option` when no explicit tick is captured and the choice must be inferred from amount
- a few damaged `date`, `amount`, or `address` readings in the weaker samples

Weakest sample:

- `432688`

Other fields that need caution:

- `502157` check date
- `670684` check-side payer address

## Cross-file assessment

### Check section

| Field | Confidence across 9 files | Notes |
| --- | --- | --- |
| Check vs coupon separation | High | Clear by vertical position in all files |
| Check number | High | Present and readable in all 9 |
| Check date | High overall | Weak on `502157` |
| Pay-to business name | High | Sometimes OCR says `Publication BLD` instead of full business name |
| Amount in numbers | High overall | Weak on `432688` due to conflicting OCR |
| Amount in words | Medium | Often readable but damaged; better as secondary confirmation |
| Client / owner name | High | Usually clear, though some are joint or institutional payers |
| Address | Medium to High | Weak on `670684` |
| Signature present / absent | No | OCR text is not reliable for signature detection |

### Coupon section

| Field | Confidence across 9 files | Notes |
| --- | --- | --- |
| Client number | High | Present in all 9 |
| Client name | High | Present in all 9 |
| Promo code above barcode | High for extraction, Medium for exact OCR fidelity | Present in all 9 as a promo-like token in coupon text; one sample likely has OCR digit error |
| Option chosen | Medium | Explicit in some files, inferred in others |
| Price from chosen option | High overall | Weak on `432688` |
| Address | High | Present in all 9 |

## Per-file assessment

| OCR file | Image | Check/Coupon split | Check no. | Check date | Pay to | Amount numeric | Amount words | Owner name | Check address | Signed? | Coupon client no. | Coupon client name | Promo code | Option chosen | Option price | Coupon address | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `585539` | `IMG_5137.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | High | High | High | High | Explicit `X 1 an`; promo code extracted as `CUR2022AV1` |
| `463769` | `IMG_5049.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Option likely `Extra 2 ans`; promo code extracted as `EXP2021AV1` |
| `670684` | `IMG_5111.jpg` | High | High | High | High | High | Medium | High | Low | No | High | High | High | Medium | High | High | Option likely `Regulier 1 an`; promo code extracted from merged line `DEB2021AV1 2022-12-21` |
| `149774` | `IMG_5016.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | High | High | High | High | Coupon clearly points to `6 mois`; joint payer names on check; promo code `AST2022AV1` |
| `377408` | `IMG_5065.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Chosen option not explicitly ticked in OCR; inferable from `86.18`; promo code `EXP2021AV1` |
| `693314` | `IMG_5135.jpg` | High | High | High | High | High | Low | High | High | No | High | High | High | Medium | High | High | Institutional payer; option looks like `1 an` by amount; promo code `CUR2022AV1` |
| `764622` | `IMG_5141.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | Medium | High | High | High | Explicit 1-year option; promo code extracted as `PJQ2200AV1`, likely OCR-damaged |
| `432688` | `IMG_5133.jpg` | High | High | High | High | Low | Medium | High | High | No | High | High | High | Medium | Low | High | Weakest file for amount OCR; promo code still extracts cleanly as `CUR2023AV1` |
| `502157` | `IMG_5139.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Check date is badly OCR'd; coupon option likely `1 an` by amount; promo code `JAL2022AV1` |

## Field-by-field notes

### 1. Can the OCR confidently tell apart check and coupon?

Yes, for all 9 files.

Reason:

- the check text is consistently in the upper region
- the coupon text is consistently in the lower region
- the OCR payload includes bounding boxes, so a vertical split can be enforced programmatically

### 2. Checks: can the OCR confidently find the check number?

Yes, for all 9 files.

### 3. Checks: can the OCR confidently find the date of the check?

Mostly yes.

Exceptions:

- `502157` is weak because the OCR renders the date as spaced digits

### 4. Checks: can the OCR confidently find the pay-to business name?

Yes, mostly.

Notes:

- some checks say `Bayard Presse Canada Inc.`
- some say `Publication BLD`
- both are still strong enough to identify the payee field

### 5. Checks: can the OCR confidently find the price in number and in words?

Numeric amount:

- strong in 8 of 9
- weak in `432688`

Amount in words:

- usable as a supporting signal
- not strong enough to be the sole source in every file

### 6. Checks: can the OCR confidently find the name of the client / owner?

Yes, generally.

Caveats:

- some are joint names
- `693314` is an institution rather than a person

### 7. Checks: can the OCR confidently find the address?

Usually yes.

Weak case:

- `670684`, where the payer address is not cleanly exposed in the check region

### 8. Checks: can the OCR confidently know whether the check is signed?

No.

Reason:

- OCR text does not reliably tell whether a signature exists
- detecting a handwritten signature requires image analysis, not just text OCR

### 9. Coupon: can the OCR confidently get the client number?

Yes, for all 9 files.

### 10. Coupon: can the OCR confidently get the client name?

Yes, for all 9 files.

### 11. Coupon: can the OCR confidently get the promo code above the barcode?

Yes, for this set, with a rule-based extraction.

Working rule:

- search coupon OCR `lines` for a token matching `[A-Z]{3}[0-9]{4}[A-Z0-9]{2,}`
- if the OCR line contains extra text, extract the matching substring rather than using the whole line
- prefer matches in the coupon region, typically around `top ~= 0.61-0.70`

Observed results across all 9 files:

- `CUR2022AV1`
- `EXP2021AV1`
- `DEB2021AV1` from `DEB2021AV1 2022-12-21`
- `AST2022AV1`
- `EXP2021AV1`
- `CUR2022AV1`
- `PJQ2200AV1`
- `CUR2023AV1`
- `JAL2022AV1`

Caveat:

- extraction is strong across all 9 files
- exact OCR fidelity is not perfect in every case; `764622` likely contains a digit error in `PJQ2200AV1`
- the code is not reliably the line immediately above the barcode in OCR order; it is more reliable to search the coupon text region for the promo pattern

### 12. Coupon: can the OCR confidently get which option is ticked / chosen?

Partially.

Strong when:

- the OCR captures an explicit `X`, `1`, or similar mark next to the chosen row

Only medium when:

- the choice must be inferred from the amount on the check or the only coupon amount that matches

### 13. Coupon: can the OCR confidently get the price from the chosen option?

Mostly yes.

Weak case:

- `432688`

### 14. Coupon: can the OCR confidently get the address?

Yes, for all 9 files.

## Practical recommendation

This OCR set is good enough for a first-pass extraction pipeline if:

- `signature detection` is excluded or handled by image analysis
- `promo code` is extracted by regex from coupon OCR lines, with a review flag for suspicious values
- `selected option` is allowed to be `inferred` rather than always directly detected
- weak files such as `432688` are routed to manual review

Recommended manual-review triggers:

- conflicting numeric amounts
- unreadable or malformed dates
- missing explicit option mark
- promo code contains likely OCR damage, especially year digits
- any signature requirement

## Promo code rule

Use this rule for coupon promo extraction:

1. Restrict to coupon OCR lines, not check lines.
2. Search each line for a substring matching `[A-Z]{3}[0-9]{4}[A-Z0-9]{2,}`.
3. If multiple matches exist, prefer the one in the lower coupon region, typically `top >= 0.60`.
4. Return the substring match, not the full line.
5. Flag for review if:
   - no match is found
   - multiple different promo-like matches are found
   - the extracted token looks OCR-damaged, especially around the year digits
