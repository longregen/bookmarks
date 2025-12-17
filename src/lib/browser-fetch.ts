/**
 * Browser-agnostic fetch wrapper for bulk URL import
 * All extension platforms (Chrome, Firefox) can fetch directly with host_permissions
 * Build-time constants ensure only the relevant code path is included in each build.
 */

import { config } from './config-registry';
import type { FetchUrlResponse } from './messages';

/**
 * Fetch a URL with timeout
 * @param url URL to fetch
 * @param timeoutMs Timeout in milliseconds
 * @returns HTML content
 */
export async function fetchWithTimeout(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
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

    // Limit HTML size
    if (html.length > config.FETCH_MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return html;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Browser-agnostic fetch that works in Chrome, Firefox, and web contexts
 * Build-time branching ensures only the relevant implementation is included.
 * @param url URL to fetch
 * @param timeoutMs Timeout in milliseconds
 * @returns HTML content
 */
export async function browserFetch(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
  // All platforms with extension permissions can fetch directly
  // Chrome service workers have host_permissions: <all_urls>
  // Firefox service workers can fetch directly
  // Web is handled separately (CORS proxy or disabled)
  return fetchWithTimeout(url, timeoutMs);
}

/**
 * Fetch URL via Chrome offscreen document (Chrome only)
 * @deprecated No longer used - service workers can fetch directly with host_permissions
 * Kept for backwards compatibility; may be removed in future versions.
 * @param url URL to fetch
 * @param timeoutMs Timeout in milliseconds
 * @returns HTML content
 */
async function fetchViaOffscreen(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fetch timeout via offscreen document'));
    }, timeoutMs + config.FETCH_OFFSCREEN_BUFFER_MS); // Add buffer for message passing

    chrome.runtime.sendMessage(
      {
        type: 'FETCH_URL',
        url,
        timeoutMs,
      },
      (response: FetchUrlResponse) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.success) {
          resolve(response.html!);
        } else {
          reject(new Error(response.error || 'Unknown fetch error'));
        }
      }
    );
  });
}
