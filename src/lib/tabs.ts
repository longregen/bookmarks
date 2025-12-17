function isExtensionUrl(url: string | undefined): boolean {
  if (url === undefined || url === '') return false;
  const extensionUrlPrefix = chrome.runtime.getURL('');
  return url.startsWith(extensionUrlPrefix);
}

function _getExtensionPagePath(url: string): string | null {
  const extensionUrlPrefix = chrome.runtime.getURL('');
  if (!url.startsWith(extensionUrlPrefix)) {
    return null;
  }
  return url.substring(extensionUrlPrefix.length);
}

async function findExtensionTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (isExtensionUrl(tab.url)) {
      return tab;
    }
  }

  return null;
}

export async function openExtensionPage(pagePath: string): Promise<void> {
  const targetUrl = chrome.runtime.getURL(pagePath);
  const existingTab = await findExtensionTab();

  if (existingTab?.id !== undefined) {
    await chrome.tabs.update(existingTab.id, {
      active: true,
      url: targetUrl
    });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- limited support on Firefox Android
    if (existingTab.windowId !== undefined) {
      try {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      // eslint-disable-next-line no-empty -- `chrome.windows` might be available but `.update` not
      } catch { }
    }
  } else {
    await chrome.tabs.create({ url: targetUrl });
  }
}
