import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchWithTimeout, browserFetch } from '../src/lib/browser-fetch';

vi.mock('../src/lib/tab-renderer', () => ({
  renderPage: vi.fn(),
}));

import { renderPage } from '../src/lib/tab-renderer';
const mockRenderPage = vi.mocked(renderPage);

describe('Browser Fetch Library', () => {
  const mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);

  beforeEach(() => {
    mockFetch.mockReset();
    mockRenderPage.mockReset();
  });

  describe('fetchWithTimeout', () => {
    it('should fetch a URL successfully', async () => {
      const mockHtml = '<html><body>Test Page</body></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => mockHtml,
      });

      const html = await fetchWithTimeout('https://example.com');
      expect(html).toBe(mockHtml);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BookmarkRAG/1.0)',
          },
        })
      );
    });

    it('should use AbortController for timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => 'test',
      });

      await fetchWithTimeout('https://example.com', 5000);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should throw error for non-OK responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      });

      await expect(
        fetchWithTimeout('https://example.com')
      ).rejects.toThrow('HTTP 404: Not Found');
    });

    it('should throw error for 500 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => '',
      });

      await expect(
        fetchWithTimeout('https://example.com')
      ).rejects.toThrow('HTTP 500: Internal Server Error');
    });

    it('should throw error for HTML content too large', async () => {
      const largeHtml = 'x'.repeat(11 * 1024 * 1024);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => largeHtml,
      });

      await expect(
        fetchWithTimeout('https://example.com')
      ).rejects.toThrow('HTML content too large');
    });

    it('should accept HTML content under 10 MB', async () => {
      const html = 'x'.repeat(9 * 1024 * 1024);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => html,
      });

      const result = await fetchWithTimeout('https://example.com');
      expect(result).toBe(html);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        fetchWithTimeout('https://example.com')
      ).rejects.toThrow('Network error');
    });

    it('should timeout on slow requests', async () => {
      mockFetch.mockImplementationOnce((_url: any, options: any) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        });
      });

      await expect(
        fetchWithTimeout('https://example.com', 100)
      ).rejects.toThrow();
    }, 1000);

    it('should abort fetch on timeout', async () => {
      let abortCalled = false;
      mockFetch.mockImplementationOnce((_url: any, options: any) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            abortCalled = true;
            reject(new Error('The operation was aborted'));
          });
        });
      });

      try {
        await fetchWithTimeout('https://example.com', 100);
      } catch {
      }

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(abortCalled).toBe(true);
    }, 1000);

    it('should handle empty HTML response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => '',
      });

      const html = await fetchWithTimeout('https://example.com');
      expect(html).toBe('');
    });

    it('should handle HTML with special characters', async () => {
      const specialHtml = '<html><body>Test & "quotes" < > </body></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => specialHtml,
      });

      const html = await fetchWithTimeout('https://example.com');
      expect(html).toBe(specialHtml);
    });

    it('should reject early when content-length header exceeds limit', async () => {
      const textFn = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': String(11 * 1024 * 1024) }),
        text: textFn,
      });

      await expect(
        fetchWithTimeout('https://example.com')
      ).rejects.toThrow('HTML content too large');
      expect(textFn).not.toHaveBeenCalled();
    });

    it('should skip content-length check when header is absent', async () => {
      const html = '<html>ok</html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => html,
      });

      const result = await fetchWithTimeout('https://example.com');
      expect(result).toBe(html);
    });
  });

  describe('browserFetch', () => {
    it('should use renderPage for tab-based rendering', async () => {
      mockRenderPage.mockResolvedValueOnce({ html: '<html>rendered content</html>', title: 'Test' });

      const result = await browserFetch('https://example.com');
      expect(result).toEqual({ html: '<html>rendered content</html>', title: 'Test' });
      expect(mockRenderPage).toHaveBeenCalledWith('https://example.com', expect.any(Number));
    });

    it('should handle render errors', async () => {
      mockRenderPage.mockRejectedValueOnce(new Error('Tab creation failed'));

      await expect(
        browserFetch('https://example.com')
      ).rejects.toThrow('Tab creation failed');
    });

    it('should pass timeout to renderPage', async () => {
      mockRenderPage.mockResolvedValueOnce({ html: '<html>test</html>', title: 'Test' });

      await browserFetch('https://example.com', 5000);
      expect(mockRenderPage).toHaveBeenCalledWith('https://example.com', 5000);
    });

    it('should use default timeout when not specified', async () => {
      mockRenderPage.mockResolvedValueOnce({ html: '<html>test</html>', title: 'Test' });

      await browserFetch('https://example.com');
      expect(mockRenderPage).toHaveBeenCalledWith('https://example.com', 30000);
    });

    it('should use directFetch in web builds', async () => {
      (globalThis as any).__IS_WEB__ = true;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => '<html><head><title>Web</title></head><body>web content</body></html>',
      });

      const result = await browserFetch('https://example.com');
      expect(result.html).toContain('web content');
      expect(mockRenderPage).not.toHaveBeenCalled();
      (globalThis as any).__IS_WEB__ = false;
    });

    it('should fall back to directFetch for localhost when renderPage fails', async () => {
      mockRenderPage.mockRejectedValueOnce(new Error('Tab creation failed'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => '<html><head><title>Local</title></head><body>localhost content</body></html>',
      });

      const result = await browserFetch('http://localhost:3000/page');
      expect(result.html).toContain('localhost content');
      expect(mockRenderPage).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should use renderPage for localhost when it succeeds', async () => {
      mockRenderPage.mockResolvedValueOnce({ html: '<html>rendered</html>', title: 'Local' });

      const result = await browserFetch('http://localhost:3000/page');
      expect(result).toEqual({ html: '<html>rendered</html>', title: 'Local' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

});
