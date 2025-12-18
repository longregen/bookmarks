import { config } from './config-registry';
import type { GetPageHtmlResponse } from './messages';

export interface CapturedPage {
  html: string;
  title: string;
}

const KEEPALIVE_ALARM_NAME = 'tab-renderer-keepalive';

async function startKeepalive(): Promise<void> {
  await chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 0.5 });
}

async function stopKeepalive(): Promise<void> {
  await chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

export async function renderPage(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<CapturedPage> {
  let tabId: number | undefined;

  await startKeepalive();

  try {
    const tab = await chrome.tabs.create({
      url,
      active: false,
    });

    if (typeof tab.id !== 'number') {
      throw new Error('Failed to create tab - no tab ID returned');
    }

    tabId = tab.id;

    await waitForTabLoad(tabId, timeoutMs);

    const settleTimeMs = config.PAGE_SETTLE_TIME_MS || 2000;
    const maxMultiplier = config.PAGE_SETTLE_MAX_MULTIPLIER || 3;
    const { html, title } = await executeExtraction(tabId, settleTimeMs, maxMultiplier);

    if (html.length > config.FETCH_MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return { html, title };
  } finally {
    await stopKeepalive();

    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (closeError) {
        console.error('Failed to close tab:', closeError);
      }
    }

    // Add delay between tab operations to prevent browser overload during bulk imports
    const delayMs = config.TAB_CREATION_DELAY_MS;
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const cleanup = (): void => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        cleanup();
        resolve();
      }
    }).catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function executeExtraction(tabId: number, settleTimeMs: number, maxMultiplier: number): Promise<CapturedPage> {
  // Firefox doesn't allow chrome.scripting.executeScript() on programmatically created tabs
  // Use message passing to content script instead
  if (__IS_FIREFOX__) {
    return executeExtractionViaMessage(tabId, settleTimeMs);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (settleMs: number, multiplier: number) => new Promise<{ html: string; title: string }>((resolve) => {
        let settleTimeout: ReturnType<typeof setTimeout>;
        const maxWaitMs = settleMs * multiplier;

        // Hard timeout to prevent hanging on pages with continuous DOM mutations
        const maxTimeout = setTimeout(() => {
          observer.disconnect();
          resolve({
            html: document.documentElement.outerHTML,
            title: document.title
          });
        }, maxWaitMs);

        const observer = new MutationObserver(() => {
          clearTimeout(settleTimeout);
          settleTimeout = setTimeout(() => {
            clearTimeout(maxTimeout);
            observer.disconnect();
            resolve({
              html: document.documentElement.outerHTML,
              title: document.title
            });
          }, settleMs);
        });

        const target = document.body;
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });

        settleTimeout = setTimeout(() => {
          clearTimeout(maxTimeout);
          observer.disconnect();
          resolve({
            html: document.documentElement.outerHTML,
            title: document.title
          });
        }, settleMs);
      }),
    args: [settleTimeMs, maxMultiplier],
  });

  const result = results[0]?.result;
  if (results.length === 0 || result === undefined || result.html === undefined || result.html === '') {
    throw new Error('Failed to extract HTML from page');
  }

  return result;
}

async function executeExtractionViaMessage(tabId: number, settleTimeMs: number): Promise<CapturedPage> {
  // Wait for page to settle before extracting
  await sleep(settleTimeMs);

  const response: GetPageHtmlResponse | undefined = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_HTML' });

  if (response === undefined || !response.success || response.html === undefined || response.html === '') {
    throw new Error(response?.error ?? 'Failed to extract HTML from page via message');
  }

  // Get title from the tab
  const tab = await chrome.tabs.get(tabId);
  const title = tab.title ?? '';

  return { html: response.html, title };
}
