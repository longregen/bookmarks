/**
 * Browser-agnostic fetch wrapper for bulk URL import
 * Uses tab-based rendering to capture fully rendered HTML with JavaScript execution
 */

import { config } from './config-registry';
import { renderPage } from './tab-renderer';

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
