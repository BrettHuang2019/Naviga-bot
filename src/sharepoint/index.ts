import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_TEST_PAYLOAD = {
  name: "John",
  email: "john@test.com",
};

export type JsonRecord = Record<string, unknown>;

type PowerAutomateResult = {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
};

function createOcrArtifactFileName(date: Date, clientNumber?: string | null): string {
  const isoTimestamp = date.toISOString().replaceAll(":", "-");
  return clientNumber ? `ocr-${isoTimestamp}_${clientNumber}.json` : `ocr-${isoTimestamp}.json`;
}

export async function saveOcrArtifact(payload: unknown, clientNumber?: string | null): Promise<string> {
  const artifactsDir = path.join(process.cwd(), "artifacts", "ocr");
  const artifactName = createOcrArtifactFileName(new Date(), clientNumber);
  const artifactPath = path.join(artifactsDir, artifactName);

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return artifactPath;
}

export async function sendToPowerAutomate(
  webhookUrl: string,
  payload: JsonRecord,
): Promise<PowerAutomateResult> {
  const upstreamResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return {
    ok: upstreamResponse.ok,
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    bodyText: await upstreamResponse.text(),
  };
}
