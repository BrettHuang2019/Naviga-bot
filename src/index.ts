import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { loadAppConfig, loadEnv, loadPageDefinitions, loadWorkflowDefinitions } from "./config.js";
import { createDomSnapshotRecorder } from "./snapshot.js";
import { executeWorkflow } from "./workflow.js";

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const selectedWorkflowId = process.argv[2];
  const env = await loadEnv(rootDir);
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
  console.log(`Browser remains open. Press Ctrl+C in this terminal to stop the process.`);

  await new Promise(() => {});
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
