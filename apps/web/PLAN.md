# Web Review UI — Plan

## Stack
- Express (already running) — serves API + static files + server-rendered HTML
- HTMX — reviewer actions without page reloads
- Plain HTML/CSS — no build step, no framework

## Pages

### 1. Case List `GET /`
- Read all `artifacts/cases/*/case.json`
- Show table: Case ID, Created, Subscriber, Product, Score, Status
- Status comes from `decision.json` (pending / approved / flagged)

### 2. Case Detail `GET /cases/:id`
- Three columns side by side:
  - **Coupon (OCR)** — fields from `case.ocrExtraction` + coupon image from `case.imageLink`
  - **Naviga** — fields from `case.subscription`
  - **Checks** — score + field-by-field from `case.verification.bestCandidate.checks`
- Recommendation box in the header
- Decision bar at the bottom (Approve / Flag buttons via HTMX)

### 3. Decision `POST /cases/:id/decision`
- HTMX endpoint — saves `decision.json` in the case folder
- Returns HTML fragment to swap the buttons with a status badge
- Payload: `{ status: "approved" | "flagged" }`

## Files

| File | Action |
|------|--------|
| `src/worker/index.ts` | Add `imageLink` to `StoredCase` — **done** |
| `apps/web/public/style.css` | Create styles — **done** |
| `apps/web/index.ts` | Add review router + HTML templates — **done** |

## Data flow

```
artifacts/cases/:id/
  case.json          → identity + OCR extraction + subscription + checks
  decision.json      → reviewer decision (written on POST /cases/:id/decision)
```

## Real data notes (from case 2026-03-31T18-08-25Z_149774)

**OCR fields surfaced:**
- `subscriberName`, `subscriberClientNumber`, `billToNameId`, `payerName`, `payerAddress` (null), `productName` (null), `promoCode`, `paymentAmount`, `copies`, `options[]`, `selectedOption` (null), `rawTextPreview`

**Naviga fields:**
- `subscriberName`, `clientNumber`, `productName`, `billToName`, `billToNameId`, `renewalName`, `totalAmount`, `renewalTerm`, `term`

**Check statuses:** `match` | `mismatch` | `missing` | `partial`

**Coupon image** is a SharePoint URL (`imageLink`) — rendered as an external link (no embed, auth-gated).

**Raw OCR text** is collapsed in a `<details>` with pipe-separated tokens split to newlines.
