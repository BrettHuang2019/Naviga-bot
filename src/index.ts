import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { loadAppConfig, loadEnv, loadPageDefinitions, loadWorkflowDefinitions } from "./config.js";
import { createDomSnapshotRecorder } from "./snapshot.js";
import { executeWorkflow } from "./workflow.js";

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

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const cliArgs = process.argv.slice(2);
  const selectedWorkflowId = cliArgs.find((arg) => !arg.startsWith("--"));
  const envOverrides = parseCliEnvOverrides(cliArgs);
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    ...envOverrides,
  };
  const appConfig = await loadAppConfig(rootDir);
  const workflows = await loadWorkflowDefinitions(rootDir);
  const pages = await loadPageDefinitions(rootDir);
  const workflowId = selectedWorkflowId ?? appConfig.defaultWorkflow;

  const browser = await chromium.launch({
    headless: appConfig.browser.headless,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const snapshotRecorder = await createDomSnapshotRecorder(rootDir);

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
  console.log(`Browser remains open. Press Ctrl+C in this terminal to stop the process.`);

  await new Promise(() => {});
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
