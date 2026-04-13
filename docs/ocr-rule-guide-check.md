# OCR Rule Guide

This guide defines simple extraction rules for junior developers to implement.

## 1. Check Number

### Goal

Extract the `check_number` from the check portion of the OCR result.

### Main rule

- Only look in the `check` region, not the coupon region.
- Find a standalone numeric token in the upper-right area of the check.
- In this dataset, the check number is usually `3 digits`.

### Candidate rule

Accept a line as a `check_number` candidate when:

- `top <= 0.24`
- `left >= 0.60`
- text matches `^\d{3,6}$`

Allow a slightly looser left cutoff, around `left >= 0.58`, when the token is isolated, numeric-only, and still in the upper-right check-number position. This captures scans where the check number lands just left of the nominal cutoff, such as `087`.

### Best choice

- If there is exactly one candidate, return it.
- If there are multiple candidates, choose the one farthest to the right.
- If no candidate exists, return `null` and flag for review.

### Confidence rule

Mark as `high confidence` when:

- there is exactly one candidate in the upper-right area

Mark as `medium confidence` when:

- there are multiple candidates but one is clearly the best by position

Mark as `low confidence` when:

- no candidate is found
- the candidate is mixed with other text
- the candidate looks like part of a date, phone number, or address

### Optional cross-check

If a MICR line is available near the bottom of the check:

- extract the first `3 to 6 digit` token from that line
- if it matches the upper-right candidate, keep `high confidence`
- if it does not match, flag for review

### Example

- Good candidate: `002`
- Good candidate: `221`
- Reject: `DATE 2023-01-15`
- Reject: `(418) 276-5124`

### Output

```json
{
  "check_number": "002",
  "confidence": "high"
}
```

## 2. Check Date

### Goal

Extract the `check_date` from the check portion of the OCR result.

### Main rule

- Only look in the `check` region, not the coupon region.
- Search near the top-right area of the check.
- Prefer the `DATE` anchor and the text immediately to its right or on the next line.
- Do not use dates from the coupon region, even if they are cleaner.

### Candidate rule

Accept a line as a `check_date` candidate when:

- `top <= 0.28`
- `left >= 0.45`
- text contains `DATE` or looks like a date by itself

Treat these as one logical candidate:

- a single line like `DATE 2023-01-23`
- a `DATE` line plus the nearest overlapping or next lower line that contains digits, such as:
  - `DATE`
  - `1 1 2 2 0 2 2`

### Accepted date formats

Accept these common OCR formats:

- `2023-01-19`
- `2023 - 01 - 15`
- `2023-01 -19`
- `2023-01- 20`
- `20 23-01-20`
- `2 02 3 - 0 1 -2 7`

Normalize them to:

- `YYYY-MM-DD`

### Extraction rule

1. Find lines in the top-right check area.
2. Find the best `DATE` anchor.
3. Build the candidate text from:
   - the `DATE` line itself
   - plus the closest line on the same row or the next lower row if that nearby line contains mostly digits, spaces, or hyphens
4. Extract the date part using a flexible pattern that allows spaces inside the year, month, and day groups.
5. Remove extra spaces inside each numeric group, then rebuild as `YYYY-MM-DD`.
6. Validate the normalized result:
   - year must be 4 digits
   - month must be `01-12`
   - day must be `01-31`
7. Reject any candidate from below the check region cutoff, even if it looks cleaner.

Suggested normalization approach:

- match a date-like pattern such as `(\d[\d ]{3,})\s*-\s*(\d[\d ]{1,2})\s*-\s*(\d[\d ]{1,2})`
- strip spaces inside each captured group
- require group lengths `4-2-2` after cleanup

### Best choice

- If one `DATE` anchor produces one valid normalized date, return it.
- If multiple candidates exist, prefer the one:
  - nearest to the `DATE` anchor
  - highest on the page within the check region
  - farthest from coupon-region text
- If no valid date is found, return `null` and flag for review.

### Confidence rule

Mark as `high confidence` when:

- the candidate is anchored by `DATE`
- the extracted value converts cleanly to `YYYY-MM-DD`
- only one valid date exists in the top-right check area

Mark as `medium confidence` when:

- the date is readable but spacing is messy, such as `20 23-01-09`
- the value is recovered by merging `DATE` with the next line
- the line does not contain `DATE`, but the date pattern is still clear and still in the top-right check area

Mark as `low confidence` when:

