import { config } from './config-registry';
import { renderPage, type CapturedPage } from './tab-renderer';

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

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' ||
           parsed.hostname === '127.0.0.1' ||
           parsed.hostname === '::1' ||
           parsed.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

function extractTitleFromHtml(html: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? '';
}

export async function browserFetch(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<CapturedPage> {
  // For localhost URLs in extension context, try renderPage first
  // The fetch() API can hang when accessing localhost from service worker context
  // in certain environments (e.g., headless Chrome under xvfb). Using tab rendering
  // provides better reliability for localhost URLs in extensions.
  if (!__IS_WEB__ && isLocalhostUrl(url)) {
    try {
      return await renderPage(url, timeoutMs);
    } catch (error) {
      // Fall back to direct fetch if tab rendering fails
      const html = await fetchWithTimeout(url, timeoutMs);
      const title = extractTitleFromHtml(html);
      return { html, title };
    }
  }

  // For non-localhost URLs, use renderPage (tab rendering)
  if (!isLocalhostUrl(url)) {
    return renderPage(url, timeoutMs);
  }

  // For web/non-extension context, use direct fetch for localhost
  const html = await fetchWithTimeout(url, timeoutMs);
  const title = extractTitleFromHtml(html);
  return { html, title };
}
