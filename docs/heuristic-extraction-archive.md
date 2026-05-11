# Heuristic OCR Extraction Archive

The rule-based OCR extraction functions under `src/comparison` are archived for reference and test comparison.

Production intake no longer uses these functions to create case extraction artifacts. The pipeline now calls `packages/ocr-extraction` through `extractOcrJsonWithCodex()` and adapts that result into the existing `check-extract.json`, `coupon-extract.json`, and `case.json` shapes.

Current active path:

```txt
SharePoint/CLI OCR payload
-> src/worker/index.ts processOcrPayload()
-> packages/ocr-extraction extractOcrJsonWithCodex()
-> src/worker/index.ts adaptCodexExtractToIncomeExtraction()
-> existing workflow artifacts and batch workflow
```

Archived heuristic entry points kept for later reconsideration:

- `src/comparison/index.ts` `extractCheck()`
- `src/comparison/index.ts` `extractCoupon()`
- `src/comparison/index.ts` `extractIncomeDocument()`

Non-intake report tooling may still reference the archived functions until those tools are retired or migrated.