- the digits are split too heavily
- the year, month, or day is unclear
- multiple different dates appear in the check region
- the extracted value only works after aggressive guessing

### Review trigger

Flag for review when:

- the result cannot be normalized to `YYYY-MM-DD`
- month is not `01-12`
- day is not `01-31`
- the OCR looks heavily broken, such as `1 1 2 2 0 2 2`
- the only strong date candidate is outside the check region
- the check-region date conflicts with another nearby date-like string

### Example

- Good: `DATE 2023-01-19` -> `2023-01-19`
- Good: `DATE 2023 - 01 - 15` -> `2023-01-15`
- Good: `DATE 2023-01- 20` -> `2023-01-20`
- Good: `DATE 20 23-01-09` -> `2023-01-09`
- Medium: `DATE 2 02 3 - 0 1 -2 7` -> `2023-01-27`
- Review: `1 1 2 2 0 2 2`

### Output

```json
{
  "check_date": "2023-01-19",
  "confidence": "high"
}
```

## 3. Check Pay To

### Goal

Extract the `check_pay_to` value from the check portion of the OCR result.

### Main rule

- Only look in the `check` region, not the coupon region.
- Find the `PAYEZ À`, `PAY TO`, or similar anchor on the left side of the check.
- Use the text immediately to the right of that anchor, or the nearest overlapping next line, as the payee candidate.
- Do not use coupon brand names or product names from the lower half of the page.

### Why this works in this dataset

In these files, the payee is consistently placed on the check line anchored by:

- `PAYEZ À`
- `PAYEZ`
- sometimes followed by `À`
- or English-style `PAY TO`

The payee text is usually one of:

- `Bayard Presse Canada Inc.`
- `Bayard Press Canada inc.`
- `Publications BLD`
- OCR may emit `Publication BLD`; normalize this to `Publications BLD`.

Sometimes OCR merges the payee with the numeric amount on the same line, for example:

- `Bayard Press Canada inc. 71. 23 $`
- `Bayard Presse Canada Inc. $83.62 $`
- `Bayard Presse Canada Inc $4515`

So the extraction rule should anchor on `PAYEZ À` first, then clean trailing amount text.

### Candidate rule

Accept a line as a `check_pay_to` candidate when:

- `top >= 0.24`
- `top <= 0.33`
- `left >= 0.15`
- the line is horizontally aligned with, or immediately below, a `PAYEZ À` / `PAY TO` anchor

Accept these anchor variants:

- `PAYEZ À`
- `PAYEZ`
- `PAY TO`
- `PAY TO THE`
- `PAY TO THE ORDER OF`

Also accept French continuation patterns when OCR splits the anchor:

- `PAYEZ`
- `À`
- `à l'ordre de`
- `L'ORDRE DE`

### Extraction rule

1. Restrict to lines in the upper check region.
2. Find the best payee anchor:
   - prefer text containing `PAYEZ`
   - otherwise prefer text containing `PAY TO`
3. From that anchor, collect candidate text from:
   - the nearest line to the right on the same row, or
   - the nearest overlapping line slightly above or below the anchor row
4. If no right-side line exists, allow the next line directly below the anchor if it sits in the payee band.
5. Clean the candidate text:
   - trim leading punctuation
   - remove trailing currency or amount fragments such as:
     - `71.23 $`
     - `$83.62 $`
     - `$4515` when it clearly means `$45.15`
     - `45.04`
   - collapse repeated spaces
6. Reject the candidate if, after cleanup, it is mostly numeric or looks like only an amount.
7. Return the cleaned organization name.

### Suggested cleanup pattern

Use the anchor-based line, then remove trailing amount text with a pattern like:

- `\s+\$?\s*\d{1,3}(?:[.,]\s*\d{2})\s*\$?\s*$`

This is meant to remove amount text only at the end of the line.

Also remove an implicit-cents suffix such as `\s+\$\s*\d{3,5}\s*$` from payee text after separately extracting it as the numeric amount.

### Best choice

- If one anchor produces one clean organization-name candidate, return it.
- If multiple candidates exist, prefer the one:
  - closest to the `PAYEZ À` / `PAY TO` anchor
  - in the check band around `top ~= 0.25-0.31`
  - containing more letters than digits
- If no anchored candidate exists, return `null` and flag for review.

### Confidence rule

Mark as `high confidence` when:

