import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  extractCoupon,
  extractIncomeDocument,
  type CheckExtraction,
  type CouponExtraction,
  type IncomeExtraction,
  type ParsedOcrDocument,
  summarizeSubscription,
  verifyRenewalCandidates,
  type OcrPayload,
  type SubscriptionDetail,
  type VerificationReport,
} from "../comparison/index.js";
import { parseOcrPayload } from "../comparison/ocr-parser.js";
import { loadEnv } from "../config/env.js";
import {
  createDomSnapshotRecorder,
  executeWorkflow,
  loadAppConfig,
  loadPageDefinitions,
  loadWorkflowDefinitions,
} from "../naviga-workflows/index.js";
import { saveOcrArtifact } from "../sharepoint/index.js";
import { toNavigaPromotionLookupCode } from "./promotion-code.js";
import {
  resolveSubscriptionTermTime,
  resolveSubscriptionTermTimeFromFile,
  type TermTimeCouponSource,
} from "./subscription-term-time.js";

type WorkflowRunStatus = "queued" | "running" | "succeeded" | "failed";

type WorkflowRunState = {
  workflowId: string;
  status: WorkflowRunStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: {
    message: string;
    stack?: string;
  };
};

type CasePipelineStatus = {
  version: 1;
  updatedAt: string;
  ocrExtraction?: {
    status: "succeeded" | "failed";
    finishedAt: string;
    error?: {
      message: string;
      stack?: string;
    };
  };
  subscriptionWorkflow?: WorkflowRunState;
  batchWorkflow?: WorkflowRunState;
};

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }

  return { message: String(error) };
}

async function readPipelineStatusOrNull(filePath: string): Promise<CasePipelineStatus | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as CasePipelineStatus;
  } catch {
    return null;
  }
}

async function updatePipelineStatus(filePath: string, patch: Partial<CasePipelineStatus>): Promise<void> {
  const existing = await readPipelineStatusOrNull(filePath);
  const next: CasePipelineStatus = {
    version: 1,
    ...(existing ?? {}),
    updatedAt: new Date().toISOString(),
    ...patch,
  };

  try {
    await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(timestampedMessage(`[pipeline] failed to write pipeline status: ${message}`));
  }
}

export type StoredCase = {
  id: string;
  createdAt: string;
  subscriberClientNumber: string | null;
  imageLink: string | null;
  workflowId: string;
  paths: {
    root: string;
    ocrPayload: string;
    checkExtract: string;
    couponExtract: string;
    subscriptionDetail: string;
    verificationReport: string;
    caseFile: string;
    pipeline: string;
  };
  incomeExtraction: IncomeExtraction;
  ocrExtraction: IncomeExtraction["coupon"];
  subscription: VerificationReport["subscription"] | null;
  verification: Pick<VerificationReport, "bestCandidate" | "topCandidates" | "recommendation" | "verificationStrategy"> | null;
};

type ProcessOcrPayloadOptions = {
  rootDir?: string;
  workflowId?: string;
  persistOcrArtifact?: boolean;
  runSubscriptionWorkflow?: boolean;
};

type WorkflowQueueTask<T> = {
  label: string;
  run: () => Promise<T>;
};

let workflowQueueTail: Promise<void> = Promise.resolve();
let workflowQueueDepth = 0;

function timestampedMessage(message: string): string {
  return `[${new Date().toISOString()}] ${message}`;
}

async function enqueueWorkflowTask<T>(task: WorkflowQueueTask<T>): Promise<T> {
  const position = workflowQueueDepth + 1;
  workflowQueueDepth += 1;
  console.log(timestampedMessage(`[workflow-queue] queued "${task.label}" at position ${position}`));

  const waitForTurn = workflowQueueTail.catch(() => undefined);
  let releaseQueue: () => void = () => undefined;

  workflowQueueTail = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await waitForTurn;
  console.log(timestampedMessage(`[workflow-queue] starting "${task.label}"`));

  try {
    const result = await task.run();
    console.log(timestampedMessage(`[workflow-queue] completed "${task.label}"`));
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(timestampedMessage(`[workflow-queue] failed "${task.label}": ${message}`));
    throw error;
  } finally {
    workflowQueueDepth = Math.max(0, workflowQueueDepth - 1);
    releaseQueue();
  }
}

function createCaseId(date: Date, clientNumber?: string | null): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return clientNumber ? `${timestamp}_${clientNumber}` : timestamp;
}

function getCasePaths(rootDir: string, caseId: string) {
  const caseRoot = path.join(rootDir, "artifacts", "cases", caseId);
  return {
    caseRoot,
    ocrPayloadPath: path.join(caseRoot, "ocr-payload.json"),
    checkExtractPath: path.join(caseRoot, "check-extract.json"),
    couponExtractPath: path.join(caseRoot, "coupon-extract.json"),
    subscriptionDetailPath: path.join(caseRoot, "subscription-detail.json"),
    verificationReportPath: path.join(caseRoot, "verification-report.json"),
    caseFilePath: path.join(caseRoot, "case.json"),
    pipelinePath: path.join(caseRoot, "pipeline.json"),
  };
}

