/**
 * Browser-agnostic fetch wrapper for bulk URL import
 * For extensions: Uses tab-based rendering to capture fully rendered HTML with JavaScript execution
 * Build-time constants ensure only the relevant code path is included in each build.
 */

import { config } from './config-registry';
import { renderPage } from './tab-renderer';
import type { FetchUrlResponse } from './messages';

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

    if (html.length > config.FETCH_MAX_HTML_SIZE) {
      throw new Error(`HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
    }

    return html;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function browserFetch(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
  // Use tab-based rendering to capture dynamically-rendered content that simple fetch() would miss
  return renderPage(url, timeoutMs);
}

/**
 * @deprecated No longer used - service workers can fetch directly with host_permissions
 */
async function _fetchViaOffscreen(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fetch timeout via offscreen document'));
    }, timeoutMs + config.FETCH_OFFSCREEN_BUFFER_MS);

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

        if (response.success && response.html !== undefined) {
          resolve(response.html);
        } else {
          reject(new Error(response.error ?? 'Unknown fetch error'));
        }
      }
    );
  });
}
