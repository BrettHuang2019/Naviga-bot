# Fixtures

The package includes the April 27, 2026 OCR JSON payloads here:

```txt
fixtures/ocr/
  ocr-2026-04-27T15-08-24.067Z_614601.json
  ocr-2026-04-27T15-08-29.391Z_784954.json
  ocr-2026-04-27T15-08-50.286Z_181105.json
  ocr-2026-04-27T15-08-54.410Z_560157.json
```

Then run:

```sh
npm run test:fixtures
```

For new template work, prefer this structure:

```txt
fixtures/
  LCL/
    raw/
      case-001.json
    expected/
      case-001.expected.json
    NOTES.md
```

Expected output should include the required check and coupon fields from `docs/field-rules.md` and any confidence metadata added by the new architecture.

Fixtures should be understandable from this package alone. Add short notes when an OCR result has damaged dates, split coupon rows, weak check amounts, or inferred selected options.
