import express, { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { loadEnv } from "../../src/config/env.js";
import { extractCoupon, type CheckExtraction, type CouponExtraction, type IncomeExtraction } from "../../src/comparison/index.js";
import { parseOcrText } from "../../src/comparison/ocr-parser.js";
import { DEFAULT_TEST_PAYLOAD, type JsonRecord, saveOcrArtifact, sendToPowerAutomate } from "../../src/sharepoint/index.js";
import { processOcrPayload, runBatchWorkflow } from "../../src/worker/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SharePointEnv = {
  POWER_AUTOMATE_WEBHOOK_URL?: string;
};

type CheckRow = {
  field: string;
  expected: string | null;
  actual: string | null;
  status: "match" | "mismatch" | "missing" | "partial";
  weight: number;
  notes?: string;
};

type StoredCase = {
  id: string;
  createdAt: string;
  subscriberClientNumber: string;
  imageLink?: string;
  incomeExtraction?: IncomeExtraction;
  ocrExtraction: {
    productName: string | null;
    subscriberName: string | null;
    subscriberClientNumber: string | null;
    billToNameId: string | null;
    payerName: string | null;
    payerAddress: string | null;
    offerCode: string | null;
    renewalCampaignCode: string | null;
    renewalDate: string | null;
    paymentAmount: number | null;
    copies: string | null;
    options: { raw: string; years: number | null; issues: number | null; amount: number | null }[];
    selectedOption: null | { raw: string; years: number | null; issues: number | null; amount: number | null };
    rawTextPreview: string;
  };
  subscription: {
    clientNumber: string;
    subscriberName: string;
    productName: string;
    billToName: string;
    billToNameId: string;
    renewalName: string;
    totalAmount: number;
    renewalTerm: string;
    term: string;
  };
  verification: {
    bestCandidate: {
      score: number;
      checks: CheckRow[];
    };
    recommendation: string;
  };
};

function getIncomeExtraction(c: StoredCase): IncomeExtraction {
  const coupon = c.incomeExtraction?.coupon ?? (c.ocrExtraction as CouponExtraction);
  const check = c.incomeExtraction?.check ?? {
    file: coupon.file,
    checkNumber: null,
    date: null,
    payTo: null,
    amountNumber: coupon.paymentAmount,
    amountWords: null,
    payerName: coupon.payerName,
    payerAddress: coupon.payerAddress,
    rawTextPreview: coupon.rawTextPreview,
  } satisfies CheckExtraction;

  return {
    coupon,
    check,
  };
}

type Decision = {
  status: "approved" | "flagged";
  decidedAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '<span class="field-value null">—</span>';
  return `<span class="field-value">${esc(String(value))}</span>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fieldRow(label: string, value: string | number | null | undefined): string {
  return `<div class="field-row"><span class="field-label">${esc(label)}</span>${fmt(value)}</div>`;
}

function formatCurrency(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `$${value.toFixed(2)}`;
}

function formatCheckFieldName(field: string): string {
  const labels: Record<string, string> = {
    subscriberClientNumber: "Client number",
    billToNameId: "Bill-to name ID",
    subscriberName: "Subscriber name",
    billToOrRenewalName: "Bill-to or renewal name",
    paymentAmount: "Payment amount",
    renewalDate: "Renewal date",
    productName: "Product name",
    selectedOptionAmount: "Selected option amount",
    selectedOptionTerm: "Selected option term",
    payerAddress: "Payer address",
  };

  return labels[field] ?? field;
}

function getLanUrls(port: number): string[] {
  const interfaces = os.networkInterfaces();
  const lanUrls = new Set<string>();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family !== "IPv4" || address.internal) continue;
      lanUrls.add(`http://${address.address}:${port}/`);
    }
  }

  return Array.from(lanUrls).sort();
}

function statusBadge(status: string): string {
  return `<span class="status-badge ${esc(status)}">${esc(status)}</span>`;
}

function layout(title: string, breadcrumb: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)} — Naviga Review</title>
  <link rel="stylesheet" href="/style.css"/>
  <script src="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js" defer></script>
