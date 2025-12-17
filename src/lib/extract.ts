import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { ensureOffscreenDocument } from './offscreen';
import type { ExtractContentResponse } from './messages';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string | null;
}

let turndownInstance: TurndownService | null = null;
function getTurndown(): TurndownService {
  turndownInstance ??= new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  return turndownInstance;
}

/**
 * Extract markdown from HTML using native DOMParser
 * Used in contexts where DOMParser is available:
 * - Web builds (browser context)
 * - Firefox builds (Event Pages have DOM access)
 */
function extractMarkdownNative(html: string, url: string): ExtractedContent {
  console.log('[Extract] Using native DOMParser', { url, htmlLength: html.length });

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);

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

async function extractMarkdownViaOffscreen(html: string, url: string): Promise<ExtractedContent> {
  console.log('[Extract] Using offscreen document (Chrome)', { url, htmlLength: html.length });

  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Extract timeout via offscreen document'));
    }, 60000);

    chrome.runtime.sendMessage(
      { type: 'EXTRACT_CONTENT', html, url },
      (response: ExtractContentResponse) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.success && response.result !== undefined) {
          resolve(response.result);
        } else {
          reject(new Error(response.error ?? 'Unknown extraction error'));
        }
      }
    );
  });
}

/**
 * Extract markdown from HTML - async version that works on all platforms
 * Build-time constants ensure only the relevant code path is included in each build:
 * - Web: Uses native DOMParser (always available in browser context)
 * - Firefox: Uses native DOMParser (Event Pages have DOM access)
 * - Chrome: Routes to offscreen document where DOMParser is available
 */
export async function extractMarkdownAsync(html: string, url: string): Promise<ExtractedContent> {
  if (__IS_WEB__ || __IS_FIREFOX__) {
    return extractMarkdownNative(html, url);
  } else {
    return extractMarkdownViaOffscreen(html, url);
  }
}

/** @deprecated Use extractMarkdownAsync instead */
export function extractMarkdown(html: string, url: string): ExtractedContent {
  return extractMarkdownNative(html, url);
}
