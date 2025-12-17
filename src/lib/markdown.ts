import { marked as markedParser } from 'marked';

// Set options once at module load time instead of on every function call
markedParser.setOptions({
  gfm: true,
  breaks: true,
});

export function parseMarkdown(markdown: string): string {
  const html = markedParser.parse(markdown) as string;
  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