</head>
<body>
  <header class="site-header">
    <h1>Naviga Review</h1>
    ${breadcrumb}
  </header>
  <div class="container">
    ${body}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

function caseListHtml(rows: { c: StoredCase; decision: Decision | null }[]): string {
  const tableRows = rows.map(({ c, decision }) => {
    const status = decision?.status ?? "pending";
    const score = c.verification.bestCandidate.score;
    return `<tr>
      <td><a href="/cases/${esc(c.id)}">${esc(c.id)}</a></td>
      <td>${esc(new Date(c.createdAt).toLocaleString())}</td>
      <td>${esc(c.subscription.subscriberName)}</td>
      <td>${esc(c.subscription.productName)}</td>
      <td>${score}</td>
      <td>${statusBadge(status)}</td>
    </tr>`;
  }).join("\n");

  const emptyState = rows.length === 0
    ? `<div class="empty-state">No case history found.</div>`
    : "";

  const body = `
    <div class="page-toolbar">
      <h2 class="page-title">Cases</h2>
      <form method="post" action="/cases/clear" onsubmit="return confirm('Delete all case history? This cannot be undone.');">
        <button type="submit" class="btn btn-danger">Clear history</button>
      </form>
    </div>
    ${emptyState}
    ${rows.length > 0 ? `<table class="cases-table">
      <thead>
        <tr>
          <th>Case ID</th><th>Created</th><th>Subscriber</th><th>Product</th><th>Score</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>` : ""}`;

  return layout("Cases", "", body);
}

function decisionFragment(status: "approved" | "flagged"): string {
  return `<span class="decision-status ${esc(status)}">${esc(status.charAt(0).toUpperCase() + status.slice(1))}</span>`;
}

