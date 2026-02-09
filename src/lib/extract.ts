import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ExtractContentResponse } from './messages';
import { ensureOffscreenDocument, resetOffscreenState } from './offscreen';
import { sleep } from './time';

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

export function extractMarkdownNative(html: string, url: string): ExtractedContent {
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

  const contentDoc = parser.parseFromString(article.content ?? '', 'text/html');
  const markdown = getTurndown().turndown(contentDoc.body);

  return {
    title: article.title ?? '',
    content: markdown,
    excerpt: article.excerpt ?? '',
    byline: article.byline ?? null,
  };
}

const EXTRACT_MAX_RETRIES = 3;
const EXTRACT_INITIAL_DELAY_MS = 100;
const EXTRACT_MAX_DELAY_MS = 1000;
const EXTRACT_TIMEOUT_MS = 30000;

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
  if (__IS_CHROME__) {
    return extractMarkdownViaOffscreen(html, url);
  }
  return extractMarkdownNative(html, url);
}
