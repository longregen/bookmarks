import { marked as markedParser } from 'marked';

/**
 * Parses markdown content to HTML using the marked library.
 *
 * Configured with:
 * - Break on single newlines (gfm: true, breaks: true)
 * - Target="_blank" for all links for security
 * - Sanitized output
 *
 * @param markdown - The markdown string to parse
 * @returns HTML string
 */
export function parseMarkdown(markdown: string): string {
  // Configure marked for safe, user-friendly output
  markedParser.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert \n to <br>
  });

  // Use marked's built-in renderer for safe HTML generation
  const html = markedParser.parse(markdown) as string;

  // Add target="_blank" to all links for security (open in new tab)
  // This prevents the extension page from navigating away
  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
