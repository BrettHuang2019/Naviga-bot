import express, { Router, type Request, type Response } from "express";
import process from "node:process";
import { loadEnv } from "../../src/config/env.js";
import { extractCoupon } from "../../src/comparison/index.js";
import { DEFAULT_TEST_PAYLOAD, type JsonRecord, saveOcrArtifact, sendToPowerAutomate } from "../../src/sharepoint/index.js";
import { processOcrPayload } from "../../src/worker/index.js";

type SharePointEnv = {
  POWER_AUTOMATE_WEBHOOK_URL?: string;
};

function createSharePointRouter(env: SharePointEnv = {}): Router {
  const router = Router();

  router.post("/intake", async (request: Request, response: Response) => {
    try {
      const ocrText = typeof request.body?.ocrText === "string" ? request.body.ocrText : "";
      const { subscriberClientNumber } = ocrText ? extractCoupon("", ocrText) : { subscriberClientNumber: null };
      const artifactPath = await saveOcrArtifact(request.body, subscriberClientNumber);
      const storedCase = await processOcrPayload(request.body, {
        persistOcrArtifact: false,
      });

      console.log("Received SharePoint OCR intake payload:");
      console.dir(request.body, { depth: null });
      console.log(`Saved OCR artifact to ${artifactPath}`);
      console.log(`Stored case at ${storedCase.paths.caseFile}`);

      response.status(200).json({
        artifactPath,
        case: storedCase,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error("Failed to save SharePoint OCR artifact:");
      console.error(message);

      response.status(500).json({
        error: "Failed to save OCR artifact",
        details: message,
      });
    }
  });

  router.post("/test-power-automate", async (request: Request, response: Response) => {
    const webhookUrl =
      typeof request.body?.webhookUrl === "string" && request.body.webhookUrl.length > 0
        ? request.body.webhookUrl
        : env.POWER_AUTOMATE_WEBHOOK_URL;
    const payload =
      typeof request.body?.payload === "object" && request.body.payload !== null
        ? (request.body.payload as JsonRecord)
        : DEFAULT_TEST_PAYLOAD;

    if (typeof webhookUrl !== "string" || webhookUrl.length === 0) {
      response.status(400).json({
        error: "webhookUrl is required or POWER_AUTOMATE_WEBHOOK_URL must be set",
      });
      return;
    }

    try {
      const result = await sendToPowerAutomate(webhookUrl, payload);

      console.log("Sent payload to Power Automate:");
      console.dir({ webhookUrl, payload, result }, { depth: null });

      response.status(result.ok ? 200 : 502).json({
        webhookUrl,
        payload,
        powerAutomate: result,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error("Failed to send payload to Power Automate:");
      console.error(message);

      response.status(500).json({
        webhookUrl,
        payload,
        error: message,
      });
    }
  });

  return router;
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    ...process.env,
  };
  const portValue = env.PORT ?? "3001";
  const port = Number(portValue);

  if (!Number.isFinite(port)) {
    throw new Error(`Invalid PORT "${portValue}"`);
  }

  const app = express();

  app.use(express.json());
  app.use("/api/sharepoint", createSharePointRouter(env));

  app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
    console.log(`SharePoint routes available at http://localhost:${port}/api/sharepoint`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
