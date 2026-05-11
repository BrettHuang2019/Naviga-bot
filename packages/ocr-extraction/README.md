# @naviga-bot/ocr-extraction

Small package for turning one incoming OCR JSON payload into one extracted income-document JSON result.

The package prepares a case folder, writes the OCR input, creates an empty extraction file from `docs/extract_template.json`, runs the configured Codex command, then reads the filled extraction JSON and returns it to the caller.

## Runtime Requirements

- Node.js with ESM support.
- `codex` CLI available on `PATH` in the runtime environment.
- This package directory must include:
  - `docs/extract_command.md`
  - `docs/extract_prompt.md`
  - `docs/extract_template.json`
  - `docs/extract_rules.md`

## Main API

```ts
import { extractOcrJsonWithCodex } from "@naviga-bot/ocr-extraction";

const result = await extractOcrJsonWithCodex(ocrJson);

return result.extract;
```

`ocrJson` is the OCR JSON object received from the upstream OCR provider.

`result.extract` has this shape:

```ts
type ExtractJson = {
  check: {
    checkNumber: string;
    date: string;
    payTo: string;
    amountNumber: string;
    amountWords: string;
    payerName: string;
    payerAddress: string;
  };
  coupon: {
    clientId: string;
    clientName: string;
    promoCode: string;
    optionAmount: string;
    optionChosen: string;
    priceFromChosenOption: string;
    issuesFromChosenOption: string;
    regularOrExtra: string;
  };
};
```

## What Happens Internally

For each call, the package:

1. Creates a case folder under `artifacts/codex-cases`.
2. Writes incoming OCR JSON to `ocr.json`.
3. Copies `docs/extract_template.json` to `extract.json`.
4. Copies `docs/extract_rules.md` to `extract_rules.md`.
5. Reads prompt text from `docs/extract_prompt.md`.
6. Reads command template from `docs/extract_command.md`.
7. Replaces `{prompt}` in the command template.
8. Runs the command in the case folder.
9. Reads `extract.json`.
10. Returns the parsed JSON.

Default command template:

```sh
codex exec "{prompt}"
```

Default prompt:

```txt
Read the OCR JSON file in the current directory, apply the extraction rules from extract_rules.md, and fill in the empty extract JSON file with the extracted data.
```

## Options

```ts
const result = await extractOcrJsonWithCodex(ocrJson, {
  caseId: "case_225139",
  casesDir: "C:/tmp/ocr-cases",
  docsDir: "C:/Documents/GitHub/Naviga-bot/packages/ocr-extraction/docs",
});
```

Options:

- `caseId`: folder name for this extraction. Defaults to timestamp-based `case_<iso-date>`.
- `casesDir`: parent directory for case folders. Defaults to `artifacts/codex-cases` inside this package.
- `docsDir`: directory containing prompt, command, template, and rules docs. Defaults to this package's `docs`.
- `commandRunner`: test hook or custom runner. Most apps should not set this.

## Downstream Usage

Typical app flow:

```ts
import { extractOcrJsonWithCodex } from "@naviga-bot/ocr-extraction";

export async function handleOcrWebhook(payload: unknown) {
  const { extract } = await extractOcrJsonWithCodex(payload);

  return {
    check: extract.check,
    coupon: extract.coupon,
  };
}
```

The caller owns OCR capture, storage, webhooks, retries, and business decisions. This package only transforms OCR JSON into extracted JSON.

## Errors

The function throws when:

- Case folder cannot be created.
- Template, prompt, command, or rules files are missing.
- `codex` command fails.
- `extract.json` is not valid JSON after command completes.
- Parsed output does not include `check` and `coupon`.

Callers should catch errors and decide retry/manual-review behavior.

## Local Development

```sh
npm install
npm run typecheck
npm test
```

`npm test` runs one golden test using existing OCR artifact `artifacts/case_225139/ocr-2026-05-04T17-42-55.891Z_225139.json`. The test injects a fake command runner, so it does not call real Codex.

Legacy heuristic extraction helpers still exist under `src/comparison` and remain exported for compatibility, but new app integration should use `extractOcrJsonWithCodex`.