- a `PAYEZ À` or `PAY TO` anchor exists in the check region
- exactly one nearby payee candidate exists
- the cleaned result contains mostly letters
- the cleaned result does not depend on guessing across distant lines

Mark as `medium confidence` when:

- the anchor exists but the payee is split across two nearby lines
- the line contains both payee text and amount text, but cleanup is straightforward
- the spelling is slightly damaged but the organization is still obvious, such as `Bayard Press Canada inc.`

Mark as `low confidence` when:

- no strong anchor exists
- multiple nearby text lines could be the payee
- the candidate is heavily OCR-damaged
- the extracted result is only recoverable by weak heuristics

### Review trigger

Flag for review when:

- no `PAYEZ` or `PAY TO` anchor is found in the check region
- the anchor is found but no adjacent text candidate exists
- multiple different organization names appear near the anchor
- the extracted value ends up too short, such as a single token with no letters
- the cleaned result still contains amount text or check memo text

### Example

- Good: `PAYEZ À` + `Bayard Press Canada inc. 71. 23 $` -> `Bayard Press Canada inc.`
- Good: `PAYEZ` + `Bayard Presse Canada inc.` -> `Bayard Presse Canada inc.`
- Good: `PAYEZ À` + `Publications BLD` -> `Publications BLD`
- Reject: `45.04`
- Reject: `POUR Renouvellement Curium`

### Output

```json
{
  "check_pay_to": "Bayard Presse Canada inc.",
  "confidence": "high"
}
```

## 4. Check Amount

### Goal

Extract both:

- `check_amount_numeric`
- `check_amount_words`

from the `check` portion of the OCR result.

### Main rule

- Only look in the `check` region, not the coupon region.
- Treat the numeric amount as the primary amount field.
- Treat the amount in words as a supporting confirmation field.
- Only mark the result `high confidence` when the numeric amount and the words agree after normalization.

### Why this works in this dataset

These checks usually contain:

- a numeric amount near the right side of the payee / amount band
- an amount-in-words line in the middle-left band, often ending with a hand-written or printed fraction such as `23/100`

Typical numeric examples:

- `71.23`
- `$83.62`
- `45.04 $`

Typical words examples:

- `soixante et onze et 23/100`
- `quatre-vingt-trois et 62/100`
- `quarante-cinq et 04/100`

The numeric amount is usually cleaner than the words. The words are still useful as a cross-check, especially when the OCR around the decimal point is noisy.

### A. Numeric amount

#### Candidate rule

Accept a line as a `check_amount_numeric` candidate when:

- `top >= 0.22`
- `top <= 0.34`
- `left >= 0.55`
- text contains a money-like value

Accept these OCR shapes:

- `71.23`
- `$71.23`
- `71.23 $`
- `$ 71.23 $`
- `71. 23`
- `71 , 23`
- `$4515`, when it appears on the payee/amount line and should normalize to `45.15`

Reject likely non-amount lines such as:

- dates like `2023-01-19`
- check numbers like `221`
- phone numbers
- address fragments

#### Extraction rule

1. Restrict to lines in the check amount band.
2. Search for a money-like pattern with:
   - `1 to 3` digits before the separator
   - optional spaces around the separator
   - exactly `2` digits after the separator
3. Also search the anchored payee line when it contains the payee text plus a trailing amount, even if the line starts left of the normal amount band.
4. For implicit-cents currency strings such as `$4515`, split the last two digits as cents only when the string is anchored to the payee/amount row.
5. Normalize:
   - convert `,` to `.`
   - remove spaces around the decimal separator
   - remove surrounding currency symbols
6. Return the normalized value as `NN.NN`.
7. If multiple candidates exist, prefer the one:
   - farthest right
   - closest to the payee / amount row
   - with the cleanest `2-digit` decimal part

Suggested pattern:

- `\$?\s*(\d{1,3})\s*[.,]\s*(\d{2})\s*\$?`

#### Confidence rule

Mark numeric amount as `high confidence` when:

- exactly one strong money candidate exists in the right-side amount band
- it normalizes cleanly to `NN.NN`

Mark numeric amount as `medium confidence` when:

- multiple money-like candidates exist but one is clearly best by position
- the decimal separator is damaged but still recoverable, such as `71. 23`

Mark numeric amount as `low confidence` when:

- the best candidate conflicts with another nearby amount
- the decimal part is unclear
- the only candidate is mixed with heavy OCR damage

### B. Amount in words

