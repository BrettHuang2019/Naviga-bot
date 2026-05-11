import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractOcrJsonWithCodex, type CommandRunner, type ExtractJson } from "./codex-extraction.js";

const rootDir = process.cwd();

test("creates case folder, runs configured Codex command, and returns extracted JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ocr-extraction-"));
  const ocrPath = path.join(rootDir, "artifacts", "case_225139", "ocr-2026-05-04T17-42-55.891Z_225139.json");
  const expectedPath = path.join(rootDir, "artifacts", "case_225139", "extract_225139.json");
  const ocrJson = JSON.parse(await readFile(ocrPath, "utf8")) as unknown;
  const expected = JSON.parse(await readFile(expectedPath, "utf8")) as ExtractJson;
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
    return { stdout: "", stderr: "" };
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
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
