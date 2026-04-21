import { marked as markedParser } from 'marked';
import DOMPurify from 'dompurify';

let initialized = false;

const EXTERNAL_RESOURCE_TAGS = new Set(['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME', 'EMBED', 'OBJECT', 'PICTURE']);

function isExternalUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//');
}

function initializeIfNeeded(): void {
  if (initialized) return;
  initialized = true;

  markedParser.setOptions({
    gfm: true,
    breaks: true,
  });

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'src' || data.attrName === 'href') {
      const value = data.attrValue.toLowerCase().trim();
      if (value.startsWith('data:') && !value.startsWith('data:image/')) {
        data.attrValue = '';
      }
    }
  });
}

export interface ParseMarkdownOptions {
  loadExternalResources?: boolean;
}

export function parseMarkdown(markdown: string, options: ParseMarkdownOptions = {}): string {
  initializeIfNeeded();
  const html = markedParser.parse(markdown) as string;

  const loadExternal = options.loadExternalResources ?? true;
  const stripHook = (node: Element): void => {
    if (!EXTERNAL_RESOURCE_TAGS.has(node.tagName)) return;
    const src = node.getAttribute('src');
    if (src !== null && isExternalUrl(src)) {
      node.removeAttribute('src');
      node.setAttribute('data-external-stripped', src);
      if (node.tagName === 'IMG' && node.getAttribute('alt') === null) {
        node.setAttribute('alt', '[external image]');
      }
    }
    const srcset = node.getAttribute('srcset');
    if (srcset !== null) {
      node.removeAttribute('srcset');
    }
  };

  if (!loadExternal) {
    DOMPurify.addHook('afterSanitizeAttributes', stripHook);
  }
  try {
    const sanitized = DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel'],
      FORBID_ATTR: ['style'],
    });
    return sanitized.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
  } finally {
    if (!loadExternal) {
      DOMPurify.removeHook('afterSanitizeAttributes');
    }
  }
}
