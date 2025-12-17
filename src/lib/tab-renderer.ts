/**
 * Tab-based page renderer for browser extensions
 * Renders pages fully in background tabs with JavaScript execution before extracting HTML.
 * This captures dynamically-rendered content that simple fetch() would miss.
 */

import { config } from './config-registry';

interface RenderResult {
  html: string;
  finalUrl: string; // In case of redirects
}

/**
 * Render a page in a background tab and extract the final HTML
 * This approach allows JavaScript to execute and the DOM to fully render
 * before extracting the HTML content.
 *
 * @param url URL to render
 * @param timeoutMs Maximum time to wait for page to load and settle
 * @returns Promise resolving to the rendered HTML
 * @throws Error if tab creation fails, page load times out, or extraction fails
 */
export async function renderPage(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
  let tabId: number | undefined;

  try {
    // 1. Create a background tab (not active/focused)
    const tab = await chrome.tabs.create({
      url,
      active: false, // Open in background
    });

    if (!tab.id) {
      throw new Error('Failed to create tab - no tab ID returned');
    }

    tabId = tab.id;

    // 2. Wait for the tab to complete loading
    await waitForTabLoad(tabId, timeoutMs);

    // 3. Get the final URL (in case of redirects)
    const updatedTab = await chrome.tabs.get(tabId);
    const finalUrl = updatedTab.url || url;

    // 4. Inject the extraction script and get the HTML
    const settleTimeMs = config.PAGE_SETTLE_TIME_MS || 2000;
    const html = await executeExtraction(tabId, settleTimeMs);

    // 5. Validate HTML size
    if (html.length > config.FETCH_MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return html;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    // 6. Always close the tab, even on errors
    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (closeError) {
        console.error('Failed to close tab:', closeError);
      }
    }
  }
}

/**
 * Wait for a tab to finish loading
 * @param tabId Tab ID to monitor
 * @param timeoutMs Maximum time to wait
 */
async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Check if tab is already complete
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        cleanup();
        resolve();
      }
    }).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Execute the extraction script in the tab and get the rendered HTML
 * @param tabId Tab ID to inject script into
 * @param settleTimeMs Time to wait for DOM to settle
 */
async function executeExtraction(tabId: number, settleTimeMs: number): Promise<string> {
  // We need to inject the extraction logic directly as a function
  // chrome.scripting.executeScript runs in an isolated world but can return values
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (settleMs: number) => {
      return new Promise<string>((resolve) => {
        let timeout: ReturnType<typeof setTimeout>;

        const observer = new MutationObserver(() => {
          // Reset timeout on every mutation
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            observer.disconnect();
            // Extract and return the HTML
            resolve(document.documentElement.outerHTML);
          }, settleMs);
        });

        // Observe the entire document for changes
        const target = document.body || document.documentElement;
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });

        // Initial timeout in case page is already settled
        timeout = setTimeout(() => {
          observer.disconnect();
          resolve(document.documentElement.outerHTML);
        }, settleMs);
      });
    },
    args: [settleTimeMs],
  });

  if (!results || results.length === 0 || !results[0].result) {
    throw new Error('Failed to extract HTML from page');
  }

  return results[0].result as string;
}