function caseDetailHtml(c: StoredCase, decision: Decision | null): string {
  const income = getIncomeExtraction(c);
  const coupon = income.coupon;
  const check = income.check;
  const sub = c.subscription;
  const checks = c.verification.bestCandidate.checks;
  const score = c.verification.bestCandidate.score;

  const optionsHtml = coupon.options.length
    ? `<ul class="options-list">${coupon.options.map(o => {
        const selected = coupon.selectedOption && (o as unknown as Record<string, unknown>).amount === (coupon.selectedOption as unknown as Record<string, unknown>).amount;
        return `<li class="${selected ? "selected" : ""}">${esc(o.raw)}</li>`;
      }).join("")}</ul>`
    : "";

  const imageHtml = c.imageLink
    ? `<div class="coupon-image-wrap">
        <a href="${esc(c.imageLink)}" target="_blank" rel="noopener">Open coupon image ↗</a>
       </div>`
    : "";

  const couponRawTextHtml = coupon.rawTextPreview
    ? `<details class="raw-text-wrap">
        <summary>Coupon OCR text</summary>
        <pre class="raw-text-content">${esc(coupon.rawTextPreview.replace(/\s*\|\s*/g, "\n"))}</pre>
       </details>`
    : "";

  const checkRawTextHtml = check.rawTextPreview
    ? `<details class="raw-text-wrap">
        <summary>Check OCR text</summary>
        <pre class="raw-text-content">${esc(check.rawTextPreview.replace(/\s*\|\s*/g, "\n"))}</pre>
       </details>`
    : "";

  const checkCol = `
    <div class="column-card">
      <div class="column-header check">Check (OCR)</div>
      <div class="column-body">
        ${fieldRow("Check number", check.checkNumber)}
        ${fieldRow("Date", check.date)}
        ${fieldRow("Pay to", check.payTo)}
        ${fieldRow("Amount", formatCurrency(check.amountNumber))}
        ${fieldRow("Amount in words", check.amountWords)}
        ${fieldRow("Payer name", check.payerName)}
        ${fieldRow("Payer address", check.payerAddress)}
        ${checkRawTextHtml}
      </div>
    </div>`;

  const couponCol = `
    <div class="column-card">
      <div class="column-header coupon">Coupon (OCR)</div>
      <div class="column-body">
        ${fieldRow("Subscriber name", coupon.subscriberName)}
        ${fieldRow("Client number", coupon.subscriberClientNumber)}
        ${fieldRow("Client ID", coupon.billToNameId)}
        ${fieldRow("Client name", coupon.payerName)}
        ${fieldRow("Promo code", coupon.offerCode)}
        ${fieldRow("Campaign code", coupon.renewalCampaignCode)}
        ${fieldRow("Renewal date", coupon.renewalDate)}
        ${fieldRow("Product name", coupon.productName)}
        ${fieldRow("Option chosen", coupon.selectedOption?.raw ?? null)}
        ${fieldRow("Price", formatCurrency(coupon.paymentAmount))}
        ${fieldRow("Copies", coupon.copies)}
        ${optionsHtml ? `<div class="field-row"><span class="field-label">Options</span>${optionsHtml}</div>` : ""}
        ${imageHtml}
        ${couponRawTextHtml}
      </div>
    </div>`;

  // --- Naviga column ---
  const navigaCol = `
    <div class="column-card">
      <div class="column-header naviga">Naviga</div>
      <div class="column-body">
        ${fieldRow("Subscriber name", sub.subscriberName)}
        ${fieldRow("Client number", sub.clientNumber)}
        ${fieldRow("Product", sub.productName)}
        ${fieldRow("Bill-to name", sub.billToName)}
        ${fieldRow("Bill-to name ID", sub.billToNameId)}
        ${fieldRow("Renewal name", sub.renewalName)}
        ${fieldRow("Total amount", formatCurrency(sub.totalAmount))}
        ${fieldRow("Renewal term", `${sub.renewalTerm} issues`)}
        ${fieldRow("Current term", `${sub.term} issues`)}
      </div>
    </div>`;

  // --- Checks column ---
  const checkRows = checks.map(ch => {
    const badge = `<span class="check-badge ${esc(ch.status)}">${esc(ch.status)}</span>`;
    const vals = `<div class="check-values">Naviga: ${esc(String(ch.expected ?? "—"))} / OCR: ${esc(String(ch.actual ?? "—"))}</div>`;
    const notes = ch.notes ? `<div class="check-notes">${esc(ch.notes)}</div>` : "";
    return `<div class="check-row">
      <div>
        <div class="check-field">${esc(formatCheckFieldName(ch.field))}</div>
        ${vals}
        ${notes}
      </div>
      ${badge}
    </div>`;
  }).join("");

  const checksCol = `
    <div class="column-card">
      <div class="column-header checks">Checks</div>
      <div class="column-body">
        <div class="score-bar">
          <span class="score-number">${score}</span>
          <span class="score-label">verification score</span>
        </div>
        ${checkRows}
      </div>
    </div>`;

  // --- Decision bar ---
  const decisionHtml = decision
    ? decisionFragment(decision.status)
    : `<button class="btn btn-approve"
          hx-post="/cases/${esc(c.id)}/decision"
          hx-vals='{"status":"approved"}'
          hx-target="#decision-area"
          hx-swap="innerHTML">Approve</button>
       <button class="btn btn-flag"
          hx-post="/cases/${esc(c.id)}/decision"
          hx-vals='{"status":"flagged"}'
          hx-target="#decision-area"
          hx-swap="innerHTML">Flag</button>`;

  const body = `
    <div class="case-header">
      <div>
        <div class="case-id">${esc(c.id)}</div>
        <div class="case-created">${esc(new Date(c.createdAt).toLocaleString())}</div>
      </div>
      <div class="recommendation-box">${esc(c.verification.recommendation)}</div>
    </div>
    <div class="case-columns">
      ${checkCol}
      ${couponCol}
      ${navigaCol}
      ${checksCol}
    </div>
    <div class="decision-section">
      <span class="decision-label">Decision:</span>
      <div id="decision-area">${decisionHtml}</div>
    </div>`;

  const breadcrumb = `<a href="/">← All cases</a>`;
  return layout(c.id, breadcrumb, body);
}

// ---------------------------------------------------------------------------
// Review router
// ---------------------------------------------------------------------------

