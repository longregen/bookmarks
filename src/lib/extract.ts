import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export interface ExtractedContent {
  title: string;
  content: string;      // Markdown
  excerpt: string;
  byline: string | null;
}

// Helper to add polyfills for URL properties
function polyfillURLProperties(doc: Document, url: string): void {
  if (!doc.baseURI || doc.baseURI === 'about:blank') {
    Object.defineProperty(doc, 'baseURI', {
      get: function() { return url; },
      configurable: true,
    });
  }

  if (!doc.documentURI || doc.documentURI === 'about:blank') {
    Object.defineProperty(doc, 'documentURI', {
      get: function() { return url; },
      configurable: true,
    });
  }
}

// Helper to add polyfills for missing DOM methods (linkedom compatibility)
function polyfillDOMMethods(element: Document | Element): void {
  if (!element.getElementsByTagName) {
    element.getElementsByTagName = function(tagName: string) {
      if (tagName === '*') {
        return this.querySelectorAll('*');
      }
      return this.querySelectorAll(tagName.toLowerCase());
    };
  }

  if (!element.getElementsByClassName) {
    element.getElementsByClassName = function(className: string) {
      return this.querySelectorAll('.' + className.replace(/\s+/g, '.'));
    };
  }
}

// Helper to create a DOM document from HTML
function createDocument(html: string, url: string): Document {
  // Try to use native DOMParser (Firefox) - just attempt it directly
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    console.log('[Extract] Using native DOMParser');
    polyfillURLProperties(doc, url);
    return doc;
  } catch (e) {
    // DOMParser not available, fall back to linkedom (Chrome service workers)
    console.log('[Extract] DOMParser not available, using linkedom');
  }

  // Fall back to linkedom for Chrome service workers
  const { document: doc } = parseHTML(html);

  // Polyfill missing DOM methods that Readability expects
  // LinkedOM doesn't support getElementsByTagName or getElementsByClassName
  polyfillDOMMethods(doc);
  polyfillDOMMethods(doc.documentElement);
  polyfillURLProperties(doc, url);

  return doc;
}

export function extractMarkdown(html: string, url: string): ExtractedContent {
  // Debug: Log input before processing
  console.log('[Extract] Input received', {
    url,
    htmlLength: html.length,
    htmlPreview: html.slice(0, 200),
  });

  // Create DOM document (native DOMParser for Firefox, linkedom for Chrome)
  const doc = createDocument(html, url);

  // Debug: Log DOM parsing result
  console.log('[Extract] DOM created', {
    url,
    hasBody: !!doc.body,
    bodyChildCount: doc.body?.childElementCount,
    bodyInnerHTMLLength: doc.body?.innerHTML?.length ?? 0,
    documentElementTagName: doc.documentElement?.tagName,
    hasArticleTag: !!doc.querySelector('article'),
  });

  // Set the base URL for relative link resolution
  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);

  // Run Readability
  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    console.error('[Extract] Readability returned null', {
      url,
      htmlLength: html.length,
      bodyHTML: doc.body?.innerHTML?.slice(0, 500),
    });
    throw new Error('Readability could not parse the page');
  }

  // Debug: Log what Readability extracted
  console.log('[Extract] Readability result', {
    title: article.title,
    contentLength: article.content?.length ?? 0,
    contentPreview: article.content?.slice(0, 200) ?? '',
    excerptLength: article.excerpt?.length ?? 0,
    byline: article.byline,
    textContentLength: article.textContent?.length ?? 0,
  });

  // Convert HTML content to Markdown
  let markdown: string;

  try {
    // Try native DOMParser first
    const parser = new DOMParser();
    const contentDoc = parser.parseFromString(article.content, 'text/html');
    markdown = turndown.turndown(contentDoc.body);
  } catch (e) {
    // Fall back to linkedom
    const { document: contentDoc } = parseHTML(article.content);
    markdown = turndown.turndown(contentDoc.body);
  }

  console.log('[Extract] Markdown conversion complete', {
    markdownLength: markdown.length,
    markdownPreview: markdown.slice(0, 100),
  });

  return {
    title: article.title,
    content: markdown,
    excerpt: article.excerpt || '',
    byline: article.byline,
  };
}
