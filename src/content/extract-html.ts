/**
 * Content script for extracting fully rendered HTML from a page
 * This script is injected into background tabs to wait for the page to settle
 * and extract the final rendered HTML after JavaScript execution.
 */

function waitForSettle(settleTimeMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;

    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, settleTimeMs);
    });

    observer.observe((document.body as Node | null) ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    // Initial timeout in case page is already settled
    timeout = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, settleTimeMs);
  });
}

async function extractHtml(settleTimeMs = 2000): Promise<string> {
  await waitForSettle(settleTimeMs);
  return document.documentElement.outerHTML;
}

// Export for use when this script is injected
// When injected via chrome.scripting.executeScript, we need to return the result
// This will be wrapped in an IIFE by the tab renderer
if (typeof window !== 'undefined') {
  (window as { extractHtml?: typeof extractHtml }).extractHtml = extractHtml;
}