function createReviewRouter(rootDir: string): Router {
  const casesDir = path.join(rootDir, "artifacts", "cases");
  const router = Router();

  // GET / — case list
  router.get("/", async (_req: Request, res: Response) => {
    let entries: string[];
    try {
      entries = await fs.readdir(casesDir);
    } catch {
      entries = [];
    }

    const rows = (
      await Promise.all(
        entries.map(async (id) => {
          const caseFile = path.join(casesDir, id, "case.json");
          const decisionFile = path.join(casesDir, id, "decision.json");
          const c = await readJsonOrNull<StoredCase>(caseFile);
          if (!c) return null;
          const decision = await readJsonOrNull<Decision>(decisionFile);
          return { c, decision };
        })
      )
    )
      .filter((r): r is { c: StoredCase; decision: Decision | null } => r !== null)
      .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt));

    res.send(caseListHtml(rows));
  });

  router.post("/cases/clear", async (_req: Request, res: Response) => {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(casesDir);
    } catch {
      entries = [];
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(casesDir, entry);
        await fs.rm(entryPath, { recursive: true, force: true });
      })
    );

    res.redirect(303, "/");
  });

  // GET /cases/:id — case detail
  router.get("/cases/:id", async (req: Request, res: Response) => {
    const id = String(req.params["id"]);
    const caseFile = path.join(casesDir, id, "case.json");
    const decisionFile = path.join(casesDir, id, "decision.json");
    const c = await readJsonOrNull<StoredCase>(caseFile);
    if (!c) {
      res.status(404).send("Case not found");
      return;
    }
    const decision = await readJsonOrNull<Decision>(decisionFile);
    res.send(caseDetailHtml(c, decision));
  });

  // POST /cases/:id/decision — HTMX decision endpoint
  router.post("/cases/:id/decision", async (req: Request, res: Response) => {
    const id = String(req.params["id"]);
    const status = req.body?.status;
    if (status !== "approved" && status !== "flagged") {
      res.status(400).send("Invalid status");
      return;
    }
    const decisionFile = path.join(casesDir, id, "decision.json");
    const decision: Decision = { status, decidedAt: new Date().toISOString() };
    await fs.writeFile(decisionFile, JSON.stringify(decision, null, 2), "utf8");
    res.send(decisionFragment(status));

    if (status === "approved") {
      const caseFile = path.join(casesDir, id, "case.json");
      const storedCase = await readJsonOrNull<{ subscriberClientNumber: string }>(caseFile);
      if (storedCase?.subscriberClientNumber) {
        runBatchWorkflow({ subscriberClientNumber: storedCase.subscriberClientNumber, rootDir })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Batch workflow failed for case ${id}: ${message}`);
          });
      }
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// SharePoint router (existing)
// ---------------------------------------------------------------------------

function createSharePointRouter(env: SharePointEnv = {}): Router {
  const router = Router();

  router.post("/intake", async (request: Request, response: Response) => {
    try {
      const ocrText = typeof request.body?.ocrText === "string" ? request.body.ocrText : "";
      const parsedOcr = ocrText ? parseOcrText(ocrText) : null;
      const { subscriberClientNumber } = parsedOcr ? extractCoupon("", parsedOcr) : { subscriberClientNumber: null };
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const fileEnv = await loadEnv(rootDir);
  const env = {
    ...fileEnv,
    ...process.env,
  };
  const portValue = env.PORT ?? "3001";
  const host = env.HOST ?? "0.0.0.0";
  const port = Number(portValue);

  if (!Number.isFinite(port)) {
    throw new Error(`Invalid PORT "${portValue}"`);
  }

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static("apps/web/public"));
  app.use("/api/sharepoint", createSharePointRouter(env));
  app.use("/", createReviewRouter(rootDir));

  app.listen(port, host, () => {
    console.log(`Web server listening on ${host}:${port}`);
    console.log(`Review UI:        http://localhost:${port}/`);
    console.log(`SharePoint API:   http://localhost:${port}/api/sharepoint`);

    const lanUrls = getLanUrls(port);
    if (lanUrls.length > 0) {
      console.log(`LAN Review UI:    ${lanUrls[0]}`);
      if (lanUrls.length > 1) {
        for (const url of lanUrls.slice(1)) {
          console.log(`LAN Review UI:    ${url}`);
        }
      }
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
