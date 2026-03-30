import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FrameLocator, Locator, Page } from "playwright";
import type { PageDefinition, SelectorDefinition, WorkflowDefinition } from "./config.js";
import { resolveEnvReference } from "./config.js";

type WorkflowRuntime = {
  env: Record<string, string>;
  workflows: Map<string, WorkflowDefinition>;
  pages: Map<string, PageDefinition>;
  rootDir: string;
};

const SUBSCRIPTION_DETAIL_FIELDS = {
  summary: [
    "Subscription ID",
    "Subscriber",
    "Delivery Address",
    "Home Delivery",
    "Promotion",
    "Subscription Product",
    "Number of Times Renewed",
    "Status",
    "Cancel Reason",
    "Sub Type",
    "Media Type",
    "Name Class",
    "Delivery Method",
    "Delivery Agent",
    "Delivery Agent Address",
    "Route Number",
    "Channel",
    "Source",
    "Edition",
    "Category",
  ],
  termDetails: [
    "Start Issue",
    "Start Date",
    "Term",
    "Extra Issues",
    "Expire Issue",
    "Expire Date",
    "Extended Expire Date",
    "Copies",
    "Entered Date",
    "Qual. Date",
  ],
  billingInfo: [
    "Bill-To",
    "Bill-To Address",
    "Attention",
    "Series",
    "Deliver Before Paid",
    "Billing Date",
    "Hold Invoice",
    "Hold Invoice Reason",
    "Hold Invoice Date",
    "Do Not Suspend",
    "CC Installment Plan ID",
    "Comments",
  ],
  agentGiftInfo: [
    "Agent/Gift",
    "Bill-To Name ID",
    "Audit Code",
    "Audit Description",
  ],
  otherInfo: [
    "Job Title Code",
    "Job Title",
    "Old Sub ID",
    "Batch",
    "Renewal ID",
    "Installments",
    "Book Order IDs",
    "Audit Unit Key",
    "P.O. Number",
    "Commission Type",
    "Currency",
    "Price Class",
    "Last Payment Date",
    "Last Payment Amount",
    "Check No.",
    "Taxable",
  ],
  pricingDetails: [
    "Price",
    "Total Adjustments",
    "Shipping",
    "Taxe Fed TPS/GST",
    "Taxe Pro TVQ/QST",
    "Total Tax",
    "Total",
    "Balance Due",
    "Commission Amount",
  ],
  renewal: [
    "Renew",
    "Renewal Name",
    "Swap Renewal #",
    "Swap Renewal Name",
    "Swap Renewal Address",
    "Non Renew Reason",
    "Renewal Term",
    "Promo",
    "Series",
    "# Sent",
    "Last Effort",
    "Auto Renew",
    "Bill Me",
    "Payment Method",
    "Card Holder Name",
    "Card on File ID",
    "Card Type",
    "Card No.",
    "Card Expiry",
    "Card Status",
  ],
} as const;

