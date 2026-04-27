# OCR Assessment for `artifacts/ocr` on `2026-04-21`

## Scope

This document assesses the 27 OCR outputs added to [artifacts/ocr](/C:/Documents/GitHub/Naviga-bot/artifacts/ocr) on `2026-04-21`.

Like [ocr-assessment.md](/C:/Documents/GitHub/Naviga-bot/docs/ocr-assessment.md), the goal is to judge whether each OCR result is good enough to confidently separate the `check` and `coupon` regions and extract the same requested fields.

Today’s folder contains OCR JSON artifacts, not local JPGs. This assessment therefore measures image clarity by OCR readability and extraction quality from those new artifacts.

## Confidence scale

- `High`: usable without much manual review
- `Medium`: probably usable, but needs a quick human check
- `Low`: not safe to trust without manual review
- `No`: cannot be determined confidently from OCR text alone

## Overall conclusion

All 27 OCR results can still be confidently split into `check` and `coupon` by position. Coupon-side extraction is generally stronger than in the earlier 9-file set because the new batch is much more standardized:

- the coupon product block is usually very consistent
- client number and mailing block are almost always clean
- promo code extraction is stronger and more uniform

The main regression versus the earlier assessment is the check side:

- `check date` is weaker in this batch because many scans split the date across lines or collapse it into `DDMMYYYY`
- `pay-to` is sometimes damaged by English-bank layouts and OCR noise
- `signature present / absent` is still not reliable from OCR text alone

This batch is workable for first-pass structured extraction, but it needs more manual-review triggers on the check side than the 9-file set in [ocr-assessment.md](/C:/Documents/GitHub/Naviga-bot/docs/ocr-assessment.md).

Strongest samples:

- `348892`
- `1008257`
- `386109`
- `632675`

Weakest samples:

- `965983`
- `319651`
- `428031`
- `573157`

## Cross-file assessment

### Check section

| Field | Confidence across 27 files | Notes |
| --- | --- | --- |
| Check vs coupon separation | High | Clear by vertical position in all 27 files |
| Check number | High overall | Usually isolated as a 3-digit token; weak on `965983` and `319651` because OCR damages the token |
| Check date | Medium overall | Worse than the earlier 9-file set; many dates are split or compressed, especially `886306`, `781766`, `428031`, `965983`, `319651` |
| Pay-to business name | Medium to High | Usually `Bayard Press Canada`; weak on `428031`, `632675`, `965983`, `319651` |
| Amount in numbers | High overall | Present in most files; weak on `573157` because `56.400` and `56,45` conflict |
| Amount in words | Medium | Often readable enough as support, but frequently damaged |
| Client / owner name | High | Usually clear on both check and coupon sides |
| Address | High overall | Mostly clear, but `428031` shows a check/coupon address mismatch that should be reviewed |
| Signature present / absent | No | OCR text still does not reliably prove whether the check is signed |

### Coupon section

| Field | Confidence across 27 files | Notes |
| --- | --- | --- |
| Client number | High | Present in all 27 files |
| Client name | High | Present in all 27 files |
| Promo code above barcode | High | More uniform than the earlier batch; mostly `LCL2600AV*` plus `PGC2600AV1` and `CUR2600AV1` |
| Option chosen | Medium to High | Often inferable from check amount; explicit marks are captured in some files but not all |
| Price from chosen option | High overall | Usually clear in the option rows |
| Address | High | Coupon mailing block is strong across the set |

## Per-file assessment