#### Candidate rule

Accept a line as a `check_amount_words` candidate when:

- `top >= 0.30`
- `top <= 0.43`
- `left >= 0.08`
- `left <= 0.72`
- text contains mostly letters and spaces
- text also contains a cents fraction like `\d{2}/100`, or looks like a spelled-out amount line

When the line is anchored immediately after `L'ORDRE DE` / `ORDER OF`, allow it to start as high as `top ~= 0.24`, because several scans place the amount words higher than the nominal words band.

Accept French and English-style amount wording such as:

- `soixante et onze et 23/100`
- `quatre-vingt-six et 18/100`
- `forty five and 04/100`

Also allow OCR-damaged variants with extra spaces or punctuation.

Reject lines that are clearly:

- payee names
- addresses
- memo text
- coupon option lines

#### Extraction rule

1. Restrict to lines in the words band of the check.
2. Prefer lines containing a cents suffix like `23/100`.
3. If the amount words are split across two adjacent lines, merge only the nearest overlapping pair.
4. If cents are split into separate OCR tokens, such as `Quarante cinq` + `15` + `100 DOLLARS`, merge them into `Quarante cinq 15/100 DOLLARS`.
5. Clean the result:
   - trim punctuation
   - collapse repeated spaces
   - normalize spaces around `/`
6. Return the cleaned text as `check_amount_words`.

#### Suggested parsing for confirmation

For confidence scoring, convert the amount words to a comparable numeric value when possible:

1. Extract the cents from `(\d{2})\s*/\s*100`.
2. Parse the spelled-out integer portion using a small controlled vocabulary for this dataset.
3. Rebuild a comparable numeric string as `integer.cents`.

For this dataset, support at least common French number words used on the checks:

- `un`, `deux`, `trois`, `quatre`, `cinq`, `six`, `sept`, `huit`, `neuf`
- `dix`, `onze`, `douze`, `treize`, `quatorze`, `quinze`, `seize`
- `vingt`, `trente`, `quarante`, `cinquante`, `soixante`
- `soixante-dix`, `quatre-vingt`, `quatre-vingt-dix`
- conjunctions such as `et`

If the word parser cannot confidently convert the integer portion, keep the cleaned text but lower confidence.

#### Confidence rule

Mark amount words as `high confidence` when:

- one strong words-line candidate exists
- the cents suffix is clear
- the spelled amount converts cleanly to the same numeric value as the numeric amount

Mark amount words as `medium confidence` when:

- the line is readable but lightly OCR-damaged
- the cents suffix is clear but the integer words require minor cleanup
- the words are usable as text, but full numeric conversion is uncertain

Mark amount words as `low confidence` when:

- no cents suffix exists
- the words are split or damaged enough that multiple readings are plausible
- the spelled integer portion cannot be parsed reliably

### Best choice

1. Extract the best numeric amount candidate.
2. Extract the best amount-in-words candidate.
3. Normalize both into comparable numeric form when possible.
4. If both agree, return both with stronger confidence.
5. If numeric exists but words are weak, still return the numeric amount and lower the overall confidence.
6. If words exist but numeric is weak or conflicting, flag for review.

### Overall confidence rule

Mark overall amount extraction as `high confidence` when:

- one numeric candidate exists in the right-side amount band
- one words candidate exists in the words band
- both normalize to the same value

Mark overall amount extraction as `medium confidence` when:

- the numeric amount is strong
- the words are present but only partially reliable
- there is no direct conflict between the two

Mark overall amount extraction as `low confidence` when:

- numeric and words disagree
- multiple numeric candidates compete
- the numeric amount only works after aggressive guessing
- the words line is too damaged to confirm the amount

### Review trigger

Flag for review when:

- no numeric amount is found in the check amount band
- multiple different numeric amounts appear in the check region
- the words imply a different amount than the numeric candidate
- the cents suffix is missing or malformed
- the extracted amount also appears to match a coupon option line better than a check-line candidate
- the file is one of the weak OCR cases like the sample assessed as `432688`

### Example

- Good: `$71.23` + `soixante et onze et 23/100` -> numeric `71.23`, words confirm `71.23`
- Good: `45. 04 $` + `quarante-cinq et 04/100` -> numeric `45.04`, words confirm `45.04`
- Medium: `86 , 18` + readable words line with `18/100` but damaged integer words -> return `86.18`, lower confidence
- Review: `83.62` on the check but amount words parse closer to `63/100`
- Review: two different right-side amounts appear in the check band

