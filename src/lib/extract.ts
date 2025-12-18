import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
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

// Retry configuration for offscreen extraction
const EXTRACT_MAX_RETRIES = 3;
const EXTRACT_INITIAL_DELAY_MS = 100;
const EXTRACT_MAX_DELAY_MS = 1000;
const EXTRACT_TIMEOUT_MS = 30000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

async function sendExtractMessage(html: string, url: string): Promise<ExtractedContent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Extract timeout via offscreen document'));
    }, EXTRACT_TIMEOUT_MS);

    chrome.runtime.sendMessage(
      { type: 'extract:markdown_from_html', html, url },
      (response: ExtractContentResponse | undefined) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response === undefined) {
          reject(new Error('No response from offscreen document'));
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

async function extractMarkdownViaOffscreen(html: string, url: string): Promise<ExtractedContent> {
  // Chrome-only: dynamically import offscreen module to allow tree-shaking
  const { ensureOffscreenDocument, resetOffscreenState } = await import('./offscreen');

  console.log('[Extract] Using offscreen document (Chrome)', { url, htmlLength: html.length });

  await ensureOffscreenDocument();

  let lastError: Error | null = null;
  let delay = EXTRACT_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= EXTRACT_MAX_RETRIES; attempt++) {
    try {
      return await sendExtractMessage(html, url);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[Extract] Attempt ${attempt}/${EXTRACT_MAX_RETRIES} failed:`, lastError.message);

      if (attempt < EXTRACT_MAX_RETRIES) {
        // Reset offscreen state and try to re-establish connection
        resetOffscreenState();
        await sleep(delay);
        delay = Math.min(delay * 2, EXTRACT_MAX_DELAY_MS);
        await ensureOffscreenDocument();
      }
    }
  }

  throw lastError ?? new Error('Extract failed after retries');
}

export async function extractMarkdownAsync(html: string, url: string): Promise<ExtractedContent> {
  // Use compile-time check to enable dead code elimination
  if (__IS_CHROME__) {
    return extractMarkdownViaOffscreen(html, url);
  }
  return extractMarkdownNative(html, url);
}

/** Synchronous markdown extraction for testing purposes */
export function extractMarkdown(html: string, url: string): ExtractedContent {
  return extractMarkdownNative(html, url);
}
