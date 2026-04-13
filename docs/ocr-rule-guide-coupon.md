# OCR Coupon Rule Guide

This guide defines simple extraction rules for the coupon portion of the OCR
result.

## 1. Coupon Client ID

### Goal

Extract `coupon_client_id`, the subscriber client number printed on the coupon.
Return `null` when it cannot be determined confidently.

### Main rule

- Only look in the coupon region, usually `top >= 0.58`.
- Extract a standalone `6 digit` number.
- Prefer the number attached to the subscriber block near
  `Pour l'abonnement de`.
- Do not blindly trust every `#CLIENT` or `No Client#` line, because some files
  contain a second client-like number.

### Accepted anchors

Accept these OCR label variants:

- `no de client`
- `no, de client`
- `no client`
- `No Client#`
- `#CLIENT`
- `# CLIENT`

Also accept:

- `Pour l'abonnement de: 463769 RAYNALD CARON`
- fallback product/date line, such as `CUR 693314 12/01/2022`, only when no
  stronger client anchor exists

### Best choice

Use this priority order:

1. `Pour l'abonnement de` line that also contains `no de client`.
2. Nearby line in the subscriber block with `no de client`, `no client`,
   `No Client#`, or `#CLIENT`.
3. `Pour l'abonnement de:` line with a `6 digit` number before the name.
4. Product/date fallback like `CUR 693314 12/01/2022`.
5. Otherwise return `null`.

If two different client IDs are found, prefer the stronger subscriber-block
candidate and flag the conflict. If only weak candidates conflict, return
`null`.

### Confidence

- `high`: one clear subscriber-block candidate exists.
- `medium`: value comes from `#CLIENT`, `No Client#`, or product/date fallback
  with no conflict.
- `low`: digits are split, unlabeled, or multiple weak candidates compete.

### Examples

- `no de client: 585539` -> `585539`
- `Pour l'abonnement de: Heidi Soules no de client: 502157` -> `502157`
- `DEB #CLIENT: 670684 04/01/2023` -> `670684`
- `CUR 693314 12/01/2022` -> `693314`, medium confidence
- `Pour l'abonnement de: Hubert Daigle no de client: 149774` plus
  `AST #CLIENT:541285 12/15/2022` -> `149774`, flag conflict
- no usable anchor or fallback -> `null`

### Output

```json
{
  "coupon_client_id": "585539",
  "confidence": "high"
}
```

## 2. Coupon Option Chosen and Option Price

### Goal

Extract the chosen coupon offer option and the price attached to that option.
Return `null` for the chosen option or price when it cannot be determined
confidently.

Options are not fixed. A coupon can have `1` option or many options. Treat the
offer area as a variable-length list of option rows.

### Main rule

- Only look in the coupon offer region, usually above the subscriber block and
  below the check.
- Extract every option row before choosing one.
- An option row usually contains a duration or product choice and a price in the
  same row.
- The price is included in the option row; do not expect a separate price field
  elsewhere on the coupon.
- Prefer an explicit mark beside an option row.
- If no reliable mark is captured, infer the chosen option by matching the
  option price against the check amount.

### Option row patterns

Accept rows that contain a duration or option label plus a currency amount, such
as:

- `6 mois`
- `1 an`
- `1an`
- `2 ans`
- `Extra 1 an`
- `Extra 2 ans`
- `Regulier 1 an`
- `Régulier 1 an`

Common row details may include:

- issue counts, such as `(11 numeros)`, `(11 numéros)`, `(22 nos)`, or
  `(22 numéros)`
- bonus text, such as `HS`, `prime BD`, or a gift/book description
- wording such as `seulement`, `pour`, `taxes incluses`, or `+ taxes`

### Selection marks

Treat these leading marks as possible selected-option signals:

- `X`
- `L`
- `M`
- `1`
- damaged checkbox-like OCR marks, such as `₡`

Treat leading `0` as an unselected-option signal when another option has a
stronger selected mark.

Because OCR can damage checkbox marks, do not use the mark alone if it conflicts
with a better amount match.

### Best choice

Use this priority order:

1. Option row with an explicit selected mark and a usable price.
2. Option row whose price matches the check amount.
3. Option row with the strongest selected-looking mark when no amount match is
   available.
4. Otherwise return `null` for the chosen option and price.

If an explicit selected mark points to one row but the check amount matches a
different row, flag the conflict and use `medium` or `low` confidence depending
on OCR quality.

### Price extraction

