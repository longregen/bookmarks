/**
 * Content script for extracting fully rendered HTML from a page
 * This script is injected into background tabs to wait for the page to settle
 * and extract the final rendered HTML after JavaScript execution.
 */

/**
 * Wait for the DOM to settle (no mutations for a specified time)
 * Uses MutationObserver to detect when the page stops changing
 * @param settleTimeMs Time in milliseconds to wait with no changes before considering the page settled
 * @returns Promise that resolves when the page has settled
 */
function waitForSettle(settleTimeMs: number = 2000): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;

    const observer = new MutationObserver(() => {
      // Reset timeout on every mutation
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, settleTimeMs);
    });

    // Observe the entire document for changes
    observer.observe(document.body || document.documentElement, {
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

/**
 * Extract the final rendered HTML after the page has settled
 * This is the main entry point called by the tab renderer
 */
async function extractHtml(settleTimeMs: number = 2000): Promise<string> {
  // Wait for page to settle
  await waitForSettle(settleTimeMs);

  // Extract the full HTML
  return document.documentElement.outerHTML;
}

// Export for use when this script is injected
// When injected via chrome.scripting.executeScript, we need to return the result
// This will be wrapped in an IIFE by the tab renderer
if (typeof window !== 'undefined') {
  (window as any).extractHtml = extractHtml;
}
