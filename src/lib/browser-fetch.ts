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
  // Chrome extensions cannot reliably create tabs for localhost URLs
  // Use fetch() API instead for localhost, which works from service worker context
  if (isLocalhostUrl(url)) {
    const html = await fetchWithTimeout(url, timeoutMs);
    return { html, title: extractTitleFromHtml(html) };
  }

  return renderPage(url, timeoutMs);
}