### Output

```json
{
  "check_amount_numeric": "71.23",
  "check_amount_words": "soixante et onze et 23/100",
  "confidence": "high"
}
```

## 5. Check Name

### Goal

Extract the payer or owner name from the `check` portion of the OCR result.

This is the person or organization issuing the check, not the payee.

### Main rule

- Only look in the `check` region, not the coupon region.
- Search the upper-left sender block of the check.
- Prefer the top-most left-side name lines that appear before the street address, date, and `PAYEZ` area.
- Allow one or two consecutive name lines, because some checks have joint owners.
- Do not confuse the payer name with:
  - the payee such as `Bayard Presse Canada inc.`
  - the bank name and branch
  - the coupon subscriber name in the lower half

### Why this works in this dataset

In these files, the payer name is consistently in the upper-left block.

Typical examples:

- `MR RAYMOND FORTIN`
- `MME DENISE FORTIN`
- `M GERARD DAIGLE`
- `MME LUCILE MARSOLAIS DAIGLE`
- `POLYVALENTE SAINTE-THÉRÈSE`

That name block usually sits:

- above the payer street address
- left of the `DATE` field
- well above the bank block and MICR line

### Candidate rule

Accept a line as a `check_name` candidate when:

- `top >= 0.17`
- `top <= 0.24`
- `left <= 0.40`
- text contains mostly letters, spaces, apostrophes, periods, or `&`

Allow these name shapes:

- person name with title:
  - `MR RAYMOND FORTIN`
  - `MME DENISE FORTIN`
  - `M GERARD DAIGLE`
- organization name:
  - `POLYVALENTE SAINTE-THÉRÈSE`

Reject likely non-name lines such as:

- lines containing digits that look like an address
- `DATE ...`
- `PAYEZ`, `PAY TO`, `L'ORDRE DE`
- bank names such as `BANQUE`, `BMO`, `DESJARDINS`, `RBC`
- coupon lines such as `Pour l'abonnement de`

### Extraction rule

1. Restrict to the upper-left check band.
2. Find the top-most candidate line in that band.
3. Starting from that line, merge the next nearby line when all are true:
   - it is also a name-like line
   - it is directly below the first line
   - the vertical gap is small, typically `<= 0.02`
   - it still appears before the first address-like line
4. Stop merging when the next line:
   - contains digits like a street address
   - contains a phone number
   - contains `DATE`, `PAYEZ`, `PAY TO`, or bank text
5. Return the merged name block in reading order.

### Suggested normalization

- trim punctuation at the edges
- collapse repeated spaces
- preserve internal capitalization as OCR gives it
- if two owner lines are merged, join them with ` ; `

### Best choice

- If exactly one top-left name block exists, return it.
- If two separate name lines belong to the same owner block, merge them.
- If multiple name-like blocks exist, prefer the one:
  - highest on the page
  - farthest left
  - clearly above the address block
- If no strong name block exists, return `null` and flag for review.

### Confidence rule

Mark as `high confidence` when:

- the candidate is in the upper-left block
- it appears before any address-like line
- there is only one plausible owner-name block

Mark as `medium confidence` when:

- two owner lines must be merged
- one line contains light OCR noise but is still clearly a name
- the payer is an institution rather than a person

Mark as `low confidence` when:

- multiple name-like blocks compete
- the text is mixed with address digits
- the only candidate is close to bank or coupon content

### Review trigger

Flag for review when:

- no name-like line is found in the upper-left check band
- the best candidate contains too many digits
- the extracted value overlaps the payee or bank block
- a coupon-side person name is cleaner than the check-side name

### Example

- Good: `MR RAYMOND FORTIN` + `MME DENISE FORTIN` -> `MR RAYMOND FORTIN ; MME DENISE FORTIN`
- Good: `POLYVALENTE SAINTE-THÉRÈSE` -> `POLYVALENTE SAINTE-THÉRÈSE`
- Reject: `Bayard Presse Canada inc.`
- Reject: `BANQUE ROYALE DU CANADA`

### Output

```json
{
  "check_name": "MR RAYMOND FORTIN ; MME DENISE FORTIN",
  "confidence": "high"
}
```

## 6. Check Address

### Goal

Extract the payer or owner mailing address from the `check` portion of the OCR result.

This is the address associated with the check issuer, not the bank address and not the coupon address.