Extract the price from the chosen option row.

- Accept both period and comma decimals, such as `45.94$` and `86,18$`.
- Normalize comma decimals to period decimals.
- If the row has one currency amount, use that amount.
- If the row has base price plus taxes, use the final payable amount, usually
  the rightmost currency amount or the amount after the final `=`.
- If the row has discount math, use the final payable amount after the final
  `=`.

### Confidence

- `high`: one clear selected row exists and the row has a readable price.
- `medium`: the selected row is inferred from the check amount, or the mark is
  OCR-damaged but still supported by the amount.
- `low`: multiple option rows compete, price OCR is damaged, or the selected
  mark conflicts with the amount.

### Examples

- `X 1an (11 numéros) seulement 45.94$ taxes incluses` ->
  `coupon_option_chosen: "1 an"`, `coupon_option_price: "45.94"`, high
  confidence
- `L Extra 2 ans (22 nos + 4 HS + le livre les carottes sont cuites) = 86,18$`
  -> `coupon_option_chosen: "Extra 2 ans"`,
  `coupon_option_price: "86.18"`, high confidence
- `0 Extra 1 an (11 nos + 2 HS) = 51,68$` -> option candidate only; do not
  choose it when another row has a selected mark or matching amount
- `M6 mois (12 numéros) seulement 71.23$` ->
  `coupon_option_chosen: "6 mois"`, `coupon_option_price: "71.23"`
- `1 1 an (11 nos) à Mes premiers J'aime Lire Québec pour 44.95$ - 5$ =
  45.15 $ taxes incluses` -> `coupon_option_chosen: "1 an"`,
  `coupon_option_price: "45.15"`

### Output

```json
{
  "coupon_option_chosen": "1 an",
  "coupon_option_price": "45.94",
  "confidence": "high",
  "selection_source": "explicit_mark"
}
```

Use `selection_source: "inferred_from_amount"` when the selected option is
chosen by matching the coupon option price to the check amount.

## 3. Coupon Promo Code

### Goal

Extract `coupon_promo_code`, the promotional code printed on the coupon.
Return `null` when it cannot be determined confidently.

### Main rule

- Only look in the coupon region, not the check region.
- Prefer OCR lines in the lower coupon area, usually `top >= 0.60`.
- The promo code is usually located above the barcode / subscriber-address area.
- Do not require the promo code to be immediately above the barcode in OCR text
  order, because OCR ordering can merge or reorder nearby coupon text.
- Search coupon OCR lines for a promo-like substring matching:

```regex
[A-Z]{3}[0-9]{4}[A-Z0-9]{2,}
```

- Return the substring match, not the full OCR line.

### Expected pattern

The promo code usually has:

- `3` uppercase letters for the product or campaign prefix, such as `CUR`,
  `EXP`, `DEB`, `AST`, `PJQ`, or `JAL`
- `4` digits in the middle, usually a year-like value such as `2021`, `2022`,
  or `2023`
- uppercase letters or digits at the end, commonly `AV1`

### Best choice

Use this priority order:

1. One clean promo-like token in the coupon region, usually around
   `top ~= 0.61-0.70`.
2. A promo-like substring embedded in a longer coupon line.
3. If multiple different promo-like tokens are found, flag the conflict and
   return `null` unless one candidate is clearly in the expected coupon promo
   location.
4. Otherwise return `null`.

### Confidence

- `high`: exactly one clean promo-like token exists in the coupon region.
- `medium`: the token is embedded in extra text, or OCR fidelity is questionable
  but the match is still plausible.
- `low`: multiple candidates compete, the year digits look damaged, or the
  token is outside the expected coupon promo location.

### Review flags

Flag for manual review when:

- no promo-like token is found
- multiple different promo-like tokens are found
- the extracted token looks OCR-damaged, especially around the year digits

### Examples

- `CUR2022AV1` -> `coupon_promo_code: "CUR2022AV1"`, high confidence
- `EXP2021AV1` -> `coupon_promo_code: "EXP2021AV1"`, high confidence
- `DEB2021AV1 2022-12-21` -> `coupon_promo_code: "DEB2021AV1"`, medium
  confidence
- `PJQ2200AV1` -> `coupon_promo_code: "PJQ2200AV1"`, medium confidence and
  flag for possible OCR damage
- no usable promo-like token -> `null`

### Output

```json
{
  "coupon_promo_code": "CUR2022AV1",
  "confidence": "high"
}
```
