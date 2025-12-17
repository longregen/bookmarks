import { marked as markedParser } from 'marked';

markedParser.setOptions({
  gfm: true,
  breaks: true,
});

export function parseMarkdown(markdown: string): string {
  const html = markedParser.parse(markdown) as string;
  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