### Main rule

- Only look in the `check` region, not the coupon region.
- Anchor on the owner-name block in the upper-left.
- Use the address lines immediately below that owner-name block.
- Stop before the `DATE`, `PAYEZ`, payee, bank block, or phone lines.
- Do not use the lower coupon mailing address even if it is cleaner.

### Why this works in this dataset

In these files, the payer address usually appears directly under the payer name block and before the check body.

Typical examples:

- `PO BOX 502 119 RUE CENTENAIRE`
- `EMBRUN ON K0A 1W0`
- `72 RUE FOREST`
- `L'ASSOMPTION QC J5W 3J3`
- `401, BOULEVARD DU DOMAINE`
- `SAINTE-THÉRÈSE (QUÉBEC) J7E 4S4`

The bank address appears lower on the page around the signature and MICR area, so it can be rejected by vertical position and bank keywords.

### Candidate rule

Accept a line as a `check_address` candidate when:

- `top >= 0.20`
- `top <= 0.26`
- `left <= 0.42`
- the line is below the chosen `check_name` block
- text looks like an address line

Address-like signals include:

- street numbers
- `PO BOX` or `P.O. BOX`
- street words such as `RUE`, `ST`, `STREET`, `BOULEVARD`, `BLVD`, `CHEMIN`, `CROIS`, `CRES`, `AV`, `AVE`
- city, province, or postal code patterns

Reject lines that contain:

- `TÉL`, `TEL`, `TÉLÉCOPIEUR`, `FAX`
- `DATE`
- `PAYEZ`, `PAY TO`, `L'ORDRE DE`
- bank names such as `BANQUE`, `DESJARDINS`, `BMO`, `RBC`, `CAISSE`
- coupon anchors such as `Pour l'abonnement de`, `no de client`

### Extraction rule

1. Extract the `check_name` block first.
2. Starting from the first line below that block, collect up to `3` consecutive address-like lines in the upper-left band.
3. Keep lines in reading order while all are true:
   - they stay left of the date and amount area
   - they stay in the same horizontal owner block; ignore right-side `FOLIO` or check metadata that appears on the same row
   - they are close vertically to the previous address line
   - they are not phone, bank, or coupon lines
4. Stop when the next line is:
   - a phone line
   - `DATE`
   - `PAYEZ` / `PAY TO`
   - the bank block
   - clearly from the coupon region
5. Return the merged address block.

### Suggested normalization

- trim punctuation at the edges
- collapse repeated spaces
- normalize `P.O. BOX` spacing when obvious
- join multiple address lines with `, `

### Best choice

- If one contiguous address block appears directly below the owner name, return it.
- If multiple blocks exist, prefer the one:
  - nearest below the owner name
  - highest on the page
  - farthest from bank keywords
- If no valid upper-left address block exists, return `null` and flag for review.

### Confidence rule

Mark as `high confidence` when:

- the address block is directly below the chosen owner name
- it contains at least one street-like line and one city or postal-like line
- it is clearly above the payee and bank blocks

Mark as `medium confidence` when:

- only one address line is readable
- the city or postal line is lightly OCR-damaged
- the block is short but still clearly attached to the owner name

Mark as `low confidence` when:

- bank and payer address blocks compete
- the address is incomplete
- the OCR does not clearly expose the payer-side address, as in weaker files like `670684`

### Review trigger

Flag for review when:

- no address-like line appears directly below the owner name
- only bank-address lines are readable
- the extracted block contains phone text
- the best address candidate is in the coupon region
- multiple different address blocks appear in the upper-left check area

### Example

- Good: `PO BOX 502 119 RUE CENTENAIRE` + `EMBRUN ON K0A 1W0` -> `PO BOX 502 119 RUE CENTENAIRE, EMBRUN ON K0A 1W0`
- Good: `401, BOULEVARD DU DOMAINE` + `SAINTE-THÉRÈSE (QUÉBEC) J7E 4S4` -> `401, BOULEVARD DU DOMAINE, SAINTE-THÉRÈSE (QUÉBEC) J7E 4S4`
- Reject: `936 NOTRE DAME ST., P.O. BOX 10`
- Reject: `1520 RUE DE LA MONTAGNE`

### Output

```json
{
  "check_address": "PO BOX 502 119 RUE CENTENAIRE, EMBRUN ON K0A 1W0",
  "confidence": "high"
}
```
