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

export function extractMarkdown(html: string, url: string): ExtractedContent {
  // Parse HTML into a DOM document using linkedom (works in service workers)
  const { document: doc } = parseHTML(html);

  // Set the base URL for relative link resolution
  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);

  // Run Readability
  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    throw new Error('Readability could not parse the page');
  }

  // Convert HTML content to Markdown
  const markdown = turndown.turndown(article.content);

  return {
    title: article.title,
    content: markdown,
    excerpt: article.excerpt || '',
    byline: article.byline,
  };
}
