/**
 * Shared HTML utility functions
 */

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&amp;': '&',
  };
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-z]+));/gi,
    (match, dec?: string, hex?: string, named?: string) => {
      if (dec !== undefined) return String.fromCharCode(parseInt(dec, 10));
      if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
      if (named !== undefined) return entities[`&${named};`] ?? match;
      return match;
    }
  );
}

/**
 * Extract title from HTML string with HTML entity decoding
 */
export function extractTitleFromHtml(html: string): string {
  const titleMatch = /<title[^>]*>(.*?)<\/title>/i.exec(html);
  if (titleMatch?.[1] !== undefined) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}
