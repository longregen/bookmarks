/**
 * Browser-agnostic fetch wrapper for bulk URL import
 * Chrome uses offscreen document, Firefox can fetch directly in service worker
 * Build-time constants ensure only the relevant code path is included in each build.
 */

import { FETCH_TIMEOUT_MS, MAX_HTML_SIZE, OFFSCREEN_MESSAGE_BUFFER_MS } from './constants';

/**
 * Fetch a URL with timeout
 * @param url URL to fetch
 * @param timeoutMs Timeout in milliseconds (default: 30000)
 * @returns HTML content
 */
export async function fetchWithTimeout(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BookmarkRAG/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Limit HTML size to prevent memory issues
    if (html.length > MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return html;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Browser-agnostic fetch that works in both Chrome and Firefox
 * Build-time branching ensures only the relevant implementation is included.
 * @param url URL to fetch
 * @param timeoutMs Timeout in milliseconds
 * @returns HTML content
 */
export async function browserFetch(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<string> {
  if (__IS_FIREFOX__) {
    // Firefox MV3 service workers can fetch directly
    return fetchWithTimeout(url, timeoutMs);
  } else {
    // Chrome needs to use offscreen document
    return fetchViaOffscreen(url, timeoutMs);
  }
}

/**
 * Fetch URL via Chrome offscreen document (Chrome only)
 * This function is only called in Chrome builds; it's tree-shaken from Firefox builds.
 * @param url URL to fetch
 * @param timeoutMs Timeout in milliseconds
 * @returns HTML content
 */
async function fetchViaOffscreen(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fetch timeout via offscreen document'));
    }, timeoutMs + OFFSCREEN_MESSAGE_BUFFER_MS); // Add buffer for message passing

    chrome.runtime.sendMessage(
      {
        type: 'FETCH_URL',
        url,
        timeoutMs,
      },
      (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.success) {
          resolve(response.html);
        } else {
          reject(new Error(response.error || 'Unknown fetch error'));
        }
      }
    );
  });
}
