/**
 * Tab navigation utilities for the extension.
 * Handles finding or creating extension tabs, ensuring only one tab per extension page.
 */

/**
 * Checks if a URL belongs to this extension
 */
function isExtensionUrl(url: string | undefined): boolean {
  if (!url) return false;
  const extensionUrlPrefix = chrome.runtime.getURL('');
  return url.startsWith(extensionUrlPrefix);
}

/**
 * Extracts the page path from an extension URL
 * e.g., "chrome-extension://abc123/src/library/library.html" -> "src/library/library.html"
 */
function getExtensionPagePath(url: string): string | null {
  const extensionUrlPrefix = chrome.runtime.getURL('');
  if (!url.startsWith(extensionUrlPrefix)) {
    return null;
  }
  return url.substring(extensionUrlPrefix.length);
}

/**
 * Finds an existing tab for any extension page.
 * Returns the tab if found, null otherwise.
 */
async function findExtensionTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (isExtensionUrl(tab.url)) {
      return tab;
    }
  }

  return null;
}

/**
 * Opens an extension page. If an extension tab already exists, it will be focused
 * and navigated to the target page. Otherwise, a new tab will be created.
 *
 * @param pagePath - The relative path to the extension page (e.g., 'src/library/library.html')
 */
export async function openExtensionPage(pagePath: string): Promise<void> {
  const targetUrl = chrome.runtime.getURL(pagePath);
  const existingTab = await findExtensionTab();

  if (existingTab && existingTab.id !== undefined) {
    // Tab exists - focus it and navigate to the target page
    await chrome.tabs.update(existingTab.id, {
      active: true,
      url: targetUrl
    });

    // Also bring the window to the front
    if (existingTab.windowId !== undefined) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    // No extension tab exists - create a new one
    await chrome.tabs.create({ url: targetUrl });
  }
}
