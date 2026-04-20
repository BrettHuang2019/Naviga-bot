import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Frame, FrameLocator, Locator, Page } from "playwright";
import type { PageDefinition, SelectorDefinition, WorkflowDefinition } from "./config.js";
import { resolveEnvReference } from "./config.js";
import {
  assertRenewalValidationPassed,
  buildRenewalValidationRows,
  loadRenewalValidationArtifacts,
  resolveRenewalPaymentInput,
} from "../worker/renewal-validation.js";

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

  const subscriptionDetail = await readSubscriptionDetail(page);

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, `${JSON.stringify(subscriptionDetail, null, 2)}\n`, "utf8");
  console.log(`Exported subscription detail -> ${destinationPath}`);
}

async function readSubscriptionDetail(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(`
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
}

type SubscriptionSummaryExport = {
  capturedAt: unknown;
  url: unknown;
  subscriptionId: unknown;
  subscriber: {
    name: unknown;
    id: unknown;
  };
  deliveryAddress: unknown;
  promotion: unknown;
  termDetails: {
    term: unknown;
  };
  pricingDetails: {
    total: unknown;
  };
};

async function readOrderEntrySubscriptionSummary(page: Page): Promise<Partial<SubscriptionSummaryExport>> {
  return page.evaluate(`
    (() => {
      const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();

      const readClientState = (id) => {
        const raw = document.getElementById(id + "_ClientState")?.getAttribute("value");
        if (!raw) {
          return null;
        }

        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      };

      const readField = (id) => {
        const element = document.getElementById(id);
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const value = normalize(element.value);
          if (value.length > 0) {
            return value;
          }
        }

        const input = document.getElementById(id + "_Input");
        if (input instanceof HTMLInputElement) {
          const value = normalize(input.value);
          if (value.length > 0) {
            return value;
          }
        }

        const state = readClientState(id);
        for (const key of ["validationText", "valueAsString", "lastSetTextBoxValue", "text", "value"]) {
          const value = normalize(state?.[key]);
          if (value.length > 0) {
            return value;
          }
        }

        return null;
      };

      const readMultilineField = (id) => {
        const element = document.getElementById(id);
        if (element instanceof HTMLTextAreaElement) {
          const value = normalize(element.value);
          if (value.length > 0) {
            return value;
          }
        }

        const state = readClientState(id);
        for (const key of ["validationText", "valueAsString", "lastSetTextBoxValue"]) {
          const value = normalize(state?.[key]);
          if (value.length > 0) {
            return value;
          }
        }

        return null;
      };

      const subscriptionId = readField("tSubscriptionID");

      return {
        capturedAt: new Date().toISOString(),
        url: window.location.href,
        subscriptionId: subscriptionId === "New" ? null : subscriptionId,
        subscriber: {
          name: readField("tSubscriberName"),
          id: readField("dSubscriberID"),
        },
        deliveryAddress: readMultilineField("tDeliveryAddress"),
        promotion: readField("dPromoCode"),
        termDetails: {
          term: readField("nTerm") ?? readField("nRenewalTermTime"),
        },
        pricingDetails: {
          total: readField("nTotal") ?? readField("nTotal2"),
        },
      };
    })()
  `) as Promise<Partial<SubscriptionSummaryExport>>;
}

async function exportSubscriptionSummary(
  page: Page,
  rootDir: string,
  env: Record<string, string>,
  outputPath: string,
): Promise<void> {
  const resolvedOutputPath = resolveEnvReference(outputPath, env);
  const destinationPath = path.isAbsolute(resolvedOutputPath)
    ? resolvedOutputPath
    : path.join(rootDir, resolvedOutputPath);

  const detail = await readSubscriptionDetail(page) as {
    capturedAt?: unknown;
    url?: unknown;
    subscriptionIdFromUrl?: unknown;
    subscriberName?: unknown;
    clientNumber?: unknown;
    sections?: {
      summary?: Record<string, unknown>;
      termDetails?: Record<string, unknown>;
      pricingDetails?: Record<string, unknown>;
    };
  };

  const summarySection = detail.sections?.summary ?? {};
  const termDetails = detail.sections?.termDetails ?? {};
  const pricingDetails = detail.sections?.pricingDetails ?? {};
  const subscriberName =
    typeof summarySection.Subscriber === "string" ? summarySection.Subscriber : detail.subscriberName ?? null;
  const rawSubscriptionId =
    typeof summarySection["Subscription ID"] === "string"
      ? summarySection["Subscription ID"]
      : detail.subscriptionIdFromUrl ?? null;
  const subscriptionId =
    typeof rawSubscriptionId === "string" && !rawSubscriptionId.toLowerCase().endsWith(".aspx")
      ? rawSubscriptionId
      : null;
  const orderEntrySummary = await readOrderEntrySubscriptionSummary(page);

  const subscriptionSummary = {
    capturedAt: detail.capturedAt ?? orderEntrySummary.capturedAt ?? null,
    url: detail.url ?? orderEntrySummary.url ?? null,
    subscriptionId: subscriptionId ?? orderEntrySummary.subscriptionId ?? null,
    subscriber: {
      name: subscriberName ?? orderEntrySummary.subscriber?.name ?? null,
      id: detail.clientNumber ?? orderEntrySummary.subscriber?.id ?? null,
    },
    deliveryAddress: summarySection["Delivery Address"] ?? orderEntrySummary.deliveryAddress ?? null,
    promotion: summarySection.Promotion ?? orderEntrySummary.promotion ?? null,
    termDetails: {
      term: termDetails.Term ?? orderEntrySummary.termDetails?.term ?? null,
    },
    pricingDetails: {
      total: pricingDetails.Total ?? orderEntrySummary.pricingDetails?.total ?? null,
    },
  };

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, `${JSON.stringify(subscriptionSummary, null, 2)}\n`, "utf8");
  console.log(`Exported subscription summary -> ${destinationPath}`);
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

async function clickLocatorContainingText(locator: Locator, expectedText: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const text = (await candidate.textContent())?.replace(/\s+/g, " ").trim();

      if (text?.includes(expectedText) && await candidate.isVisible()) {
        await candidate.click();
        return;
      }
    }

    await locator.page().waitForTimeout(100);
  }

  throw new Error(`Could not find a text match containing "${expectedText}".`);
}

async function selectKendoDropDownByText(locator: Locator, expectedText: string): Promise<void> {
  const input = locator.first();
  await input.waitFor({ state: "attached" });

  const inputId = await input.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Target is not a Kendo DropDownList input.");
    }

    if (!element.id) {
      throw new Error("Kendo DropDownList input must have an id.");
    }

    return element.id;
  });

  const page = input.page();
  const inputIdSelector = `[id=${JSON.stringify(inputId)}]`;
  const popupIdSelector = `[id=${JSON.stringify(`${inputId}-list`)}]`;
  const listboxIdSelector = `[id=${JSON.stringify(`${inputId}_listbox`)}]`;
  const dropdown = page.locator(`span.k-dropdown:has(> input${inputIdSelector})`).first();
  await dropdown.waitFor({ state: "visible" });
  await dropdown.locator(".k-dropdown-wrap").first().click();

  const popup = page.locator(`${popupIdSelector}:visible`).first();
  await popup.waitFor({ state: "visible" });

  const options = popup.locator(`${listboxIdSelector} [role="option"], ${listboxIdSelector} .k-item`);
  const optionCount = await options.count();
  const availableOptions: string[] = [];

  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    const optionText = (await option.textContent())?.replace(/\s+/g, " ").trim() ?? "";
    if (optionText.length > 0) {
      availableOptions.push(optionText);
    }

    if (optionText === expectedText) {
      await option.scrollIntoViewIfNeeded();
      await option.click();
      break;
    }
  }

  if (!availableOptions.includes(expectedText)) {
    throw new Error(
      `Could not select Kendo DropDownList option "${expectedText}". Available options: ${availableOptions.join(", ")}`,
    );
  }

  await dropdown.locator(".k-input").first().waitFor({ state: "visible" });
  await page.waitForFunction(
    `({ id, text }) => {
      const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
      const inputElement = document.getElementById(id);
      const dropdownElement = inputElement?.closest("span.k-dropdown");
      return normalize(dropdownElement?.querySelector(".k-input")?.textContent) === text;
    }`,
    { id: inputId, text: expectedText },
  );

  const selectedText = (await dropdown.locator(".k-input").first().textContent())?.replace(/\s+/g, " ").trim() ?? "";

  if (selectedText !== expectedText) {
    throw new Error(`Expected Kendo DropDownList text "${expectedText}" but selected "${selectedText}".`);
  }
}

function resolveArtifactPath(rootDir: string, env: Record<string, string>, filePath: string): string {
  const resolvedPath = resolveEnvReference(filePath, env);
  return path.isAbsolute(resolvedPath) ? resolvedPath : path.join(rootDir, resolvedPath);
}

function getPaymentScopes(page: Page): (Page | Frame)[] {
  return [page, ...page.frames()];
}

async function exportPaymentDomSnapshot(page: Page, rootDir: string, label: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destinationDir = path.join(rootDir, "artifacts", "dom");
  await mkdir(destinationDir, { recursive: true });

  const snapshots = await Promise.all(
    getPaymentScopes(page).map(async (scope, index) => {
      const html = await scope.evaluate("document.documentElement.outerHTML").catch((error: unknown) => {
        return `<!-- DOM snapshot failed: ${error instanceof Error ? error.message : String(error)} -->`;
      });

      return {
        index,
        url: scope.url(),
        html,
      };
    }),
  );

  const destinationPath = path.join(destinationDir, `payment-${label}-${timestamp}.json`);
  await writeFile(destinationPath, JSON.stringify({ snapshots }, null, 2), "utf8");
  console.log(`Exported payment DOM snapshot -> ${destinationPath}`);
}

async function fillFirstAvailablePaymentField(
  page: Page,
  candidateSelectors: string[],
  value: string,
  labelPattern: RegExp,
): Promise<void> {
  // Priority 1: Try the payment iframe first
  const paymentFrame = await getPaymentFrame(page);
  if (paymentFrame) {
    for (const selector of candidateSelectors) {
      const locator = paymentFrame.locator(selector).first();
      if (await locator.count() === 0) {
        continue;
      }

      if (!await locator.isEditable().catch(() => false)) {
        continue;
      }

      await locator.fill(value);
      return;
    }
  }

  // Priority 2: Fallback to all scopes
  for (const scope of getPaymentScopes(page)) {

    const filled = await scope.evaluate(`(() => {
      const labelRegex = new RegExp(${JSON.stringify(labelPattern.source)}, "i");
      const inputValue = ${JSON.stringify(value)};
      const normalize = (text) => (text ?? "").replace(/\\s+/g, " ").trim();
      const setNativeValue = (element) => {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          return false;
        }

        if (element.disabled || element.readOnly || (element instanceof HTMLInputElement && element.type === "hidden")) {
          return false;
        }

        element.value = inputValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));

        const id = element.id.replace(/_Input$/, "");
        const control = window.$find?.(id);
        control?.set_value?.(inputValue);
        return true;
      };

      for (const label of Array.from(document.querySelectorAll("label"))) {
        if (!labelRegex.test(normalize(label.textContent))) {
          continue;
        }

        if (label instanceof HTMLLabelElement && label.htmlFor && setNativeValue(document.getElementById(label.htmlFor))) {
          return true;
        }

        const row = label.closest("tr");
        const field = row?.querySelector("input:not([type=hidden]), textarea") ?? null;
        if (setNativeValue(field)) {
          return true;
        }
      }

      const rows = Array.from(document.querySelectorAll("tr"));
      for (const row of rows) {
        if (!labelRegex.test(normalize(row.textContent))) {
          continue;
        }

        const field = row.querySelector("input:not([type=hidden]), textarea");
        if (setNativeValue(field)) {
          return true;
        }
      }

      return false;
    })()`);

    if (filled) {
      return;
    }
  }

  throw new Error(`Could not find payment field matching ${labelPattern}.`);
}

async function getPaymentFrame(page: Page): Promise<Frame | null> {
  // Wait for the payment iframe to appear and load
  try {
    await page.waitForSelector('iframe[name="wCCPayment"]', { state: "attached", timeout: 10000 });
  } catch {
    return null;
  }

  const paymentFrame = page.frame({ name: "wCCPayment" });
  if (paymentFrame) {
    try {
      await paymentFrame.waitForLoadState("domcontentloaded", { timeout: 10000 });
    } catch {
      return null;
    }
  }
  return paymentFrame;
}

async function selectFirstAvailablePaymentDropdown(page: Page, expectedText: string): Promise<void> {
  // Priority 1: Use Telerik RadComboBox client API inside payment iframe
  const paymentFrame = await getPaymentFrame(page);
  if (paymentFrame) {
    const selected = await paymentFrame.evaluate(
      `(() => {
      const text = ${JSON.stringify(expectedText)};
      const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
      const win = window;
      
      // Try to find the RadComboBox control by ID
      const depositBankControl = win.$find?.("dBankForCheck");
      if (depositBankControl) {
        const items = depositBankControl.get_items();
        if (items) {
          for (let index = 0; index < items.get_count(); index += 1) {
            const item = items.getItem(index);
            const itemText = normalize(item.get_text());
            if (itemText === text || itemText.includes(text)) {
              item.select();
              depositBankControl.set_text(item.get_text());
              depositBankControl.set_value(item.get_value());
              depositBankControl.commitChanges();
              return true;
            }
          }
        }
      }
      
      return false;
    })()`,
    );

    if (selected) {
      await page.waitForTimeout(300);
      return;
    }
  }

  // Priority 2: Use Telerik client API from parent page context
  for (const scope of getPaymentScopes(page)) {
    const selected = await scope.evaluate(
      `(() => {
      const text = ${JSON.stringify(expectedText)};
      const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
      const win = window;
      const clientStateInputs = Array.from(document.querySelectorAll("input[id$='_ClientState']"));
      const baseIds = clientStateInputs.map((input) => input.id.replace(/_ClientState$/, ""));

      for (const id of baseIds) {
        if (!/deposit|bank|account|cash/i.test(id)) {
          continue;
        }

        const control = win.$find?.(id);
        const items = control?.get_items?.();
        if (!items) {
          continue;
        }

        for (let index = 0; index < items.get_count(); index += 1) {
          const item = items.getItem(index);
          if (normalize(item.get_text()) !== text) {
            continue;
          }

          item.select?.();
          control?.set_text?.(item.get_text());
          control?.set_value?.(item.get_value());
          control?.commitChanges?.();
          return true;
        }
      }

      return false;
    })()`,
    );

    if (selected) {
      await page.waitForTimeout(300);
      return;
    }
  }

  // Priority 3: Fallback to DOM interaction (only if client API fails)
  const paymentFrame2 = await getPaymentFrame(page);
  if (paymentFrame2) {
    const dropdown = paymentFrame2.locator("#dBankForCheck_Input").first();
    if (await dropdown.count() > 0) {
      await dropdown.click();
      await dropdown.fill(expectedText);
      await dropdown.press("Enter").catch(() => undefined);
      await page.waitForTimeout(300);
      return;
    }
  }

  // Priority 4: Text-based search in all scopes, but skip readonly/disabled fields
  for (const scope of getPaymentScopes(page)) {
    const candidates = await scope.locator("tr:has-text('Deposit Bank') input[id$='_Input']").all();
    for (const candidate of candidates) {
      const isEditable = await candidate.evaluate((el) => {
        const input = el as HTMLInputElement;
        return !input.readOnly && !input.disabled && !input.hidden;
      });
      if (isEditable) {
        await candidate.click();
        await candidate.fill(expectedText);
        await candidate.press("Enter").catch(() => undefined);
        await page.waitForTimeout(300);
        return;
      }
    }
  }

  throw new Error(`Could not select Deposit Bank value "${expectedText}".`);
}

async function clickPaymentComplete(page: Page): Promise<void> {
  // Priority 1: Try the payment iframe first
  const paymentFrame = await getPaymentFrame(page);
  if (paymentFrame) {
    for (const selector of [
      "#bApplyPaymentNow",
      "#bApplyPaymentNow_input",
      "input[value='Process Payment Now' i]",
      "button:has-text('Process Payment Now')",
      "a:has-text('Process Payment Now')",
      "input[value='Submit' i]",
      "button:has-text('Submit')",
      "a:has-text('Submit')",
    ]) {
      const locator = paymentFrame.locator(selector).first();
      if (await locator.count() === 0) {
        continue;
      }

      if (await locator.isVisible()) {
        await locator.click();
        return;
      }
    }
  }

  // Priority 2: Fallback to all scopes
  for (const scope of getPaymentScopes(page)) {
    for (const selector of [
      "#bApplyPaymentNow",
      "input[value='Process Payment Now' i]",
      "button:has-text('Process Payment Now')",
      "a:has-text('Process Payment Now')",
      "input[value='Submit' i]",
      "button:has-text('Submit')",
      "a:has-text('Submit')",
    ]) {
      const locator = scope.locator(selector).first();
      if (await locator.count() === 0) {
        continue;
      }

      if (await locator.isVisible()) {
        await locator.click();
        return;
      }
    }
  }

  throw new Error("Could not find Process Payment Now button.");
}

async function hasDuplicateCheckError(page: Page): Promise<boolean> {
  await page.waitForTimeout(1500);

  // Check for Telerik RadWindow alert dialog (may live in payment iframe).
  for (const scope of getPaymentScopes(page)) {
    const alertDialog = scope.locator('div[id^="RadWindowWrapper_alert"]').first();
    if (await alertDialog.count() === 0) {
      continue;
    }

    // Use a timeout to avoid hanging on visibility check when overlay blocks hit-testing
    const isVisible = await alertDialog.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      return true;
    }
  }
  
  for (const scope of getPaymentScopes(page)) {
    // Check for Telerik alert dialog with Cash ID duplicate message
    const dialogLocator = scope.locator('[id*="_message"]').filter({ hasText: /Cash ID.*already exists|New Cash ID.*already exists/i });
    if (await dialogLocator.count() > 0) {
      return true;
    }

    // Fallback: check for inline duplicate check text
    const duplicate = await scope.evaluate(`(() => {
      const text = document.body?.innerText ?? "";
      return /check\s*(no\.?|number).*(exist|duplicate|already)|duplicate.*check/i.test(text);
    })()`);

    if (duplicate) {
      return true;
    }
  }

  return false;
}

async function acknowledgeDuplicateCheckError(page: Page): Promise<void> {
  console.log("acknowledgeDuplicateCheckError: starting...");
  const paymentFrame = await getPaymentFrame(page);
  const orderedScopes: (Page | Frame)[] = [];
  if (paymentFrame) {
    orderedScopes.push(paymentFrame);
    console.log(`acknowledgeDuplicateCheckError: payment frame found, URL=${paymentFrame.url()}`);
  }
  orderedScopes.push(page);
  for (const frame of page.frames()) {
    if (!orderedScopes.includes(frame)) {
      orderedScopes.push(frame);
      console.log(`acknowledgeDuplicateCheckError: additional frame found, URL=${frame.url()}`);
    }
  }

  const hasDialog = async (): Promise<boolean> => {
    for (const scope of orderedScopes) {
      try {
        const wrapper = scope.locator('div[id^="RadWindowWrapper_alert"]').first();
        const count = await wrapper.count();
        if (count > 0) {
          const visible = await wrapper.isVisible({ timeout: 2000 }).catch(() => false);
          if (visible) {
            console.log(`hasDialog: found visible dialog in scope ${scope.url()}`);
            return true;
          }
        }
      } catch (err) {
        // Frame may be detached, skip this scope
        console.log(`hasDialog: scope ${scope.url()} error: ${(err as Error).message}`);
      }
    }
    return false;
  };

  // If called defensively (no dialog), return silently.
  if (!await hasDialog()) {
    console.log("acknowledgeDuplicateCheckError: no dialog found initially, checking for message text...");
    const hasMessage = await Promise.any(
      orderedScopes.map((scope) => scope.evaluate(() => {
        const text = document.body?.innerText ?? "";
        return /New\s+Cash\s+ID.*already\s+exists|Cash\s+ID.*already\s+exists/i.test(text);
      }).catch(() => false)),
    ).catch(() => false);

    if (!hasMessage) {
      console.log("acknowledgeDuplicateCheckError: no dialog or message found, returning silently");
      return;
    }
    console.log("acknowledgeDuplicateCheckError: message text found, proceeding with cleanup");
  }

  // Try multiple passes: close via DOM click (bypasses hit-testing), Telerik client API, and overlay cleanup.
  for (let pass = 0; pass < 6; pass += 1) {
    console.log(`acknowledgeDuplicateCheckError: pass ${pass + 1}/6 starting...`);
    let touched = false;

    for (const scope of orderedScopes) {
      const scopeUrl = scope.url();
      try {
        const result = await scope.evaluate(() => {
          const wrappers = Array.from(document.querySelectorAll('div[id^="RadWindowWrapper_alert"]'));
          if (wrappers.length === 0) {
            return { found: 0, closed: 0 };
          }

          const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
          const isDuplicate = (text: string) => /New\s+Cash\s+ID.*already\s+exists|Cash\s+ID.*already\s+exists/i.test(text);

          let closed = 0;
          for (const wrapper of wrappers) {
            const wrapperText = normalize(wrapper.textContent);
            // Avoid closing unrelated alerts when possible.
            if (wrapperText && !isDuplicate(wrapperText)) {
              continue;
            }

            const baseId = wrapper.id.replace(/^RadWindowWrapper_/, "");

            // 1) DOM-level close click (does not care about modal overlays)
            const closeAnchor = wrapper.querySelector('a.rwCloseButton, a[title="Close"], .rwControlButtons a');
            if (closeAnchor && closeAnchor instanceof HTMLElement) {
              closeAnchor.click();
              closed += 1;
              continue;
            }

            // 2) Telerik client API close
            const find = (window as unknown as { $find?: (id: string) => unknown }).$find;
            const win = find ? find(baseId) : null;
            if (win && typeof (win as { close?: (arg?: unknown) => void }).close === "function") {
              (win as { close: (arg?: unknown) => void }).close(true);
              closed += 1;
              continue;
            }

            // 3) Last resort: hide/remove wrapper + overlay so retries can proceed.
            (wrapper as HTMLElement).style.display = "none";
            (wrapper as HTMLElement).style.visibility = "hidden";
            wrapper.remove();
            closed += 1;
          }

          const overlays = Array.from(document.querySelectorAll('.TelerikModalOverlay'));
          for (const overlay of overlays) {
            const z = Number.parseInt(getComputedStyle(overlay).zIndex || "0", 10);
            if (Number.isFinite(z) && z >= 2500) {
              (overlay as HTMLElement).style.pointerEvents = "none";
              overlay.remove();
            }
          }

          return { found: wrappers.length, closed };
        }).catch(() => ({ found: 0, closed: 0 }));

        if (result.found > 0) {
          touched = true;
          console.log(`Duplicate check alert: found=${result.found} closed=${result.closed} pass=${pass + 1} scope=${scopeUrl}`);
        }
      } catch (err) {
        console.log(`acknowledgeDuplicateCheckError: scope ${scope.url()} evaluate error: ${(err as Error).message}`);
      }
    }

    // Give Telerik time to unwind overlay + ajax.
    await page.waitForTimeout(touched ? 500 : 250);

    try {
      if (!await hasDialog()) {
        console.log("acknowledgeDuplicateCheckError: dialog dismissed successfully");
        return;
      }
    } catch (err) {
      console.log(`acknowledgeDuplicateCheckError: hasDialog check failed: ${(err as Error).message}`);
    }

    // As a fallback, force-click the close button in whichever scope still has the wrapper.
    console.log("acknowledgeDuplicateCheckError: fallback force-click starting...");
    for (const scope of orderedScopes) {
      try {
        const wrapper = scope.locator('div[id^="RadWindowWrapper_alert"]').first();
        const count = await wrapper.count();
        if (count === 0) {
          continue;
        }

        const closeButton = wrapper.locator('a.rwCloseButton, a[title=\"Close\"], .rwControlButtons a').first();
        if (await closeButton.count() > 0) {
          await closeButton.click({ force: true }).catch(() => undefined);
          console.log(`acknowledgeDuplicateCheckError: force-clicked close button in ${scope.url()}`);
        }
      } catch (err) {
        console.log(`acknowledgeDuplicateCheckError: fallback scope ${scope.url()} error: ${(err as Error).message}`);
      }
    }

    await page.waitForTimeout(500);
    try {
      if (!await hasDialog()) {
        console.log("acknowledgeDuplicateCheckError: dialog dismissed after fallback");
        return;
      }
    } catch (err) {
      console.log(`acknowledgeDuplicateCheckError: post-fallback hasDialog check failed: ${(err as Error).message}`);
    }
  }

  throw new Error("Could not dismiss duplicate check error dialog.");
}

async function waitForPaymentForm(page: Page): Promise<void> {
  await page.waitForFunction(`(() => {
    const loadingPanels = Array.from(document.querySelectorAll(".RadAjax"));
    return loadingPanels.every((panel) => {
      const style = window.getComputedStyle(panel);
      return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
    });
  })()`, null, { timeout: 30000 }).catch(() => undefined);

  await page.waitForFunction(`(() => {
    const text = document.body?.innerText ?? "";
    const hasVisiblePaymentText = /Deposit\s+Bank|Check\s+Amount|Process\s+Payment\s+Now/i.test(text);
    const hasPaymentWindow = Boolean(document.querySelector("#wCCPayment, #wCCPayment_C, iframe[id*='wCCPayment'], iframe[name*='wCCPayment']"));
    return hasVisiblePaymentText || hasPaymentWindow;
  })()`, null, { timeout: 30000 });

  await page.waitForTimeout(1000);
}

async function completeRenewalCheckPayment(
  page: Page,
  rootDir: string,
  input: { checkNumber: string; amount: string },
  options: { depositBank: string; duplicateCheckRetries: number },
): Promise<void> {
  console.log("Payment: opening payment form...");
  await page.locator("#bApplyPayment, #bApplyPayment_input").first().click();
  await waitForPaymentForm(page);
  await exportPaymentDomSnapshot(page, rootDir, "opened");

  for (let attempt = 0; attempt <= options.duplicateCheckRetries; attempt += 1) {
    const checkNumber = `${"0".repeat(attempt)}${input.checkNumber}`;
    console.log(`Payment: attempt ${attempt + 1}/${options.duplicateCheckRetries + 1} checkNumber=${checkNumber}`);

    // Add pause before filling payment details
    await page.waitForTimeout(500);

    console.log(`Payment: selecting deposit bank "${options.depositBank}"...`);
    await selectFirstAvailablePaymentDropdown(page, options.depositBank);

    // Pause after selecting deposit bank
    await page.waitForTimeout(300);

    console.log("Payment: filling check number...");
    await fillFirstAvailablePaymentField(page, ["#tCheckNo", "#tCheckNo_Input", "input[name='tCheckNo']"], checkNumber, /payment\s*\/\s*check\s*no|check\s*no/i);

    // Pause after filling check number
    await page.waitForTimeout(300);

    console.log("Payment: filling check amount...");
    await fillFirstAvailablePaymentField(
      page,
      ["#nCheckAmount", "#nCheckAmount_Input", "input[name='nCheckAmount']", "#CheckAmount", "#CheckAmount_Input", "input[name='CheckAmount']"],
      input.amount,
      /check\s*amount/i,
    );

    // Pause after filling amount before clicking submit
    await page.waitForTimeout(500);

    console.log("Payment: submitting...");
    await clickPaymentComplete(page);

    console.log("Payment: checking for duplicate check error...");
    const hasError = await hasDuplicateCheckError(page);
    console.log(`Payment: hasDuplicateCheckError returned ${hasError}`);
    if (!hasError) {
      console.log(`Payment submitted with check number ${checkNumber}.`);
      return;
    }

    // Export DOM snapshot when duplicate check error is detected
    console.log(`Payment: error detected, exporting DOM snapshot...`);
    await exportPaymentDomSnapshot(page, rootDir, "error-duplicate-check");

    // Dismiss the error dialog before retrying
    console.log(`Payment: dismissing dialog (attempt ${attempt + 1})...`);
    await acknowledgeDuplicateCheckError(page);
    console.log(`Payment: acknowledgeDuplicateCheckError completed`);

    // Pause after dismissing dialog before retry
    console.log(`Payment: waiting for page to stabilize...`);
    await page.waitForTimeout(500);

    if (attempt === options.duplicateCheckRetries) {
      console.log(`Payment: max retries reached, throwing error`);
      throw new Error(`Check number already exists after ${options.duplicateCheckRetries + 1} attempts.`);
    }

    console.log(`Check number ${checkNumber} already exists. Retrying with leading zero.`);
  }
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
  const logSteps = runtime.env.WORKFLOW_LOG_STEPS === "1" || runtime.env.WORKFLOW_LOG_STEPS === "true";

  type WorkflowStep = WorkflowDefinition["steps"][number];

  const describeEnvValue = (value: string): string => {
    if (value.startsWith("env:")) {
      return `env:${value.slice("env:".length).trim()}`;
    }

    return "<literal>";
  };

  const describeStep = (step: WorkflowStep): string => {
    switch (step.type) {
      case "goto":
        return `goto url=${describeEnvValue(step.url)}`;
      case "pause":
        return `pause ms=${step.ms}`;
      case "usePage":
        return `usePage page=${step.page}`;
      case "waitForUrl":
        return `waitForUrl includes=${step.urlIncludes ?? "<none>"} excludes=${step.urlExcludes ?? "<none>"}`;
      case "exportSubscriptionDetail":
        return `exportSubscriptionDetail outputPath=${describeEnvValue(step.outputPath)}`;
      case "exportSubscriptionSummary":
        return `exportSubscriptionSummary outputPath=${describeEnvValue(step.outputPath)}`;
      case "validateRenewalArtifacts":
        return `validateRenewalArtifacts couponExtractPath=${describeEnvValue(step.couponExtractPath)} subscriptionSummaryPath=${describeEnvValue(step.subscriptionSummaryPath)}`;
      case "completeRenewalCheckPayment":
        return `completeRenewalCheckPayment couponExtractPath=${describeEnvValue(step.couponExtractPath)} subscriptionSummaryPath=${describeEnvValue(step.subscriptionSummaryPath)} duplicateCheckRetries=${step.duplicateCheckRetries}`;
      case "click":
        return `click page=${activePageId ?? "<none>"} target=${step.target}`;
      case "clickExactText":
        return `clickExactText page=${activePageId ?? "<none>"} target=${step.target} value=${describeEnvValue(step.value)}`;
      case "clickContainingText":
        return `clickContainingText page=${activePageId ?? "<none>"} target=${step.target} value=${describeEnvValue(step.value)}`;
      case "fill":
        return `fill page=${activePageId ?? "<none>"} target=${step.target} value=${describeEnvValue(step.value)}`;
      case "type":
        return `type page=${activePageId ?? "<none>"} target=${step.target} value=${describeEnvValue(step.value)} delayMs=${step.delayMs}`;
      case "selectKendoDropDown":
        return `selectKendoDropDown page=${activePageId ?? "<none>"} target=${step.target} value=${describeEnvValue(step.value)}`;
      case "waitFor":
        return `waitFor page=${activePageId ?? "<none>"} target=${step.target}`;
      default: {
        const exhaustive: never = step;
        return JSON.stringify(exhaustive);
      }
    }
  };

  for (const orderedWorkflowId of orderedWorkflowIds) {
    const workflow = runtime.workflows.get(orderedWorkflowId);
    if (!workflow) {
      throw new Error(`Workflow "${orderedWorkflowId}" was not found.`);
    }

    console.log(`Running workflow: ${orderedWorkflowId}`);

    for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex += 1) {
      const step = workflow.steps[stepIndex];

      if (logSteps) {
        console.log(`[${orderedWorkflowId}] step ${stepIndex + 1}/${workflow.steps.length}: ${describeStep(step)}`);
      }

      try {
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

        if (step.type === "exportSubscriptionSummary") {
          await exportSubscriptionSummary(page, runtime.rootDir, runtime.env, step.outputPath);
          continue;
        }

        if (step.type === "validateRenewalArtifacts") {
          const artifacts = await loadRenewalValidationArtifacts({
            couponExtractPath: resolveArtifactPath(runtime.rootDir, runtime.env, step.couponExtractPath),
            checkExtractPath: step.checkExtractPath
              ? resolveArtifactPath(runtime.rootDir, runtime.env, step.checkExtractPath)
              : undefined,
            navigaSummaryPath: resolveArtifactPath(runtime.rootDir, runtime.env, step.subscriptionSummaryPath),
          });
          const rows = buildRenewalValidationRows(artifacts);
          for (const row of rows) {
            console.log(`Validation ${row.status}: ${row.label} - ${row.message}`);
          }
          assertRenewalValidationPassed(rows);
          continue;
        }

        if (step.type === "completeRenewalCheckPayment") {
          const artifacts = await loadRenewalValidationArtifacts({
            couponExtractPath: resolveArtifactPath(runtime.rootDir, runtime.env, step.couponExtractPath),
            checkExtractPath: step.checkExtractPath
              ? resolveArtifactPath(runtime.rootDir, runtime.env, step.checkExtractPath)
              : undefined,
            navigaSummaryPath: resolveArtifactPath(runtime.rootDir, runtime.env, step.subscriptionSummaryPath),
          });
          const paymentInput = resolveRenewalPaymentInput(artifacts);
          await completeRenewalCheckPayment(page, runtime.rootDir, paymentInput, {
            depositBank: step.depositBank,
            duplicateCheckRetries: step.duplicateCheckRetries,
          });
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

        if (step.type === "clickContainingText") {
          const value = resolveEnvReference(step.value, runtime.env);
          await clickLocatorContainingText(locator, value);
          continue;
        }

        if (step.type === "fill") {
          const value = resolveEnvReference(step.value, runtime.env);
          await locator.fill(value);
          await waitForLocatorValue(locator, value);
          continue;
        }

        if (step.type === "type") {
          const value = resolveEnvReference(step.value, runtime.env);
          await locator.fill("");
          await locator.pressSequentially(value, { delay: step.delayMs });
          await waitForLocatorValue(locator, value);
          continue;
        }

        if (step.type === "selectKendoDropDown") {
          const value = resolveEnvReference(step.value, runtime.env);
          await selectKendoDropDownByText(locator, value);
          continue;
        }

        if (step.type === "waitFor") {
          await locator.first().waitFor({ state: "visible" });
          continue;
        }

        const exhaustive: never = step;
        throw new Error(`Unsupported workflow step: ${JSON.stringify(exhaustive)}`);
      } catch (error: unknown) {
        const rootMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Workflow "${orderedWorkflowId}" failed at step ${stepIndex + 1}/${workflow.steps.length}: ${describeStep(step)}\n${rootMessage}`,
          { cause: error },
        );
      }
    }
  }
}
