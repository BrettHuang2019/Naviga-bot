# Payment Step: Duplicate Check Retry (Telerik RadWindow) - Notes + Lessons Learned

Date: 2026-04-20

## Problem
Workflow `add-subscription-to-batch` runs a payment step inside Naviga. When the check number already exists, Naviga shows a Telerik RadWindow alert like:

`(739): New Cash ID "161" already exists!`

That alert blocks the payment UI, so retries (e.g. `0161`, `00161`) never happen.

## Root Cause
The duplicate-check error is not an inline validation inside the payment form fields. It is a Telerik **RadWindow alert** plus a **modal overlay** (`.TelerikModalOverlay`).

Important details:

1. The alert can be rendered in the **payment page context** (often the `cc_processor1.aspx` page inside the `wCCPayment` iframe), not necessarily the top-level subscription page DOM.
2. The modal overlay intercepts pointer events, so Playwright `locator.click()` can hang waiting for "actionability" (it retries until timeout because another subtree receives pointer events).

Typical DOM (simplified):

```html
<div id="RadWindowWrapper_alert1776703854923" class="RadWindow ...">
  <a class="rwCloseButton" title="Close"><span>Close</span></a>
  ...
  <a onclick="$find('alert1776703854923').close(true);" class="rwPopupButton">
    <span class="rwInnerSpan">OK</span>
  </a>
</div>
<div class="TelerikModalOverlay" ...></div>
```

## What We Changed
All changes are in:

- `src/naviga-workflows/engine.ts`

### 1) Detect the dialog across frames
The dialog is discovered by searching for:

- `div[id^="RadWindowWrapper_alert"]`

but we search across *all* payment-related scopes:

- top-level `page`
- `wCCPayment` iframe (when present)
- any other frames Playwright knows about

This prevents false negatives when the alert lives inside the iframe.

### 2) Dismiss the dialog via JavaScript, not normal clicking
Because the overlay can block pointer events, we avoid relying on Playwright hit-testing.

The dismiss routine does multiple passes and uses multiple strategies:

1. DOM click the close anchor via `evaluate()`:
   - `closeAnchor.click()`
2. Use Telerik client API when available:
   - extract base id (`alert1776703854923`) from wrapper id (`RadWindowWrapper_alert1776703854923`)
   - call `window.$find(baseId)?.close(true)`
3. As a last resort, hide/remove wrapper and remove the overlay:
   - `wrapper.remove()`
   - remove `.TelerikModalOverlay` (and/or disable its pointer events)

This works even when Playwright reports "subtree intercepts pointer events" because we are operating inside the page JS runtime, not trying to click through the overlay.

### 3) Add payment-step logs for debugging
We added small progress logs around the payment step so that when the workflow "stalls", we can see which exact sub-action is waiting (select bank, fill fields, submit, detect duplicate, dismiss dialog).

## Why This Worked
Playwright `click()` is correct for normal UIs, but it intentionally refuses to click elements that are not actionable due to overlays/interception. Telerik RadWindow alerts commonly add an overlay that makes Playwright wait until timeout.

Using `evaluate()` to click and using Telerik’s `$find(...).close(true)` bypasses the actionability checks and directly triggers the control’s intended close behavior.

## Lessons Learned
1. **Always consider cross-frame UI:** a popup "on the page" can actually live in an iframe you are not currently targeting.
2. **If Playwright says pointer events are intercepted, stop fighting it with more selectors.**
   - Use `evaluate()` (DOM click) or the component’s client API (Telerik `$find`) to close.
   - `force: true` is useful but still not as reliable as calling the UI framework API.
3. **DOM snapshots are worth the effort.**
   - Capturing `document.documentElement.outerHTML` for the page + frames makes it obvious where the dialog is, what id pattern it uses, and how to close it.
4. **Prefer dynamic id extraction over hard-coded ids.**
   - Telerik alert ids are generated (e.g. `alert1776703854923`). Always derive them from the wrapper id or DOM.
5. **Log the "last known good step."**
   - For flaky UIs, logs like `Payment: submitting...` vs `Payment: dismissing dialog...` tell you what is actually stuck without needing a debugger.

---

## Debugging Session: 2026-04-20 (Final Fix)

### Initial Symptom
After the first fix was applied, the workflow still hung after closing the error popup. The logs showed:

```
Payment: duplicate check error detected; dismissing dialog...
locator.count: Frame was detached
    at acknowledgeDuplicateCheckError (engine.ts:1009:25)
```

The retry never happened—the workflow just stopped.

### Investigation Findings

**Issue 1: `isVisible()` Hanging on Overlay-Blocked Elements**

The `hasDuplicateCheckError()` function was calling:

```typescript
const isVisible = await alertDialog.isVisible().catch(() => false);
```

Problem: When the Telerik modal overlay is present, Playwright's `isVisible()` performs hit-testing and can wait indefinitely trying to determine if the element is truly visible and actionable. This caused the function to hang before the retry logic could even run.

**Issue 2: Detached Frame After Dialog Close**