| OCR file | Image | Check/Coupon split | Check no. | Check date | Pay to | Amount numeric | Amount words | Owner name | Check address | Signed? | Coupon client no. | Coupon client name | Promo code | Option chosen | Option price | Coupon address | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `348892` | `20260415130944664.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | High | High | High | High | Strongest French sample; explicit `1 2 ans`; promo `PGC2600AV1` |
| `1008257` | `20260415131001499.jpg` | High | High | Medium | High | High | Medium | High | High | No | High | High | High | High | High | High | Strong two-option French coupon; date missing final digit in OCR but still near-recoverable; promo `CUR2600AV1` |
| `886306` | `20260421105607141.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Date heavily split across lines; option likely `1 Year` by amount `47.20`; promo `LCL2600AV1` |
| `781766` | `20260421105831040.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Date fragmented across many lines; option likely `1 Year` by amount `50.80`; promo `LCL2600AV1` |
| `421859` | `20260421105524001.jpg` | High | High | Medium | High | High | Low | High | High | No | High | High | High | High | High | High | Explicit `Z 47,20$` row; amount words damaged by `-29`; promo `LCL2600AV1` |
| `937551` | `20260421105730311.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Coupon side looks standard and strong; check date weak; promo `LCL2600AV4` |
| `428031` | `20260421105651540.jpg` | High | High | Low | Medium | High | Medium | High | High | No | High | High | High | Medium | High | High | Check payee line badly damaged (`BALIO THE`); date appears as compact `20260311`; check and coupon addresses differ and should be reviewed; promo `LCL2600AV2` |
| `386109` | `20260421105507579.jpg` | High | High | High | High | High | Medium | High | High | No | High | High | High | High | High | High | Cleanest English sample in the batch; promo `LCL2600AV3` |
| `214663` | `20260421105636234.jpg` | High | High | Medium | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Date readable but spaced as `2 026-03 - 04`; promo `LCL2600AV3` |
| `167725` | `20260421105710914.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Standard coupon side; check date weak or fragmented; promo `LCL2600AV2` |
| `265989` | `20260421105748959.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Date only partially OCR'd; coupon rows still usable; promo `LCL2600AV2` |
| `426004` | `20260421105817036.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Coupon side strong; check date weak; promo `LCL2600AV4` |
| `160860` | `20260421105803992.jpg` | High | High | Medium | High | High | High | High | High | No | High | High | High | Medium | High | High | Date captured as `06032026` and should normalize by rule; promo `LCL2600AV2` |
| `854849` | `20260421105901896.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Coupon side clean; check date weak; promo `LCL2600AV1` |
| `103913` | `20260421105847691.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Strong coupon layout; weak date OCR on check; promo `LCL2600AV1` |
| `965983` | `20260421105931111.jpg` | High | Medium | Low | Medium | High | Low | High | High | No | High | High | High | Low | High | High | One of the weakest files: date collapses to `2025`, payee reads as `novale`, check amount `80.00` does not align cleanly to coupon options; promo `LCL2600AV1` |
| `762579` | `20260421105946540.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Coupon side strong; check date weak; promo `LCL2600AV4` |
| `517872` | `20260421105914368.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Standard LCL coupon; check-side date weak; promo `LCL2600AV4` |
| `621058` | `20260421110011919.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Coupon extraction strong; date remains weak; promo `LCL2600AV3` |
| `753494` | `20260421105958920.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Date only partially readable as `2026-03 -0`; promo `LCL2600AV2` |
| `905100` | `20260421110036563.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Coupon side clean; check date weak; promo `LCL2600AV1` |
| `561188` | `20260421110108600.jpg` | High | High | Low | High | High | Medium | High | High | No | High | High | High | Medium | High | High | Good coupon readability; weak check date; promo `LCL2600AV3` |
| `319651` | `20260421110050021.jpg` | High | Medium | Low | Medium | High | Low | High | High | No | High | High | High | Medium | High | High | Another weak file: check number loses leading zero, date OCRs as `15032036`, payee reads `Bay and Press Canada`; coupon side still workable; promo `LCL2600AV1` |
| `573157` | `20260421110121604.jpg` | High | High | Medium | High | Medium | Medium | High | High | No | High | High | High | Medium | High | High | Numeric amount conflicts between `56,400` and coupon row `56,45`; chosen option still likely `1 Year with PLUS`; promo `LCL2600AV1` |
| `632675` | `20260421105425916.jpg` | High | High | High | Medium | High | Medium | High | High | No | High | High | High | High | High | High | Check payee is misread as `Living with Christ`, but date and selected `47,20$` row are clear; promo `LCL2600AV2` |
| `244583` | `20260421110136700.jpg` | High | High | Medium | High | High | Medium | High | High | No | High | High | High | High | High | High | Date captured as `03042026` and normalizable; explicit amount match to `56,45$`; promo `LCL2600AV3` |
| `1003239` | `20260421105445442.jpg` | High | High | Medium | High | High | Low | High | High | No | High | High | High | High | High | High | Date split across lines but recoverable; amount words damaged (`25/100` vs `47.20`); promo `LCL2600AV2` |

## Field-by-field notes

### 1. Can the OCR confidently tell apart check and coupon?

Yes, for all 27 files.

Reason:

- the check text is consistently in the upper region
- the coupon text is consistently in the lower region
- the OCR payload includes line-level bounding boxes, so a vertical split remains defensible

### 2. Checks: can the OCR confidently find the check number?

Yes, in most files.

Weak cases:

- `965983`
- `319651`

In those two, the token is damaged enough that a MICR cross-check is advisable.

### 3. Checks: can the OCR confidently find the date of the check?

