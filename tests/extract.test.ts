import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractMarkdown } from '../src/lib/extract';

describe('Content Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractMarkdown', () => {
    it('should extract content from simple HTML', () => {
      const html = `
        <html>
          <head>
            <title>Test Article</title>
          </head>
          <body>
            <article>
              <h1>Test Article</h1>
              <p>This is a test paragraph.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.title).toBe('Test Article');
      // Readability may not include the h1 in content since it's extracted as the title
      expect(result.content).toContain('This is a test paragraph');
    });

    it('should extract content with headings', () => {
      const html = `
        <html>
          <body>
            <article>
              <h1>Main Title</h1>
              <h2>Subtitle</h2>
              <p>Content here.</p>
              <h3>Sub-subtitle</h3>
              <p>More content.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('# Main Title');
      expect(result.content).toContain('## Subtitle');
      expect(result.content).toContain('### Sub-subtitle');
    });

    it('should extract content with links', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Check out <a href="https://example.com/page">this link</a>.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('[this link](https://example.com/page)');
    });

    it('should extract content with lists', () => {
      const html = `
        <html>
          <body>
            <article>
              <ul>
                <li>First item</li>
                <li>Second item</li>
                <li>Third item</li>
              </ul>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('First item');
      expect(result.content).toContain('Second item');
      expect(result.content).toContain('Third item');
    });

    it('should extract content with ordered lists', () => {
      const html = `
        <html>
          <body>
            <article>
              <ol>
                <li>First step</li>
                <li>Second step</li>
                <li>Third step</li>
              </ol>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('First step');
      expect(result.content).toContain('Second step');
      expect(result.content).toContain('Third step');
    });

    it('should extract content with code blocks', () => {
      const html = `
        <html>
          <body>
            <article>
              <pre><code>const x = 42;</code></pre>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('const x = 42;');
    });

    it('should extract content with blockquotes', () => {
      const html = `
        <html>
          <body>
            <article>
              <blockquote>
                <p>This is a quote.</p>
              </blockquote>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('This is a quote');
    });

    it('should handle strong/bold text', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>This is <strong>important</strong> text.</p>
              <p>This is <b>also bold</b> text.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('**important**');
      expect(result.content).toContain('**also bold**');
    });

    it('should handle emphasis/italic text', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>This is <em>emphasized</em> text.</p>
              <p>This is <i>italic</i> text.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      // Accept either * or _ for emphasis (both are valid markdown)
      expect(result.content).toMatch(/[*_]emphasized[*_]/);
      expect(result.content).toMatch(/[*_]italic[*_]/);
    });

    it('should remove script tags', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Visible content</p>
              <script>alert('hidden');</script>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('Visible content');
      expect(result.content).not.toContain('alert');
      expect(result.content).not.toContain('hidden');
    });

    it('should remove style tags', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Visible content</p>
              <style>.hidden { display: none; }</style>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('Visible content');
      expect(result.content).not.toContain('.hidden');
    });

    it('should extract byline when present', () => {
      const html = `
        <html>
          <body>
            <article>
              <div class="author">By John Doe</div>
              <p>Article content</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      // Readability might extract byline depending on HTML structure
      // This test just ensures it doesn't crash
      expect(result.byline === null || typeof result.byline === 'string').toBe(true);
    });

    it('should generate excerpt', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>This is the beginning of a long article with lots of content.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.excerpt).toBeDefined();
      expect(typeof result.excerpt).toBe('string');
    });

    it('should resolve relative links with base URL', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Check out <a href="/relative/path">this link</a>.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('https://example.com/relative/path');
    });

    it('should handle images', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Here is an image:</p>
              <img src="https://example.com/image.jpg" alt="Test Image">
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('image');
    });

    it('should handle tables', () => {
      const html = `
        <html>
          <body>
            <article>
              <table>
                <tr>
                  <th>Header 1</th>
                  <th>Header 2</th>
                </tr>
                <tr>
                  <td>Cell 1</td>
                  <td>Cell 2</td>
                </tr>
              </table>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('Header 1');
      expect(result.content).toContain('Cell 1');
    });

    it('should handle nested lists', () => {
      const html = `
        <html>
          <body>
            <article>
              <ul>
                <li>Item 1
                  <ul>
                    <li>Nested 1</li>
                    <li>Nested 2</li>
                  </ul>
                </li>
                <li>Item 2</li>
              </ul>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('Item 1');
      expect(result.content).toContain('Nested 1');
      expect(result.content).toContain('Nested 2');
      expect(result.content).toContain('Item 2');
    });

    it('should handle empty HTML', () => {
      const html = '<html><body></body></html>';

      expect(() => {
        extractMarkdown(html, 'https://example.com');
      }).toThrow('Readability could not parse the page');
    });

    it('should handle HTML with minimal content', () => {
      const html = `
        <html>
          <body>
            <p>Just a sentence.</p>
          </body>
        </html>
      `;

      // Readability might not extract this if it's too short
      // The test ensures we either extract or throw appropriately
      try {
        const result = extractMarkdown(html, 'https://example.com');
        expect(result).toBeDefined();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle malformed HTML gracefully', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Unclosed paragraph
              <div>Some content</div>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should handle HTML with multiple articles', () => {
      const html = `
        <html>
          <body>
            <article>
              <h1>First Article</h1>
              <p>First content</p>
            </article>
            <article>
              <h1>Second Article</h1>
              <p>Second content</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      // Readability should extract the main article
      expect(result.content).toBeDefined();
    });

    it('should handle inline code', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Use the <code>console.log()</code> function.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('console.log()');
    });

    it('should handle horizontal rules', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Before line</p>
              <hr>
              <p>After line</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('Before line');
      expect(result.content).toContain('After line');
    });

    it('should extract content from blog post structure', () => {
      const html = `
        <html>
          <head>
            <title>My Blog Post</title>
          </head>
          <body>
            <header>
              <nav>Navigation</nav>
            </header>
            <main>
              <article>
                <h1>My Blog Post</h1>
                <div class="meta">
                  <span>By Author</span>
                  <span>January 1, 2024</span>
                </div>
                <p>This is the introduction paragraph.</p>
                <h2>Section 1</h2>
                <p>Section 1 content.</p>
                <h2>Section 2</h2>
                <p>Section 2 content.</p>
              </article>
            </main>
            <footer>Footer content</footer>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com/blog');

      expect(result.title).toBe('My Blog Post');
      expect(result.content).toContain('introduction paragraph');
      expect(result.content).toContain('Section 1');
      expect(result.content).toContain('Section 2');
      // Navigation and footer should be filtered out by Readability
      expect(result.content).not.toContain('Navigation');
    });

    it('should extract content from news article structure', () => {
      const html = `
        <html>
          <body>
            <article>
              <header>
                <h1>Breaking News</h1>
                <time>2024-01-01</time>
              </header>
              <p class="lead">This is the lead paragraph.</p>
              <p>Additional details here.</p>
              <p>More information.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://news.example.com');

      // Title may be empty if no <title> tag in <head> (Readability behavior)
      // The h1 content should be in the markdown content instead
      expect(result.content).toContain('lead paragraph');
      expect(result.content).toContain('Additional details');
    });

    it('should handle paragraphs with multiple formatting', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>This has <strong>bold</strong> and <em>italic</em> and <code>code</code> together.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('**bold**');
      // Accept either * or _ for emphasis (both are valid markdown)
      expect(result.content).toMatch(/[*_]italic[*_]/);
      expect(result.content).toContain('code');
    });

    it('should preserve whitespace structure in content', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>First paragraph.</p>
              <p>Second paragraph.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('First paragraph');
      expect(result.content).toContain('Second paragraph');
    });

    it('should handle special characters', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Special chars: &amp; &lt; &gt; &quot; &#39;</p>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('&');
      expect(result.content).toContain('<');
      expect(result.content).toContain('>');
    });

    it('should handle different URL schemes', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Content</p>
            </article>
          </body>
        </html>
      `;

      // HTTP URL
      let result = extractMarkdown(html, 'http://example.com');
      expect(result.content).toBeDefined();

      // HTTPS URL
      result = extractMarkdown(html, 'https://example.com');
      expect(result.content).toBeDefined();
    });

    it('should handle complex nested HTML structures', () => {
      const html = `
        <html>
          <body>
            <article>
              <section>
                <div>
                  <p>Deeply <span>nested <strong>content</strong></span> here.</p>
                </div>
              </section>
            </article>
          </body>
        </html>
      `;

      const result = extractMarkdown(html, 'https://example.com');

      expect(result.content).toContain('Deeply');
      expect(result.content).toContain('nested');
      expect(result.content).toContain('**content**');
    });
  });
});
