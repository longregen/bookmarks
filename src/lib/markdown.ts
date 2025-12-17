import { marked as markedParser } from 'marked';
import DOMPurify from 'dompurify';

let initialized = false;

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

export function parseMarkdown(markdown: string): string {
  initializeIfNeeded();
  const html = markedParser.parse(markdown) as string;
  const sanitized = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_ATTR: ['style'],
  });
  return sanitized.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
