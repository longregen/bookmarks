/**
 * Offscreen document for Chrome extension
 * Handles URL fetching and DOM parsing since service workers can't use DOMParser in Chrome MV3
 */

import { fetchWithTimeout } from '../lib/browser-fetch';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ExtractedContent } from '../lib/extract';
import { getErrorMessage } from '../lib/errors';

console.log('Offscreen document loaded');

let turndownInstance: TurndownService | null = null;
function getTurndown(): TurndownService {
  turndownInstance ??= new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  return turndownInstance;
}

function extractMarkdownInOffscreen(html: string, url: string): ExtractedContent {
  console.log('[Offscreen] Extracting markdown', {
    url,
    htmlLength: html.length,
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);

  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    console.error('[Offscreen] Readability returned null', {
      url,
      htmlLength: html.length,
    });
    throw new Error('Readability could not parse the page');
  }

  console.log('[Offscreen] Readability result', {
    title: article.title,
    contentLength: article.content?.length ?? 0,
  });

  const contentDoc = parser.parseFromString(article.content ?? '', 'text/html');
  const markdown = getTurndown().turndown(contentDoc.body);

  console.log('[Offscreen] Markdown conversion complete', {
    markdownLength: markdown.length,
  });

  return {
    title: article.title ?? '',
    content: markdown,
    excerpt: article.excerpt ?? '',
    byline: article.byline ?? null,
  };
}

chrome.runtime.onMessage.addListener((message: { type: string; url?: string; timeoutMs?: number; html?: string }, sender, sendResponse) => {
  // DEPRECATED: FETCH_URL is no longer used - service workers can fetch directly
  // Kept for backwards compatibility; may be removed in future versions
  if (message.type === 'FETCH_URL') {
    const { url, timeoutMs } = message;

    if (!url) {
      sendResponse({ success: false, error: 'URL is required' });
      return true;
    }

    fetchWithTimeout(url, timeoutMs ?? 30000)
      .then(html => {
        sendResponse({ success: true, html });
      })
      .catch((error: unknown) => {
        sendResponse({
          success: false,
          error: getErrorMessage(error),
        });
      });

    return true; // Keep message channel open for async response
  }

  if (message.type === 'EXTRACT_CONTENT') {
    const { html, url } = message;

    if (!html || !url) {
      sendResponse({ success: false, error: 'HTML and URL are required' });
      return true;
    }

    try {
      const result = extractMarkdownInOffscreen(html, url);
      sendResponse({ success: true, result });
    } catch (error) {
      sendResponse({
        success: false,
        error: getErrorMessage(error),
      });
    }

    return true; // Keep message channel open for async response
  }

  return false;
});
