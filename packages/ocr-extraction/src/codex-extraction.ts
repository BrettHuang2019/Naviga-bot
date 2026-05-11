import { exec } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type ExtractJson = {
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

export type CommandRunResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string, options: { cwd: string }) => Promise<CommandRunResult>;

export type CodexExtractionOptions = {
  caseId?: string;
  casesDir?: string;
  docsDir?: string;
  commandRunner?: CommandRunner;
};

export type CodexExtractionResult = {
  caseDir: string;
  extract: ExtractJson;
  files: {
    ocr: string;
    extract: string;
    rules: string;
  };
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function defaultCaseId(): string {
  return `case_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function jsonStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildCommand(commandTemplate: string, prompt: string): string {
  const commandPrompt = prompt.replace(/\s+/g, " ").trim().replace(/"/g, '\\"');
  return commandTemplate.replace("{prompt}", commandPrompt).trim();
}

async function defaultCommandRunner(command: string, options: { cwd: string }): Promise<CommandRunResult> {
  return execAsync(command, { cwd: options.cwd, windowsHide: true });
}

function assertExtractJson(value: unknown): asserts value is ExtractJson {
  if (typeof value !== "object" || value === null || !("check" in value) || !("coupon" in value)) {
    throw new Error("Codex extraction did not produce an object with check and coupon sections.");
  }
}

export async function extractOcrJsonWithCodex(ocrJson: unknown, options: CodexExtractionOptions = {}): Promise<CodexExtractionResult> {
  const docsDir = options.docsDir ?? path.join(packageRoot, "docs");
  const casesDir = options.casesDir ?? path.join(packageRoot, "artifacts", "codex-cases");
  const caseDir = path.join(casesDir, options.caseId ?? defaultCaseId());
  const ocrPath = path.join(caseDir, "ocr.json");
  const extractPath = path.join(caseDir, "extract.json");
  const rulesPath = path.join(caseDir, "extract_rules.md");

  await mkdir(caseDir, { recursive: true });
  await writeFile(ocrPath, jsonStringify(ocrJson), "utf8");
  await copyFile(path.join(docsDir, "extract_template.json"), extractPath);
  await copyFile(path.join(docsDir, "extract_rules.md"), rulesPath);

  const prompt = await readFile(path.join(docsDir, "extract_prompt.md"), "utf8");
  const commandTemplate = await readFile(path.join(docsDir, "extract_command.md"), "utf8");
  const command = buildCommand(commandTemplate, prompt);
  const runner = options.commandRunner ?? defaultCommandRunner;

  await runner(command, { cwd: caseDir });

  const extract = JSON.parse(await readFile(extractPath, "utf8")) as unknown;
  assertExtractJson(extract);

  return {
    caseDir,
    extract,
    files: {
      ocr: ocrPath,
      extract: extractPath,
      rules: rulesPath,
    },
  };
}
