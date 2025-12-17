import { marked as markedParser } from 'marked';

export function parseMarkdown(markdown: string): string {
  markedParser.setOptions({
    gfm: true,
    breaks: true,
  });

  const html = markedParser.parse(markdown) as string;

  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
