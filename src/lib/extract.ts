import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { isFirefox, ensureOffscreenDocument } from './offscreen';
import type { ExtractContentResponse } from './messages';

export interface ExtractedContent {
  title: string;
  content: string;      // Markdown
  excerpt: string;
  byline: string | null;
}

/**
 * Get or create a TurndownService instance
 * Lazy initialization to avoid accessing document in service worker contexts
 */
let turndownInstance: TurndownService | null = null;
function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }
  return turndownInstance;
}

/**
 * Extract markdown from HTML using native DOMParser (Firefox only)
 * This is used directly in Firefox service workers where DOMParser is available
 */
function extractMarkdownNative(html: string, url: string): ExtractedContent {
  console.log('[Extract] Using native DOMParser', { url, htmlLength: html.length });

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Set the base URL for relative link resolution
  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);

  // Run Readability
  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    console.error('[Extract] Readability returned null', { url, htmlLength: html.length });
    throw new Error('Readability could not parse the page');
  }

  console.log('[Extract] Readability result', {
    title: article.title,
    contentLength: article.content?.length ?? 0,
  });

  // Convert HTML content to Markdown using lazy-initialized TurndownService
  const contentDoc = parser.parseFromString(article.content ?? '', 'text/html');
  const markdown = getTurndown().turndown(contentDoc.body);

  console.log('[Extract] Markdown conversion complete', { markdownLength: markdown.length });

  return {
    title: article.title ?? '',
    content: markdown,
    excerpt: article.excerpt ?? '',
    byline: article.byline ?? null,
  };
}

/**
 * Extract markdown via Chrome offscreen document
 * Chrome MV3 service workers don't have DOMParser, so we use the offscreen document.
 * This function is only called in Chrome builds; it's tree-shaken from Firefox builds.
 */
async function extractMarkdownViaOffscreen(html: string, url: string): Promise<ExtractedContent> {
  console.log('[Extract] Using offscreen document (Chrome)', { url, htmlLength: html.length });

  // Ensure offscreen document exists before sending message
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Extract timeout via offscreen document'));
    }, 60000); // 60s timeout for extraction

    chrome.runtime.sendMessage(
      { type: 'EXTRACT_CONTENT', html, url },
      (response: ExtractContentResponse) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.success) {
          resolve(response.result!);
        } else {
          reject(new Error(response.error || 'Unknown extraction error'));
        }
      }
    );
  });
}

/**
 * Extract markdown from HTML - async version that works on all platforms
 * Build-time constants ensure only the relevant code path is included in each build:
 * - Web: Uses native DOMParser (always available in browser context)
 * - Firefox: Uses native DOMParser directly in service worker
 * - Chrome: Routes to offscreen document where DOMParser is available
 */
export async function extractMarkdownAsync(html: string, url: string): Promise<ExtractedContent> {
  // Build-time branching: __IS_WEB__ and __IS_FIREFOX__ are replaced with true/false at build time
  // Bundler eliminates the dead code path during minification
  if (__IS_WEB__ || __IS_FIREFOX__) {
    // Web and Firefox have DOMParser available - use it directly
    return extractMarkdownNative(html, url);
  } else {
    // Chrome needs to use offscreen document (no DOMParser in service workers)
    return extractMarkdownViaOffscreen(html, url);
  }
}

/**
 * @deprecated Use extractMarkdownAsync instead
 * Synchronous version - only works in Firefox or contexts with DOMParser
 */
export function extractMarkdown(html: string, url: string): ExtractedContent {
  return extractMarkdownNative(html, url);
}
