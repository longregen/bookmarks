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

    it('should sanitize script tags', () => {
      const markdown = '<script>alert("xss")</script>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert');
    });

    it('should sanitize onerror handlers', () => {
      const markdown = '<img src=x onerror="alert(\'xss\')">';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('onerror');
      expect(html).not.toContain('alert');
    });

    it('should sanitize onclick handlers', () => {
      const markdown = '<div onclick="alert(\'xss\')">Click me</div>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('alert');
    });

    it('should sanitize onmouseover handlers', () => {
      const markdown = '<span onmouseover="alert(\'xss\')">Hover</span>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('onmouseover');
    });

    it('should sanitize javascript: URLs', () => {
      const markdown = '<a href="javascript:alert(\'xss\')">Click</a>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('javascript:');
    });

    it('should sanitize data: URLs in images', () => {
      const markdown = '<img src="data:text/html,<script>alert(\'xss\')</script>">';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('data:text/html');
    });

    it('should sanitize iframe tags', () => {
      const markdown = '<iframe src="https://evil.com"></iframe>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('<iframe');
    });

    it('should sanitize object tags', () => {
      const markdown = '<object data="https://evil.com/malware.swf"></object>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('<object');
    });

    it('should sanitize embed tags', () => {
      const markdown = '<embed src="https://evil.com/malware.swf">';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('<embed');
    });

    it('should sanitize svg with scripts', () => {
      const markdown = '<svg onload="alert(\'xss\')"><circle r="10"></circle></svg>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('onload');
    });

    it('should sanitize style-based attacks', () => {
      const markdown = '<div style="background:url(javascript:alert(\'xss\'))">styled</div>';
      const html = parseMarkdown(markdown);
      expect(html).not.toContain('javascript:');
    });

    it('should handle mixed markdown and malicious HTML', () => {
      const markdown = `# Safe Title

This is **safe** content.

<script>alert('xss')</script>

More *safe* content.`;
      const html = parseMarkdown(markdown);
      expect(html).toContain('<h1');
      expect(html).toContain('<strong>safe</strong>');
      expect(html).toContain('<em>safe</em>');
      expect(html).not.toContain('<script');
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