After dismissing the RadWindow alert, the payment iframe (`wCCPayment`) reloads or detaches due to Telerik AJAX updates. Subsequent calls to `locator.count()` or `locator.isVisible()` on that frame threw:

```
locator.count: Frame was detached
```

This error was unhandled, causing the retry loop to crash.

### Final Fixes Applied

#### Fix 1: Add Timeout to `isVisible()` Calls

Changed all `isVisible()` calls to use a 2-second timeout:

```typescript
// Before (hangs indefinitely):
const isVisible = await alertDialog.isVisible().catch(() => false);

// After (times out after 2 seconds):
const isVisible = await alertDialog.isVisible({ timeout: 2000 }).catch(() => false);
```

Applied in two places:
- `hasDuplicateCheckError()` — line 868
- `hasDialog()` inside `acknowledgeDuplicateCheckError()` — line 911

#### Fix 2: Wrap Locator Operations in Try-Catch

Added try-catch blocks around all locator operations that might fail due to detached frames:

```typescript
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
```

Similar try-catch blocks were added in:
- The evaluate pass loop
- The fallback force-click section
- Post-dismissal dialog checks

#### Fix 3: Extensive Logging Throughout

Added detailed logs to trace the exact execution path:

**In `acknowledgeDuplicateCheckError()`:**
- Function entry: `"acknowledgeDuplicateCheckError: starting..."`
- Frame detection: `"payment frame found, URL=..."`
- Each pass: `"pass 1/6 starting..."`
- Scope errors: `"scope ${scope.url()} evaluate error: ..."`
- Success/failure: `"dialog dismissed successfully"`
- Fallback actions: `"fallback force-click starting..."`

**In `completeRenewalCheckPayment()`:**
- `hasDuplicateCheckError` return value
- Before/after dialog dismissal
- Before throwing max retries error
- Page stabilization wait

### Verification

After the fixes, the workflow logs show successful retry behavior:

```
Payment: checking for duplicate check error...
Payment: hasDuplicateCheckError returned true
Payment: error detected, exporting DOM snapshot...
Payment: dismissing dialog (attempt 1)...
acknowledgeDuplicateCheckError: starting...
acknowledgeDuplicateCheckError: payment frame found, URL=...
acknowledgeDuplicateCheckError: pass 1/6 starting...
Duplicate check alert: found=1 closed=1 pass=1 scope=...
acknowledgeDuplicateCheckError: dialog dismissed successfully
Payment: acknowledgeDuplicateCheckError completed
Payment: waiting for page to stabilize...
Check number 0161 already exists. Retrying with leading zero.
Payment: attempt 2/4 checkNumber=0161
Payment: selecting deposit bank "Checks CAD - BPC"...
...
Payment submitted with check number 0161.
```

### Updated Lessons Learned

6. **Always add timeouts to Playwright visibility checks.**
   - `locator.isVisible()` can hang when overlays block hit-testing.
   - Use `{ timeout: 2000 }` to bound the wait time.

7. **Handle detached frames gracefully.**
   - After dismissing modals or AJAX updates, iframes may detach/reload.
   - Wrap locator operations in try-catch and skip failed scopes.

8. **Log function entry/exit for async operations.**
   - Knowing that `acknowledgeDuplicateCheckError completed` tells you the function returned vs. threw.
   - This is critical for distinguishing "stuck in function" from "function returned but next step failed."

9. **Log return values of predicate functions.**
   - `console.log(\`hasDuplicateCheckError returned ${hasError}\`)` tells you if detection is working.
   - Without this, you can't tell if the bug is in detection or dismissal.

10. **Expect multiple bugs in sequence.**
    - First bug: dialog not detected (fixed by cross-frame search).
    - Second bug: `isVisible()` hangs (fixed by timeout).
    - Third bug: detached frame crashes retry (fixed by try-catch).
    - Each fix revealed the next bug. Iterative debugging is normal for complex UI automation.

### Summary of Changes

| Function | Change | Purpose |
|----------|--------|---------|
| `hasDuplicateCheckError()` | Added `{ timeout: 2000 }` to `isVisible()` | Prevent hanging on overlay |
| `acknowledgeDuplicateCheckError()` | Added `{ timeout: 2000 }` to `isVisible()` in `hasDialog()` | Same as above |
| `acknowledgeDuplicateCheckError()` | Wrapped locator ops in try-catch | Handle detached frames |
| `acknowledgeDuplicateCheckError()` | Added 15+ log statements | Trace execution flow |
| `completeRenewalCheckPayment()` | Added 8+ log statements | Trace retry loop |

### Files Modified

- `src/naviga-workflows/engine.ts` — Lines 856–1160 (approximately)

### Related Artifacts

When a duplicate check error occurs, the workflow now exports:
- `artifacts/dom/payment-opened-*.json` — Initial payment form state
- `artifacts/dom/payment-error-duplicate-check-*.json` — DOM at error detection time

These snapshots include all frames and are invaluable for debugging future issues.