const checkFields = [
  { rule: "check num", extractorField: "checkNumber" },
  { rule: "date - maximum 3 months from today's date.", extractorField: "date" },
  { rule: "Pay to - only following bussiness names are accepted:", extractorField: "payTo" },
  { rule: "price in number", extractorField: "amountNumber" },
  { rule: "price in words.", extractorField: "amountWords" },
  { rule: "name", extractorField: "payerName" },
  { rule: "address", extractorField: "payerAddress" },
] as const satisfies ReadonlyArray<{ rule: string; extractorField: keyof CheckExtraction }>;

const couponFields = [
  { rule: "1. Coupon Client ID", extractorField: "subscriberClientNumber" },
  { rule: "2. Coupon Option Chosen and Option Price", extractorField: "selectedOption" },
  { rule: "3. Coupon Promo Code", extractorField: "promoCode" },
] as const satisfies ReadonlyArray<{ rule: string; extractorField: keyof CouponExtraction }>;

function selectedCouponOptionValue(extraction: CouponExtraction): { option: string | null; price: string | null } {
  return {
    option: extraction.selectedOption?.raw ?? null,
    price: extraction.paymentAmount === null ? null : extraction.paymentAmount.toFixed(2),
  };
}

function couponFieldValue(extraction: CouponExtraction, field: keyof CouponExtraction): unknown {
  if (field === "selectedOption") {
    return selectedCouponOptionValue(extraction);
  }

  return extraction[field];
}

function isPresent(value: unknown): boolean {
  if (value === null || value === "") {
    return false;
  }

  if (typeof value === "object" && value !== null && "option" in value && "price" in value) {
    const option = value as { option: string | null; price: string | null };
    return option.option !== null && option.price !== null;
  }

  return true;
}

function buildCheckExtractReport(params: {
  generatedAt: string;
  ocrPayloadPath: string;
  extraction: CheckExtraction;
}) {
  const { generatedAt, ocrPayloadPath, extraction } = params;
  return {
    generatedAt,
    input: {
      ocrPayloadPath,
    },
    fields: Object.fromEntries(
      checkFields.map(({ rule, extractorField }) => {
        const value = extraction[extractorField];
        return [
          extractorField,
          {
            rule,
            value,
            present: isPresent(value),
            meta: extraction.fieldMeta?.[extractorField],
          },
        ];
      }),
    ),
    rawTextPreview: extraction.rawTextPreview,
  };
}

function buildCouponExtractReport(params: {
  generatedAt: string;
  ocrPayloadPath: string;
  imageLink: string | null;
  extraction: CouponExtraction;
}) {
  const { generatedAt, ocrPayloadPath, imageLink, extraction } = params;
  return {
    generatedAt,
    input: {
      ocrPayloadPath,
      imageLink,
    },
    fields: Object.fromEntries(
      couponFields.map(({ rule, extractorField }) => {
        const value = couponFieldValue(extraction, extractorField);
        const metaField = extractorField === "selectedOption" ? "selectedOption" : extractorField;
        return [
          extractorField,
          {
            rule,
            value,
            present: isPresent(value),
            meta: extraction.fieldMeta?.[metaField],
          },
        ];
      }),
    ),
    allOptions: extraction.options,
    rawTextPreview: extraction.rawTextPreview,
  };
}

async function runWorkflowForSubscriber(params: {
  rootDir: string;
  workflowId: string;
  subscriberClientNumber: string;
  promoCode?: string | null;
  couponExtraction?: TermTimeCouponSource | null;
  subscriptionDetailPath: string;
}): Promise<void> {
  const { rootDir, workflowId, subscriberClientNumber, promoCode, couponExtraction, subscriptionDetailPath } = params;
  const fileEnv = await loadEnv(rootDir);
  const termTime = couponExtraction ? await resolveSubscriptionTermTime(rootDir, couponExtraction) : null;
  const env = {
    ...fileEnv,
    NAVIGA_QUERY: subscriberClientNumber,
    ...(promoCode ? { NAVIGA_PROMO_CODE: promoCode } : {}),
    ...(promoCode ? { NAVIGA_PROMO_LOOKUP_CODE: toNavigaPromotionLookupCode(promoCode) } : {}),
    ...(termTime ? { NAVIGA_TERM_TIME: termTime } : {}),
    NAVIGA_SUBSCRIPTION_OUTPUT_PATH: subscriptionDetailPath,
  };

  await runBrowserWorkflow({ rootDir, workflowId, env });
}