Only at `medium` overall for this batch.

This is the biggest downgrade from the earlier 9-file set.

Common problems:

- date split across multiple lines, such as `886306` and `781766`
- compact numeric dates, such as `160860` and `244583`
- missing or partly broken day digits, such as `1008257`, `753494`, and `965983`

Compact numeric dates in this batch are not one universal format. The OCR shows
mixed layouts:

- explicit year-first values such as `20260311`
- fragmented year-first values around a `DATE` anchor
- month-first compact values such as `06032026` when the check prints
  `MMDDYYYY`
- other layouts that must be inferred from the printed date guide on the check

The extractor should therefore treat compact `8-digit` dates as layout-driven,
not as a single global fallback rule.

### 4. Checks: can the OCR confidently find the pay-to business name?

Usually yes, but not as cleanly as in the earlier set.

Weak cases:

- `428031`
- `632675`
- `965983`
- `319651`

### 5. Checks: can the OCR confidently find the price in number and in words?

Numeric amount:

- strong in most files
- weak on `573157` due to conflicting numeric OCR

Amount in words:

- still best used as secondary confirmation
- weaker than the numeric field in this batch

### 6. Checks: can the OCR confidently find the name of the client / owner?

Yes, generally.

This remains one of the strongest fields in the batch.

### 7. Checks: can the OCR confidently find the address?

Usually yes.

Main caution:

- `428031` has a clear check address and a clear coupon address, but they are not the same, so any downstream reconciliation should flag that mismatch

### 8. Checks: can the OCR confidently know whether the check is signed?

No.

Reason:

- OCR text does not reliably prove presence or absence of a handwritten signature
- some scans contain the printed word `SIGNATURE`, which is not the same as signature detection

### 9. Coupon: can the OCR confidently get the client number?

Yes, for all 27 files.

### 10. Coupon: can the OCR confidently get the client name?

Yes, for all 27 files.

### 11. Coupon: can the OCR confidently get the promo code above the barcode?

Yes, for this set.

Observed promo family patterns:

- `PGC2600AV1`
- `CUR2600AV1`
- `LCL2600AV1`
- `LCL2600AV2`
- `LCL2600AV3`
- `LCL2600AV4`

Compared with the earlier 9-file set, the new batch is cleaner here because promo tokens are more standardized and less obviously OCR-damaged.

### 12. Coupon: can the OCR confidently get which option is ticked / chosen?

Partially.

High confidence when:

- an explicit mark survives OCR, such as `348892`, `421859`, or `632675`
- the check amount matches only one coupon row, such as `1008257` or `244583`

Only medium or low when:

- the check amount is damaged or conflicts with the coupon row, such as `573157`
- the check amount does not align cleanly to the available coupon rows, such as `965983`

### 13. Coupon: can the OCR confidently get the price from the chosen option?

Mostly yes.

Weakest case:

- `573157`

### 14. Coupon: can the OCR confidently get the address?

Yes, for all 27 files.

## Practical recommendation

This 27-file set is good enough for a first-pass extraction pipeline if:

- `signature detection` is excluded or handled by image analysis
- `check date` is normalized with the flexible rules in [ocr-rule-guide-check.md](/C:/Documents/GitHub/Naviga-bot/docs/ocr-rule-guide-check.md)
- compact `8-digit` check dates are parsed from each check's printed layout hint
  instead of one global month-first or day-first fallback
- `selected option` is allowed to be inferred from amount when checkbox marks are weak
- weak files are routed to manual review

Recommended manual-review triggers for this batch:

- check date cannot normalize cleanly to `YYYY-MM-DD`
- payee OCR is not clearly `Bayard Press Canada`, `Bayard Presse Canada`, `Publication BLD`, or another expected variant
- numeric amount conflicts with coupon option price
- coupon and check addresses differ materially
- option choice cannot be tied to either an explicit mark or an amount match
- any signature requirement

Priority review list:

- `965983`
- `319651`
- `428031`
- `573157`
- `886306`
- `781766`

## Promo code rule

The promo extraction rule from [ocr-assessment.md](/C:/Documents/GitHub/Naviga-bot/docs/ocr-assessment.md) still works for this batch:

1. Restrict to coupon OCR lines, not check lines.
2. Search each line for a substring matching `[A-Z]{3}[0-9]{4}[A-Z0-9]{2,}`.
3. If multiple matches exist, prefer the one in the lower coupon region, typically `top >= 0.60`.
4. Return the substring match, not the full line.
5. Flag for review if:
   - no match is found
   - multiple different promo-like matches are found
   - the extracted token looks OCR-damaged
