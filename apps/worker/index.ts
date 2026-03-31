import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { generateRenewalVerificationReport, getDefaultRenewalVerificationPaths } from "../../src/comparison/report.js";
import { loadEnv } from "../../src/config/env.js";
import {
  createDomSnapshotRecorder,
  executeWorkflow,
  loadAppConfig,
  loadPageDefinitions,
  loadWorkflowDefinitions,
} from "../../src/naviga-workflows/index.js";
import { processOcrPayload } from "../../src/worker/index.js";

function parseCliEnvOverrides(args: string[]): Record<string, string> {
  return args.reduce<Record<string, string>>((overrides, arg) => {
    if (!arg.startsWith("--env:")) {
      return overrides;
    }

    const assignment = arg.slice("--env:".length);
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error(`Invalid env override "${arg}". Use --env:KEY=value.`);
    }

    const key = assignment.slice(0, separatorIndex).trim();
    const value = assignment.slice(separatorIndex + 1).trim();

    if (!key || !value) {
      throw new Error(`Invalid env override "${arg}". Use --env:KEY=value.`);
    }

    overrides[key] = value;
    return overrides;
  }, {});
}

function parseCliArgs(args: string[]): {
  selectedWorkflowId?: string;
  ocrFilePath?: string;
  envOverrides: Record<string, string>;
} {
  let selectedWorkflowId: string | undefined;
  let ocrFilePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--ocr-file") {
      ocrFilePath = args[index + 1];
      index += 1;
      continue;
    }

    if (!arg.startsWith("--") && !selectedWorkflowId) {
      selectedWorkflowId = arg;
    }
  }

  return {
    selectedWorkflowId,
    ocrFilePath,
    envOverrides: parseCliEnvOverrides(args),
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function maybeRunRenewalVerification(rootDir: string): Promise<void> {
  const paths = getDefaultRenewalVerificationPaths(rootDir);
  const hasSubscriptionDetail = await fileExists(paths.subscriptionDetailPath);
  const hasOcrDirectory = await fileExists(paths.ocrDirectoryPath);

  if (!hasSubscriptionDetail || !hasOcrDirectory) {
    return;
  }

  const report = await generateRenewalVerificationReport(paths);
  console.log(`Wrote renewal verification report -> ${paths.outputPath}`);
  if (report.bestCandidate) {
    console.log(`Best candidate score: ${report.bestCandidate.score}`);
    console.log(`Best candidate file: ${report.bestCandidate.file}`);
  }
}

async function runWorkflowCli(rootDir: string, selectedWorkflowId: string | undefined, envOverrides: Record<string, string>): Promise<void> {
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    ...envOverrides,
  };
  const appConfig = await loadAppConfig(rootDir);
  const workflows = await loadWorkflowDefinitions(rootDir);
  const pages = await loadPageDefinitions(rootDir);
  const workflowId = selectedWorkflowId ?? appConfig.defaultWorkflow;

  if (!env.NAVIGA_SUBSCRIPTION_OUTPUT_PATH) {
    env.NAVIGA_SUBSCRIPTION_OUTPUT_PATH = path.join(rootDir, "artifacts", "json", "subscription-detail.json");
  }

  const browser = await chromium.launch({
    headless: appConfig.browser.headless,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const snapshotRecorder = await createDomSnapshotRecorder(rootDir);
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}. Closing browser...`);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  page.on("domcontentloaded", async () => {
    try {
      await snapshotRecorder.capture(page);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`Failed to save DOM snapshot: ${message}`);
    }
  });

  await executeWorkflow(
    workflowId,
    page,
    {
      env,
      workflows,
      pages,
      rootDir,
    },
    async () => {
      await snapshotRecorder.capture(page);
    },
  );

  const workflowRoot = path.join(rootDir, "workflow");
  console.log(`Workflow root loaded from ${workflowRoot}`);
  console.log(`Selected workflow: ${workflowId}`);
  if (Object.keys(envOverrides).length > 0) {
    console.log(`Applied CLI env overrides: ${Object.keys(envOverrides).join(", ")}`);
  }

  await maybeRunRenewalVerification(rootDir);

  if (appConfig.browser.keepOpen) {
    console.log("Browser remains open. Press Ctrl+C in this terminal to stop the process.");
    await new Promise(() => {});
  }

  await shutdown("workflow-complete");
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const { selectedWorkflowId, ocrFilePath, envOverrides } = parseCliArgs(process.argv.slice(2));

  if (ocrFilePath) {
    const appConfig = await loadAppConfig(rootDir);
    const payload = JSON.parse(await readFile(ocrFilePath, "utf8"));
    const storedCase = await processOcrPayload(payload, {
      rootDir,
      workflowId: selectedWorkflowId ?? appConfig.defaultWorkflow,
      persistOcrArtifact: false,
    });

    console.log(`Stored case -> ${storedCase.paths.caseFile}`);
    console.log(`Subscriber client number: ${storedCase.subscriberClientNumber ?? "<missing>"}`);
    console.log(`Recommendation: ${storedCase.verification.recommendation}`);
    return;
  }

  await runWorkflowCli(rootDir, selectedWorkflowId, envOverrides);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
