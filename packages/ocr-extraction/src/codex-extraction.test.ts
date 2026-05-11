import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractOcrJsonWithCodex, type CommandRunner, type ExtractJson } from "./codex-extraction.js";

test("creates case folder, runs configured Codex command, and returns extracted JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ocr-extraction-"));
  const ocrJson = { fullText: "Client # 225139\nPromo ABC2600AV2" };
  const expected: ExtractJson = {
    check: {
      checkNumber: "219",
      date: "2026-03-09",
      payTo: "Living with Christ",
      amountNumber: "47.20",
      amountWords: "Forty-Seven 20/100",
      payerName: "Lucienne Malo",
      payerAddress: "101-4805 42 ST, ST. PAUL AB T0A 3A2",
    },
    coupon: {
      clientId: "225139",
      clientName: "LUCIENNE MALO",
      promoCode: "ABC2600AV2",
      optionAmount: "47.20",
      optionChosen: "1 Year",
      priceFromChosenOption: "47.20",
      issuesFromChosenOption: "",
      regularOrExtra: "regular",
    },
  };
  const commands: string[] = [];

  const commandRunner: CommandRunner = async (command, options) => {
    commands.push(command);

    assert.equal(path.basename(options.cwd), "case_225139");
    assert.deepEqual(JSON.parse(await readFile(path.join(options.cwd, "ocr.json"), "utf8")), ocrJson);
    assert.deepEqual(JSON.parse(await readFile(path.join(options.cwd, "extract.json"), "utf8")), {
      check: {
        checkNumber: "",
        date: "",
        payTo: "",
        amountNumber: "",
        amountWords: "",
        payerName: "",
        payerAddress: "",
      },
      coupon: {
        clientId: "",
        clientName: "",
        promoCode: "",
        optionAmount: "",
        optionChosen: "",
        priceFromChosenOption: "",
        issuesFromChosenOption: "",
        regularOrExtra: "",
      },
    });
    assert.match(await readFile(path.join(options.cwd, "extract_rules.md"), "utf8"), /checkNumber/);

    await writeFile(path.join(options.cwd, "extract.json"), `${JSON.stringify(expected, null, 2)}\n`, "utf8");
    return { stdout: "extracted", stderr: "diagnostic" };
  };

  try {
    const result = await extractOcrJsonWithCodex(ocrJson, {
      caseId: "case_225139",
      casesDir: tempDir,
      commandRunner,
    });

    assert.equal(commands.length, 1);
    assert.match(commands[0], /^codex exec "/);
    assert.match(commands[0], /Read the OCR JSON file in the current directory/);
    assert.equal(result.caseDir, path.join(tempDir, "case_225139"));
    assert.deepEqual(result.extract, expected);
    assert.match(await readFile(result.files.commandLog, "utf8"), /stdout:\nextracted\n\nstderr:\ndiagnostic/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
