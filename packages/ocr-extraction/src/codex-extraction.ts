import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export type CommandRunner = (command: string, options: { cwd: string; timeoutMs?: number }) => Promise<CommandRunResult>;

export type CodexExtractionOptions = {
  caseId?: string;
  casesDir?: string;
  docsDir?: string;
  commandRunner?: CommandRunner;
  commandTimeoutMs?: number;
};

export type CodexExtractionResult = {
  caseDir: string;
  extract: ExtractJson;
  files: {
    ocr: string;
    extract: string;
    rules: string;
    commandLog: string;
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

async function defaultCommandRunner(
  command: string,
  options: { cwd: string; timeoutMs?: number },
): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 10 * 60 * 1000);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (timedOut) {
        reject(new Error(`Codex extraction command timed out after ${options.timeoutMs ?? 10 * 60 * 1000} ms.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Codex extraction command failed with code ${code ?? "null"} signal ${signal ?? "none"}.\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
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
  const commandLogPath = path.join(caseDir, "codex-command.log");

  await mkdir(caseDir, { recursive: true });
  await writeFile(ocrPath, jsonStringify(ocrJson), "utf8");
  await copyFile(path.join(docsDir, "extract_template.json"), extractPath);
  await copyFile(path.join(docsDir, "extract_rules.md"), rulesPath);

  const prompt = await readFile(path.join(docsDir, "extract_prompt.md"), "utf8");
  const commandTemplate = await readFile(path.join(docsDir, "extract_command.md"), "utf8");
  const command = buildCommand(commandTemplate, prompt);
  const runner = options.commandRunner ?? defaultCommandRunner;

  const commandResult = await runner(command, { cwd: caseDir, timeoutMs: options.commandTimeoutMs });
  await writeFile(
    commandLogPath,
    [
      `command: ${command}`,
      "",
      "stdout:",
      commandResult.stdout.trimEnd(),
      "",
      "stderr:",
      commandResult.stderr.trimEnd(),
      "",
    ].join("\n"),
    "utf8",
  );

  const extract = JSON.parse(await readFile(extractPath, "utf8")) as unknown;
  assertExtractJson(extract);

  return {
    caseDir,
    extract,
    files: {
      ocr: ocrPath,
      extract: extractPath,
      rules: rulesPath,
      commandLog: commandLogPath,
    },
  };
}
