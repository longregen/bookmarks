import { fetchWithTimeout } from '../lib/browser-fetch';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ExtractedContent } from '../lib/extract';
import { getErrorMessage } from '../lib/errors';
import type { OffscreenReadyResponse } from '../lib/messages';

console.log('[Offscreen] Document loaded');

// Signal that the offscreen document is ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => {
  // Ignore errors - service worker may not be listening yet
});

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

chrome.runtime.onMessage.addListener((message: { type: string; url?: string; timeoutMs?: number; html?: string }, _sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_PING') {
    const response: OffscreenReadyResponse = { ready: true };
    sendResponse(response);
    return true;
  }

  if (message.type === 'FETCH_URL') {
    const { url, timeoutMs } = message;

    if (url === undefined || url === '') {
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

    return true;
  }

  if (message.type === 'EXTRACT_CONTENT') {
    const { html, url } = message;

    if (html === undefined || html === '' || url === undefined || url === '') {
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

    return true;
  }

  return false;
});
