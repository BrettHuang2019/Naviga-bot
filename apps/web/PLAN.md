# Web Review UI — Plan

## Stack
- Express (already running) — serves API + static files + server-rendered HTML
- Plain HTML/CSS — no build step, no framework

## Pages

### 1. Case List `GET /`
- Read all `artifacts/cases/*/case.json` and `pipeline.json`
- Show table: Case ID, Created, Subscriber, Product, Score, Status
- Status comes from pipeline outcome (`pending` / `queued` / `running` / `succeeded` / `failed`)

### 2. Case Detail `GET /cases/:id`
- Three columns side by side:
  - **Check extract** — check fields parsed from OCR
  - **Coupon extract** — coupon fields parsed from OCR
  - **Naviga subscription summary** — fields captured by batch workflow
- Pipeline section shows OCR + batch step status and batch stack on failure
- Recommendation box in the header mirrors pipeline outcome

## Files

| File | Action |
|------|--------|
| `src/worker/index.ts` | Add `imageLink` to `StoredCase` — **done** |
| `apps/web/public/style.css` | Create styles — **done** |
| `apps/web/index.ts` | Add review router + HTML templates — **done** |

## Data flow

```
artifacts/cases/:id/
  case.json          → identity + OCR extraction metadata
  check-extract.json → check OCR fields
  coupon-extract.json → coupon OCR fields
  Naviga-subscription-summary.json → batch workflow capture
  pipeline.json      → OCR + batch workflow status
```

## Real data notes (from case 2026-03-31T18-08-25Z_149774)

**Coupon fields surfaced:**
- `subscriberClientNumber`, `selectedOption`, `promoCode`, `allOptions[]`, `rawTextPreview`

**Naviga fields:**
- `subscriber.name`, `subscriber.id`, `deliveryAddress`, `promotion`, `termDetails.term`, `pricingDetails.total`

**Check fields surfaced:** `checkNumber`, `date`, `payTo`, `amountNumber`, `amountWords`, `payerName`, `payerAddress`

**Coupon image** is a SharePoint URL (`imageLink`) — rendered as an external link (no embed, auth-gated).

**Raw OCR text** is collapsed in a `<details>` with pipe-separated tokens split to newlines.
