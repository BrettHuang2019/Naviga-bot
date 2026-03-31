import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  extractCoupon,
  summarizeSubscription,
  verifyRenewalCandidates,
  type CouponExtraction,
  type OcrPayload,
  type SubscriptionDetail,
  type VerificationReport,
} from "../comparison/index.js";
import { loadEnv } from "../config/env.js";
import {
  createDomSnapshotRecorder,
  executeWorkflow,
  loadAppConfig,
  loadPageDefinitions,
  loadWorkflowDefinitions,
} from "../naviga-workflows/index.js";
import { saveOcrArtifact } from "../sharepoint/index.js";

export type StoredCase = {
  id: string;
  createdAt: string;
  subscriberClientNumber: string | null;
  imageLink: string | null;
  workflowId: string;
  paths: {
    root: string;
    ocrPayload: string;
    subscriptionDetail: string;
    verificationReport: string;
    caseFile: string;
  };
  ocrExtraction: CouponExtraction;
  subscription: VerificationReport["subscription"];
  verification: Pick<VerificationReport, "bestCandidate" | "topCandidates" | "recommendation" | "verificationStrategy">;
};

type ProcessOcrPayloadOptions = {
  rootDir?: string;
  workflowId?: string;
  persistOcrArtifact?: boolean;
};

function createCaseId(date: Date, clientNumber?: string | null): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return clientNumber ? `${timestamp}_${clientNumber}` : timestamp;
}

function getCasePaths(rootDir: string, caseId: string) {
  const caseRoot = path.join(rootDir, "artifacts", "cases", caseId);
  return {
    caseRoot,
    ocrPayloadPath: path.join(caseRoot, "ocr-payload.json"),
    subscriptionDetailPath: path.join(caseRoot, "subscription-detail.json"),
    verificationReportPath: path.join(caseRoot, "verification-report.json"),
    caseFilePath: path.join(caseRoot, "case.json"),
  };
}

async function runWorkflowForSubscriber(params: {
  rootDir: string;
  workflowId: string;
  subscriberClientNumber: string;
  subscriptionDetailPath: string;
}): Promise<void> {
  const { rootDir, workflowId, subscriberClientNumber, subscriptionDetailPath } = params;
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    NAVIGA_QUERY: subscriberClientNumber,
    NAVIGA_SUBSCRIPTION_OUTPUT_PATH: subscriptionDetailPath,
  };

  await runBrowserWorkflow({ rootDir, workflowId, env });
}

async function runBrowserWorkflow(params: {
  rootDir: string;
  workflowId: string;
  env: Record<string, string>;
}): Promise<void> {
  const { rootDir, workflowId, env } = params;
  const appConfig = await loadAppConfig(rootDir);
  const workflows = await loadWorkflowDefinitions(rootDir);
  const pages = await loadPageDefinitions(rootDir);

  const browser = await chromium.launch({
    headless: appConfig.browser.headless,
  });

  try {
    const context = await browser.newContext();

    try {
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
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function runBatchWorkflow(params: {
  subscriberClientNumber: string;
  rootDir?: string;
}): Promise<void> {
  const rootDir = params.rootDir ?? process.cwd();
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    NAVIGA_QUERY: params.subscriberClientNumber,
  };
  await runBrowserWorkflow({ rootDir, workflowId: "add-subscription-to-batch", env });
}

function buildVerificationReport(params: {
  subscription: SubscriptionDetail;
  ocrExtraction: CouponExtraction;
  subscriptionDetailPath: string;
  ocrPayloadPath: string;
}): VerificationReport {
  const subscriptionSummary = summarizeSubscription(params.subscription);
  const verification = verifyRenewalCandidates(subscriptionSummary, [params.ocrExtraction]);

  return {
    generatedAt: new Date().toISOString(),
    input: {
      subscriptionDetailPath: params.subscriptionDetailPath,
      ocrDirectoryPath: path.dirname(params.ocrPayloadPath),
    },
    subscription: subscriptionSummary,
    ...verification,
  };
}

export async function processOcrPayload(
  payload: OcrPayload,
  options: ProcessOcrPayloadOptions = {},
): Promise<StoredCase> {
  const rootDir = options.rootDir ?? process.cwd();

  let parsedOcrText: unknown;
  try {
    parsedOcrText = JSON.parse(payload.ocrText);
  } catch {
    throw new Error("OCR payload ocrText is not valid JSON.");
  }

  const fullText =
    parsedOcrText !== null &&
    typeof parsedOcrText === "object" &&
    "responsev2" in parsedOcrText &&
    parsedOcrText.responsev2 !== null &&
    typeof parsedOcrText.responsev2 === "object" &&
    "predictionOutput" in parsedOcrText.responsev2 &&
    parsedOcrText.responsev2.predictionOutput !== null &&
    typeof parsedOcrText.responsev2.predictionOutput === "object" &&
    "fullText" in parsedOcrText.responsev2.predictionOutput &&
    typeof parsedOcrText.responsev2.predictionOutput.fullText === "string"
      ? parsedOcrText.responsev2.predictionOutput.fullText
      : null;

  if (!fullText) {
    throw new Error("OCR payload ocrText is missing responsev2.predictionOutput.fullText.");
  }

  const { subscriberClientNumber } = extractCoupon("", fullText);
  if (!subscriberClientNumber) {
    throw new Error("Unable to derive the subscriber client number from the OCR payload.");
  }

  const caseId = createCaseId(new Date(), subscriberClientNumber);
  const paths = getCasePaths(rootDir, caseId);

  await mkdir(paths.caseRoot, { recursive: true });
  await writeFile(paths.ocrPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  if (options.persistOcrArtifact !== false) {
    await saveOcrArtifact(payload, subscriberClientNumber);
  }

  const ocrExtraction = extractCoupon(paths.ocrPayloadPath, fullText);

  const appConfig = await loadAppConfig(rootDir);
  const workflowId = options.workflowId ?? appConfig.defaultWorkflow;

  await runWorkflowForSubscriber({
    rootDir,
    workflowId,
    subscriberClientNumber: ocrExtraction.subscriberClientNumber,
    subscriptionDetailPath: paths.subscriptionDetailPath,
  });

  const subscription = JSON.parse(await readFile(paths.subscriptionDetailPath, "utf8")) as SubscriptionDetail;
  const verificationReport = buildVerificationReport({
    subscription,
    ocrExtraction,
    subscriptionDetailPath: paths.subscriptionDetailPath,
    ocrPayloadPath: paths.ocrPayloadPath,
  });

  await writeFile(paths.verificationReportPath, `${JSON.stringify(verificationReport, null, 2)}\n`, "utf8");

  const storedCase: StoredCase = {
    id: caseId,
    createdAt: verificationReport.generatedAt,
    subscriberClientNumber: ocrExtraction.subscriberClientNumber,
    imageLink: typeof payload.imageLink === "string" ? payload.imageLink : null,
    workflowId,
    paths: {
      root: paths.caseRoot,
      ocrPayload: paths.ocrPayloadPath,
      subscriptionDetail: paths.subscriptionDetailPath,
      verificationReport: paths.verificationReportPath,
      caseFile: paths.caseFilePath,
    },
    ocrExtraction,
    subscription: verificationReport.subscription,
    verification: {
      bestCandidate: verificationReport.bestCandidate,
      topCandidates: verificationReport.topCandidates,
      recommendation: verificationReport.recommendation,
      verificationStrategy: verificationReport.verificationStrategy,
    },
  };

  await writeFile(paths.caseFilePath, `${JSON.stringify(storedCase, null, 2)}\n`, "utf8");

  return storedCase;
}