async function exportSubscriptionDetail(
  page: Page,
  rootDir: string,
  env: Record<string, string>,
  outputPath: string,
): Promise<void> {
  const resolvedOutputPath = resolveEnvReference(outputPath, env);
  const destinationPath = path.isAbsolute(resolvedOutputPath)
    ? resolvedOutputPath
    : path.join(rootDir, resolvedOutputPath);

  const subscriptionDetail = await page.evaluate(`
    (() => {
      const fields = ${JSON.stringify(SUBSCRIPTION_DETAIL_FIELDS)};

      const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();

      const readFieldValue = (container) => {
        if (!container) {
          return null;
        }

        const fieldValues = Array.from(container.querySelectorAll("input, textarea, select"))
          .map((field) => {
            if (field instanceof HTMLInputElement) {
              if (["hidden", "button", "submit", "image"].includes(field.type)) {
                return "";
              }

              if (field.type === "checkbox" || field.type === "radio") {
                return field.checked ? "true" : "false";
              }

              return normalize(field.value);
            }

            if (field instanceof HTMLTextAreaElement) {
              return normalize(field.value);
            }

            if (field instanceof HTMLSelectElement) {
              return normalize(field.selectedOptions[0]?.textContent);
            }

            return "";
          })
          .filter((value) => value.length > 0);

        if (fieldValues.length > 0) {
          return fieldValues.join(" | ");
        }

        const clone = container.cloneNode(true);
        if (!(clone instanceof Element)) {
          return null;
        }

        for (const element of clone.querySelectorAll("script, style, ul, button")) {
          element.remove();
        }

        const text = normalize(clone.textContent);
        return text.length > 0 ? text : null;
      };

      const readLabeledValue = (labelText) => {
        const normalizedLabel = labelText.replace(/:$/, "");
        const labels = Array.from(document.querySelectorAll("label"));
        const label = labels.find((candidate) => normalize(candidate.textContent).replace(/:$/, "") === normalizedLabel);
        const row = label?.closest("tr");

        if (row) {
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length > 1) {
            return readFieldValue(cells[1]);
          }
        }

        return null;
      };

      const readHeaderMetadata = () => {
        const titleInputs = Array.from(document.querySelectorAll(".titleInput")).map((element) =>
          normalize(element.textContent),
        );

        return {
          subscriptionPageTitle: normalize(document.title),
          subscriptionIdFromUrl: normalize(window.location.pathname.split("/").filter(Boolean).at(-1)),
          subscriberType: titleInputs[0] ?? null,
          subscriberName: titleInputs[1] ?? null,
          clientNumber: titleInputs[2] ?? null,
        };
      };

      const sections = Object.fromEntries(
        Object.entries(fields).map(([sectionName, labels]) => {
          const entries = labels
            .map((label) => [label, readLabeledValue(label)])
            .filter(([, value]) => value !== null);
          return [sectionName, Object.fromEntries(entries)];
        }),
      );

      return {
        capturedAt: new Date().toISOString(),
        url: window.location.href,
        ...readHeaderMetadata(),
        sections,
      };
    })()
  `);

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, `${JSON.stringify(subscriptionDetail, null, 2)}\n`, "utf8");
  console.log(`Exported subscription detail -> ${destinationPath}`);
}

async function waitForLocatorValue(locator: Locator, expectedValue: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const currentValue = await locator.inputValue();
      if (currentValue === expectedValue) {
        return;
      }
    } catch {
      // Keep polling while the control settles or is briefly detached.
    }

    await locator.page().waitForTimeout(100);
  }

  const actualValue = await locator.inputValue().catch(() => "<unavailable>");
  throw new Error(`Expected input value "${expectedValue}" but found "${actualValue}".`);
}

async function clickLocatorWithExactText(locator: Locator, expectedText: string): Promise<void> {
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const text = (await candidate.textContent())?.replace(/\s+/g, " ").trim();

    if (text === expectedText) {
      await candidate.click();
      return;
    }
  }

  throw new Error(`Could not find an exact text match for "${expectedText}".`);
}

function resolveWorkflowOrder(
  workflowId: string,
  workflows: Map<string, WorkflowDefinition>,
  visiting = new Set<string>(),
  visited = new Set<string>(),
  orderedIds: string[] = [],
): string[] {
  if (visited.has(workflowId)) {
    return orderedIds;
  }

  if (visiting.has(workflowId)) {
    throw new Error(`Circular workflow dependency detected at "${workflowId}"`);
  }

  const workflow = workflows.get(workflowId);
  if (!workflow) {
    throw new Error(`Workflow "${workflowId}" was not found.`);
  }

  visiting.add(workflowId);

  for (const dependencyId of workflow.dependsOn) {
    resolveWorkflowOrder(dependencyId, workflows, visiting, visited, orderedIds);
  }

  visiting.delete(workflowId);
  visited.add(workflowId);
  orderedIds.push(workflowId);

  return orderedIds;
}