async function runBrowserWorkflow(params: {
  rootDir: string;
  workflowId: string;
  env: Record<string, string>;
  keepOpen?: boolean;
}): Promise<void> {
  const { rootDir, workflowId, env, keepOpen = false } = params;
  const appConfig = await loadAppConfig(rootDir);
  const workflows = await loadWorkflowDefinitions(rootDir);
  const pages = await loadPageDefinitions(rootDir);

  const browser = await chromium.launch({
    headless: appConfig.browser.headless,
  });

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

    if (keepOpen) {
      console.log("Browser remains open after workflow stop point.");
      await new Promise(() => {});
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function runBatchWorkflow(params: {
  subscriberClientNumber: string;
  promoCode?: string | null;
  couponExtraction?: TermTimeCouponSource | null;
  couponExtractPath?: string | null;
  subscriptionSummaryOutputPath?: string | null;
  pipelinePath?: string | null;
  rootDir?: string;
  workflowId?: string;
  keepOpen?: boolean;
}): Promise<void> {
  const workflowId = params.workflowId ?? "add-subscription-to-batch";
  const queuedAt = new Date().toISOString();
  const pipelinePath =
    params.pipelinePath ?? (params.couponExtractPath ? path.join(path.dirname(params.couponExtractPath), "pipeline.json") : null);

  if (pipelinePath) {
    await updatePipelineStatus(pipelinePath, {
      batchWorkflow: {
        workflowId,
        status: "queued",
        queuedAt,
      },
    });
  }

  await enqueueWorkflowTask({
    label: `${workflowId}:${params.subscriberClientNumber}`,
    run: async () => {
      const rootDir = params.rootDir ?? process.cwd();
      const fileEnv = await loadEnv(rootDir);
      const startedAt = new Date().toISOString();

      if (pipelinePath) {
        await updatePipelineStatus(pipelinePath, {
          batchWorkflow: {
            workflowId,
            status: "running",
            queuedAt,
            startedAt,
          },
        });
      }

      try {
        const termTimeFromExtraction = params.couponExtraction
          ? await resolveSubscriptionTermTime(rootDir, params.couponExtraction)
          : null;
        const termTimeFromFile = !termTimeFromExtraction && params.couponExtractPath
          ? await resolveSubscriptionTermTimeFromFile(rootDir, params.couponExtractPath)
          : null;
        const termTime = termTimeFromExtraction ?? termTimeFromFile ?? fileEnv.NAVIGA_TERM_TIME ?? null;
        if (!termTime) {
          throw new Error("Unable to derive Term/Time: coupon extract is required or NAVIGA_TERM_TIME must be set.");
        }

        const subscriptionSummaryOutputPath =
          params.subscriptionSummaryOutputPath ??
          (params.couponExtractPath
            ? path.join(path.dirname(params.couponExtractPath), "Naviga-subscription-summary.json")
            : null);
        const env = {
          ...fileEnv,
          NAVIGA_QUERY: params.subscriberClientNumber,
          ...(params.promoCode ? { NAVIGA_PROMO_CODE: params.promoCode } : {}),
          ...(params.promoCode ? { NAVIGA_PROMO_LOOKUP_CODE: toNavigaPromotionLookupCode(params.promoCode) } : {}),
          NAVIGA_TERM_TIME: termTime,
          ...(params.couponExtractPath ? { NAVIGA_COUPON_EXTRACT_PATH: params.couponExtractPath } : {}),
          ...(subscriptionSummaryOutputPath ? { NAVIGA_SUBSCRIPTION_SUMMARY_OUTPUT_PATH: subscriptionSummaryOutputPath } : {}),
        };

        await runBrowserWorkflow({
          rootDir,
          workflowId,
          env,
          keepOpen: params.keepOpen ?? false,
        });

        if (pipelinePath) {
          await updatePipelineStatus(pipelinePath, {
            batchWorkflow: {
              workflowId,
              status: "succeeded",
              queuedAt,
              startedAt,
              finishedAt: new Date().toISOString(),
            },
          });
        }
      } catch (error: unknown) {
        if (pipelinePath) {
          await updatePipelineStatus(pipelinePath, {
            batchWorkflow: {
              workflowId,
              status: "failed",
              queuedAt,
              startedAt,
              finishedAt: new Date().toISOString(),
              error: serializeError(error),
            },
          });
        }

        throw error;
      }
    },
  });
}

function buildVerificationReport(params: {
  subscription: SubscriptionDetail;
  ocrExtraction: IncomeExtraction["coupon"];
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
  const runSubscriptionWorkflow = options.runSubscriptionWorkflow ?? true;
  const parsedDocument: ParsedOcrDocument = parseOcrPayload(payload);
  const { subscriberClientNumber } = extractCoupon("", parsedDocument);
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

  const incomeExtraction = extractIncomeDocument(paths.ocrPayloadPath, parsedDocument);
  const ocrExtraction = incomeExtraction.coupon;
  const extractionGeneratedAt = new Date().toISOString();
  const imageLink = typeof payload.imageLink === "string" ? payload.imageLink : parsedDocument.imageLink;

  await writeFile(
    paths.checkExtractPath,
    `${JSON.stringify(
      buildCheckExtractReport({
        generatedAt: extractionGeneratedAt,
        ocrPayloadPath: paths.ocrPayloadPath,
        extraction: incomeExtraction.check,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    paths.couponExtractPath,
    `${JSON.stringify(
      buildCouponExtractReport({
        generatedAt: extractionGeneratedAt,
        ocrPayloadPath: paths.ocrPayloadPath,
        imageLink,
        extraction: incomeExtraction.coupon,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  await updatePipelineStatus(paths.pipelinePath, {
    ocrExtraction: {
      status: "succeeded",
      finishedAt: extractionGeneratedAt,
    },
  });

  const workflowId = runSubscriptionWorkflow
    ? options.workflowId ?? (await loadAppConfig(rootDir)).defaultWorkflow
    : "extraction-only";

  const storedCase: StoredCase = {
    id: caseId,
    createdAt: extractionGeneratedAt,
    subscriberClientNumber: ocrExtraction.subscriberClientNumber,
    imageLink,
    workflowId,
    paths: {
      root: paths.caseRoot,
      ocrPayload: paths.ocrPayloadPath,
      checkExtract: paths.checkExtractPath,
      couponExtract: paths.couponExtractPath,
      subscriptionDetail: paths.subscriptionDetailPath,
      verificationReport: paths.verificationReportPath,
      caseFile: paths.caseFilePath,
      pipeline: paths.pipelinePath,
    },
    incomeExtraction,
    ocrExtraction,
    subscription: null,
    verification: null,
  };

  await writeFile(paths.caseFilePath, `${JSON.stringify(storedCase, null, 2)}\n`, "utf8");

  if (!runSubscriptionWorkflow) {
    return storedCase;
  }

  try {
    const subscriptionQueuedAt = new Date().toISOString();
    await updatePipelineStatus(paths.pipelinePath, {
      subscriptionWorkflow: {
        workflowId,
        status: "queued",
        queuedAt: subscriptionQueuedAt,
      },
    });

    await enqueueWorkflowTask({
      label: `${workflowId}:${subscriberClientNumber}`,
      run: async () =>
        (async () => {
          const subscriptionStartedAt = new Date().toISOString();
          await updatePipelineStatus(paths.pipelinePath, {
            subscriptionWorkflow: {
              workflowId,
              status: "running",
              queuedAt: subscriptionQueuedAt,
              startedAt: subscriptionStartedAt,
            },
          });

          try {
            await runWorkflowForSubscriber({
              rootDir,
              workflowId,
              subscriberClientNumber,
              promoCode: ocrExtraction.promoCode,
              couponExtraction: ocrExtraction,
              subscriptionDetailPath: paths.subscriptionDetailPath,
            });

            await updatePipelineStatus(paths.pipelinePath, {
              subscriptionWorkflow: {
                workflowId,
                status: "succeeded",
                queuedAt: subscriptionQueuedAt,
                startedAt: subscriptionStartedAt,
                finishedAt: new Date().toISOString(),
              },
            });
          } catch (error: unknown) {
            await updatePipelineStatus(paths.pipelinePath, {
              subscriptionWorkflow: {
                workflowId,
                status: "failed",
                queuedAt: subscriptionQueuedAt,
                startedAt: subscriptionStartedAt,
                finishedAt: new Date().toISOString(),
                error: serializeError(error),
              },
            });

            throw error;
          }
        })(),
    });

    const subscription = JSON.parse(await readFile(paths.subscriptionDetailPath, "utf8")) as SubscriptionDetail;
    const verificationReport = buildVerificationReport({
      subscription,
      ocrExtraction,
      subscriptionDetailPath: paths.subscriptionDetailPath,
      ocrPayloadPath: paths.ocrPayloadPath,
    });

    await writeFile(paths.verificationReportPath, `${JSON.stringify(verificationReport, null, 2)}\n`, "utf8");

    const updatedCase: StoredCase = {
      ...storedCase,
      createdAt: verificationReport.generatedAt,
      subscription: verificationReport.subscription,
      verification: {
        bestCandidate: verificationReport.bestCandidate,
        topCandidates: verificationReport.topCandidates,
        recommendation: verificationReport.recommendation,
        verificationStrategy: verificationReport.verificationStrategy,
      },
    };

    await writeFile(paths.caseFilePath, `${JSON.stringify(updatedCase, null, 2)}\n`, "utf8");
    return updatedCase;
  } catch (error: unknown) {
    return storedCase;
  }
}
