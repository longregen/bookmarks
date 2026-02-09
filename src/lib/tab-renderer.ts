import { config } from './config-registry';
import type { GetPageHtmlResponse } from './messages';
import { sleep } from './time';

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

    const settleTimeMs = config.PAGE_SETTLE_TIME_MS;
    const maxMultiplier = config.PAGE_SETTLE_MAX_MULTIPLIER;
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
  if (__IS_FIREFOX__) {
    return executeExtractionViaMessage(tabId, settleTimeMs);
  }

  // Function must be inline: executeScript serializes it to run in the target tab's isolated context
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (settleMs: number, multiplier: number) => new Promise<{ html: string; title: string }>((resolve) => {
        let settleTimeout: ReturnType<typeof setTimeout>;
        const maxWaitMs = settleMs * multiplier;

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
  if (result?.html === undefined || result.html === '') {
    throw new Error('Failed to extract HTML from page');
  }

  return result;
}

async function executeExtractionViaMessage(tabId: number, settleTimeMs: number): Promise<CapturedPage> {
  await sleep(settleTimeMs);

  const response: GetPageHtmlResponse | undefined = await chrome.tabs.sendMessage(tabId, { type: 'query:current_page_dom' });

  if (response === undefined || !response.success || response.html === undefined || response.html === '') {
    throw new Error(response?.error ?? 'Failed to extract HTML from page via message');
  }

  const tab = await chrome.tabs.get(tabId);
  const title = tab.title ?? '';

  return { html: response.html, title };
}