function buildLocator(page: Page, selector: SelectorDefinition): Locator {
  let scope: Page | FrameLocator = page;

  if (selector.frameCss) {
    scope = page.frameLocator(selector.frameCss);
  } else if (selector.framePath) {
    scope = selector.framePath.reduce<Page | FrameLocator>(
      (currentScope, frameCss) => currentScope.frameLocator(frameCss),
      page,
    );
  }

  if (selector.css) {
    return scope.locator(selector.css);
  }

  if (selector.text) {
    return scope.getByText(selector.text, { exact: true });
  }

  if (selector.label) {
    return scope.getByLabel(selector.label, { exact: true });
  }

  if (selector.placeholder) {
    return scope.getByPlaceholder(selector.placeholder, { exact: true });
  }

  if (selector.role) {
    return scope.getByRole(selector.role as never, selector.name ? { name: selector.name, exact: true } : {});
  }

  throw new Error("Invalid selector definition.");
}

function resolveTarget(
  target: string,
  activePageId: string | null,
  pages: Map<string, PageDefinition>,
): SelectorDefinition {
  if (!activePageId) {
    throw new Error(`Target "${target}" requires an active page. Add a usePage step first.`);
  }

  const pageDefinition = pages.get(activePageId);
  if (!pageDefinition) {
    throw new Error(`Page "${activePageId}" was not found.`);
  }

  const selector = pageDefinition.selectors[target];
  if (!selector) {
    throw new Error(`Target "${target}" was not found on page "${activePageId}".`);
  }

  return selector;
}

export async function executeWorkflow(
  workflowId: string,
  page: Page,
  runtime: WorkflowRuntime,
  afterNavigation: () => Promise<void>,
): Promise<void> {
  const orderedWorkflowIds = resolveWorkflowOrder(workflowId, runtime.workflows);
  let activePageId: string | null = null;

  for (const orderedWorkflowId of orderedWorkflowIds) {
    const workflow = runtime.workflows.get(orderedWorkflowId);
    if (!workflow) {
      throw new Error(`Workflow "${orderedWorkflowId}" was not found.`);
    }

    console.log(`Running workflow: ${orderedWorkflowId}`);

    for (const step of workflow.steps) {
      if (step.type === "goto") {
        const url = resolveEnvReference(step.url, runtime.env);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await afterNavigation();
        continue;
      }

      if (step.type === "pause") {
        await page.waitForTimeout(step.ms);
        continue;
      }

      if (step.type === "usePage") {
        if (!runtime.pages.has(step.page)) {
          throw new Error(`Page "${step.page}" was not found.`);
        }

        activePageId = step.page;
        continue;
      }

      if (step.type === "waitForUrl") {
        await page.waitForURL((url) => {
          const currentUrl = url.toString();
          const matchesInclude = step.urlIncludes ? currentUrl.includes(step.urlIncludes) : true;
          const matchesExclude = step.urlExcludes ? !currentUrl.includes(step.urlExcludes) : true;
          return matchesInclude && matchesExclude;
        }, { waitUntil: "domcontentloaded" });
        continue;
      }

      if (step.type === "exportSubscriptionDetail") {
        await exportSubscriptionDetail(page, runtime.rootDir, runtime.env, step.outputPath);
        continue;
      }

      const selector = resolveTarget(step.target, activePageId, runtime.pages);
      const locator = buildLocator(page, selector);

      if (step.type === "click") {
        await locator.click();
        continue;
      }

      if (step.type === "clickExactText") {
        const value = resolveEnvReference(step.value, runtime.env);
        await clickLocatorWithExactText(locator, value);
        continue;
      }

      if (step.type === "fill") {
        const value = resolveEnvReference(step.value, runtime.env);
        await locator.fill(value);
        await waitForLocatorValue(locator, value);
        continue;
      }

      if (step.type === "waitFor") {
        await locator.waitFor({ state: "visible" });
      }
    }
  }
}
