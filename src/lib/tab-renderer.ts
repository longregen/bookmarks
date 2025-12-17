/**
 * Tab-based page renderer for browser extensions
 * Renders pages fully in background tabs with JavaScript execution before extracting HTML.
 * This captures dynamically-rendered content that simple fetch() would miss.
 *
 * Uses chrome.alarms to keep the service worker alive during long render operations.
 */

import { config } from './config-registry';

const KEEPALIVE_ALARM_NAME = 'tab-renderer-keepalive';

/**
 * Start a keepalive alarm to prevent service worker termination
 * In MV3, service workers can be killed after ~30s of inactivity
 */
async function startKeepalive(): Promise<void> {
  await chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 25 / 60 });
}

async function stopKeepalive(): Promise<void> {
  await chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
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

  await startKeepalive();

  try {
    const tab = await chrome.tabs.create({
      url,
      active: false,
    });

    if (!tab.id) {
      throw new Error('Failed to create tab - no tab ID returned');
    }

    tabId = tab.id;

    await waitForTabLoad(tabId, timeoutMs);

    // 3. Get the final URL (in case of redirects)
    const updatedTab = await chrome.tabs.get(tabId);
    const finalUrl = updatedTab.url || url;

    const settleTimeMs = config.PAGE_SETTLE_TIME_MS || 2000;
    const html = await executeExtraction(tabId, settleTimeMs);

    if (html.length > config.FETCH_MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return html;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await stopKeepalive();

    // 7. Always close the tab, even on errors
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
            resolve(document.documentElement.outerHTML);
          }, settleMs);
        });

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
