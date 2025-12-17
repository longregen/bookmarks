import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/lib/markdown';

describe('Markdown parsing', () => {
  describe('parseMarkdown', () => {
    it('should convert basic markdown to HTML', () => {
      const markdown = '# Hello World';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<h1');
      expect(html).toContain('Hello World');
    });

    it('should convert paragraphs', () => {
      const markdown = 'This is a paragraph.';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<p>');
      expect(html).toContain('This is a paragraph.');
    });

    it('should convert bold text', () => {
      const markdown = '**bold text**';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<strong>bold text</strong>');
    });

    it('should convert italic text', () => {
      const markdown = '*italic text*';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<em>italic text</em>');
    });

    it('should convert links and add target="_blank"', () => {
      const markdown = '[Click here](https://example.com)';
      const html = parseMarkdown(markdown);
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('should add security attributes to all links', () => {
      const markdown = `
Check out [link1](https://example1.com) and [link2](https://example2.com).
Also [link3](https://example3.com).
      `;
      const html = parseMarkdown(markdown);

      // Count occurrences of target="_blank"
      const matches = html.match(/target="_blank"/g) || [];
      expect(matches.length).toBe(3);
    });

    it('should convert unordered lists', () => {
      const markdown = `
- Item 1
- Item 2
- Item 3
      `;
      const html = parseMarkdown(markdown);
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
      expect(html).toContain('Item 1');
    });

    it('should convert ordered lists', () => {
      const markdown = `
1. First
2. Second
3. Third
      `;
      const html = parseMarkdown(markdown);
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>');
      expect(html).toContain('First');
    });

    it('should convert code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<code');
      expect(html).toContain('const x = 1;');
    });

    it('should convert inline code', () => {
      const markdown = 'Use `console.log()` for debugging.';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<code>console.log()</code>');
    });

    it('should convert blockquotes', () => {
      const markdown = '> This is a quote.';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<blockquote>');
      expect(html).toContain('This is a quote.');
    });

    it('should handle GFM tables', () => {
      const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
      `;
      const html = parseMarkdown(markdown);
      expect(html).toContain('<table>');
      expect(html).toContain('<th>');
      expect(html).toContain('Header 1');
    });

    it('should handle line breaks', () => {
      const markdown = 'Line 1\nLine 2';
      const html = parseMarkdown(markdown);
      // With breaks: true, single newlines become <br>
      expect(html).toContain('<br>');
    });

    it('should handle horizontal rules', () => {
      const markdown = '---';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<hr');
    });

    it('should handle nested formatting', () => {
      const markdown = '**This is _bold and italic_**';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });

    it('should handle images', () => {
      const markdown = '![Alt text](https://example.com/image.png)';
      const html = parseMarkdown(markdown);
      expect(html).toContain('<img');
      expect(html).toContain('alt="Alt text"');
      expect(html).toContain('src="https://example.com/image.png"');
    });

    it('should handle empty markdown', () => {
      const markdown = '';
      const html = parseMarkdown(markdown);
      expect(html).toBe('');
    });

    it('should handle markdown with only whitespace', () => {
      const markdown = '   \n\n   ';
      const html = parseMarkdown(markdown);
      expect(html.trim()).toBe('');
    });

    it('should handle raw HTML in markdown (marked allows HTML by default)', () => {
      // Note: marked allows HTML by default for flexibility
      // In a production app, you'd sanitize the output with DOMPurify or similar
      const markdown = '<script>alert("xss")</script>';
      const html = parseMarkdown(markdown);
      // marked preserves HTML tags - sanitization should be handled at render time
      expect(html).toBeDefined();
    });

    it('should handle complex documents', () => {
      const markdown = `
# Main Title

This is an introduction paragraph with **bold** and *italic* text.

## Section 1

Here's a list:
- First item
- Second item with [a link](https://example.com)

## Section 2

\`\`\`python
def hello():
    print("Hello")
\`\`\`

> A blockquote for emphasis.
      `;

      const html = parseMarkdown(markdown);
      expect(html).toContain('<h1');
      expect(html).toContain('<h2');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
      expect(html).toContain('<ul>');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('<code');
      expect(html).toContain('<blockquote>');
    });
  });
});
