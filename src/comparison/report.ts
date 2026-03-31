import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  extractCoupon,
  summarizeSubscription,
  verifyRenewalCandidates,
  type CouponExtraction,
  type OcrPayload,
  type SubscriptionDetail,
  type VerificationReport,
} from "./index.js";

export type RenewalVerificationPaths = {
  subscriptionDetailPath: string;
  ocrDirectoryPath: string;
  outputPath: string;
};

export function getDefaultRenewalVerificationPaths(rootDir: string): RenewalVerificationPaths {
  return {
    subscriptionDetailPath: path.join(rootDir, "artifacts", "json", "subscription-detail.json"),
    ocrDirectoryPath: path.join(rootDir, "artifacts", "ocr"),
    outputPath: path.join(rootDir, "artifacts", "json", "renewal-verification-report.json"),
  };
}

export async function loadOcrExtractions(ocrDirectoryPath: string): Promise<CouponExtraction[]> {
  const entries = await readdir(ocrDirectoryPath, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(ocrDirectoryPath, entry.name));

  const extractions: CouponExtraction[] = [];

  for (const file of jsonFiles) {
    const payload = JSON.parse(await readFile(file, "utf8")) as OcrPayload;
    const fullText = payload.responsev2?.predictionOutput?.fullText;
    if (!fullText) {
      continue;
    }

    extractions.push(extractCoupon(file, fullText));
  }

  return extractions;
}

export async function generateRenewalVerificationReport(
  paths: RenewalVerificationPaths,
): Promise<VerificationReport> {
  const subscription = JSON.parse(await readFile(paths.subscriptionDetailPath, "utf8")) as SubscriptionDetail;
  const subscriptionSummary = summarizeSubscription(subscription);
  const extractions = await loadOcrExtractions(paths.ocrDirectoryPath);
  const verification = verifyRenewalCandidates(subscriptionSummary, extractions);

  const report: VerificationReport = {
    generatedAt: new Date().toISOString(),
    input: {
      subscriptionDetailPath: paths.subscriptionDetailPath,
      ocrDirectoryPath: paths.ocrDirectoryPath,
    },
    subscription: subscriptionSummary,
    ...verification,
  };

  await writeFile(paths.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return report;
}
