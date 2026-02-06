import { config } from './config-registry';
import { renderPage, type CapturedPage } from './tab-renderer';
import { extractTitleFromHtml } from './bulk-import';

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

    const contentLength = response.headers.get('content-length');
    const contentLengthValid = contentLength !== null && contentLength !== '';
    if (contentLengthValid) {
      const bytes = parseInt(contentLength, 10);
      if (bytes > config.FETCH_MAX_HTML_SIZE) {
        throw new Error(`HTML content too large: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    const html = await response.text();

    if (!contentLengthValid && html.length > config.FETCH_MAX_HTML_SIZE) {
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

async function directFetch(url: string, timeoutMs: number): Promise<CapturedPage> {
  const html = await fetchWithTimeout(url, timeoutMs);
  const title = extractTitleFromHtml(html);
  return { html, title };
}

export async function browserFetch(url: string, timeoutMs: number = config.FETCH_TIMEOUT_MS): Promise<CapturedPage> {
  const localhost = isLocalhostUrl(url);

  if (__IS_WEB__) {
    return directFetch(url, timeoutMs);
  }

  if (localhost) {
    try {
      return await renderPage(url, timeoutMs);
    } catch {
      return directFetch(url, timeoutMs);
    }
  }

  return renderPage(url, timeoutMs);
}
