import { marked as markedParser } from 'marked';

/**
 * Parses markdown content to HTML using the marked library.
 *
 * Configured with:
 * - Break on single newlines (gfm: true, breaks: true)
 * - Target="_blank" for all links for security
 *
 * @param markdown - The markdown string to parse
 * @returns HTML string
 */
export function parseMarkdown(markdown: string): string {
  markedParser.setOptions({
    gfm: true,
    breaks: true,
  });

  const html = markedParser.parse(markdown) as string;

  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
