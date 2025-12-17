import { config } from './config-registry';

const KEEPALIVE_ALARM_NAME = 'tab-renderer-keepalive';

async function startKeepalive(): Promise<void> {
  await chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 0.5 });
}

async function stopKeepalive(): Promise<void> {
  await chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
}

export async function renderPage(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
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
    const html = await executeExtraction(tabId, settleTimeMs);

    if (html.length > config.FETCH_MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return html;
  } finally {
    await stopKeepalive();

    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (closeError) {
        console.error('Failed to close tab:', closeError);
      }
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

async function executeExtraction(tabId: number, settleTimeMs: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (settleMs: number) => new Promise<string>((resolve) => {
        let timeout: ReturnType<typeof setTimeout>;

        const observer = new MutationObserver(() => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            observer.disconnect();
            resolve(document.documentElement.outerHTML);
          }, settleMs);
        });

        const target = document.body;
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });

        timeout = setTimeout(() => {
          observer.disconnect();
          resolve(document.documentElement.outerHTML);
        }, settleMs);
      }),
    args: [settleTimeMs],
  });

  const result = results[0]?.result;
  if (results.length === 0 || result === undefined || result === '') {
    throw new Error('Failed to extract HTML from page');
  }

  return result;
}
