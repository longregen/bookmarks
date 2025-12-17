import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchWithTimeout, browserFetch } from '../src/lib/browser-fetch';

describe('Browser Fetch Library', () => {
  // Mock global fetch
  const mockFetch = vi.fn();
  global.fetch = mockFetch as any;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('fetchWithTimeout', () => {
    it('should fetch a URL successfully', async () => {
      const mockHtml = '<html><body>Test Page</body></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
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

    it('should include User-Agent header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'test',
      });

      await fetchWithTimeout('https://example.com');

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
      const largeHtml = 'x'.repeat(11 * 1024 * 1024); // 11 MB
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => largeHtml,
      });

      await expect(
        fetchWithTimeout('https://example.com')
      ).rejects.toThrow('HTML content too large');
    });

    it('should accept HTML content under 10 MB', async () => {
      const html = 'x'.repeat(9 * 1024 * 1024); // 9 MB
      mockFetch.mockResolvedValueOnce({
        ok: true,
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
      // Mock a slow response that rejects when aborted
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
        // Expected to throw
      }

      // Wait for abort signal
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(abortCalled).toBe(true);
    }, 1000);

    it('should use default timeout of 30000ms', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'test',
      });

      await fetchWithTimeout('https://example.com');

      // Verify the call was made (timeout is internal)
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle custom timeout values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'test',
      });

      await fetchWithTimeout('https://example.com', 15000);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle empty HTML response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

      const html = await fetchWithTimeout('https://example.com');
      expect(html).toBe('');
    });

    it('should handle HTML with special characters', async () => {
      const specialHtml = '<html><body>Test & "quotes" < > </body></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => specialHtml,
      });

      const html = await fetchWithTimeout('https://example.com');
      expect(html).toBe(specialHtml);
    });
  });

  describe('browserFetch', () => {
    // These tests are skipped because __IS_FIREFOX__ is a build-time constant
    // In unit tests, __IS_FIREFOX__ = false, so browserFetch always uses Chrome path
    it.skip('should use fetchWithTimeout in Firefox', async () => {
      // Mock Firefox user agent
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Firefox)' },
        configurable: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'test',
      });

      const html = await browserFetch('https://example.com');
      expect(html).toBe('test');
      expect(mockFetch).toHaveBeenCalled();

      // Restore original navigator
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it.skip('should detect Firefox correctly', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0' },
        configurable: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'firefox test',
      });

      const html = await browserFetch('https://example.com');
      expect(html).toBe('firefox test');

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('should use fetchWithTimeout directly for Chrome (with host_permissions)', async () => {
      // Chrome service workers can now fetch directly with host_permissions: <all_urls>
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'chrome test',
      });

      const html = await browserFetch('https://example.com');
      expect(html).toBe('chrome test');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle fetch errors in Chrome', async () => {
      // Chrome fetches directly and handles errors the same way as fetchWithTimeout
      mockFetch.mockRejectedValueOnce(new Error('Fetch failed'));

      await expect(
        browserFetch('https://example.com')
      ).rejects.toThrow('Fetch failed');
    });

    it('should handle HTTP errors in Chrome', async () => {
      // Chrome uses direct fetch, so HTTP errors are handled the same way as fetchWithTimeout
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => '',
      });

      await expect(
        browserFetch('https://example.com')
      ).rejects.toThrow('HTTP 500: Internal Server Error');
    });

    it('should pass timeout to fetchWithTimeout', async () => {
      // Chrome now uses fetchWithTimeout directly, so timeout is handled there
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
        await browserFetch('https://example.com', 100);
      } catch {
        // Expected to throw on timeout
      }

      // Wait for abort signal
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(abortCalled).toBe(true);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle abort errors gracefully', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(
        fetchWithTimeout('https://example.com', 100)
      ).rejects.toThrow('The operation was aborted');
    });

    it('should handle DNS lookup failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

      await expect(
        fetchWithTimeout('https://nonexistent-domain-12345.com')
      ).rejects.toThrow('getaddrinfo ENOTFOUND');
    });

    it('should handle SSL certificate errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('certificate has expired'));

      await expect(
        fetchWithTimeout('https://expired-cert.example.com')
      ).rejects.toThrow('certificate has expired');
    });

    it('should handle connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      await expect(
        fetchWithTimeout('https://localhost:9999')
      ).rejects.toThrow('connect ECONNREFUSED');
    });

    it('should handle redirects (fetch follows by default)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'redirected content',
      });

      const html = await fetchWithTimeout('https://example.com/redirect');
      expect(html).toBe('redirected content');
    });

    it('should handle content-type variations', async () => {
      // Fetch doesn't care about content-type for text()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { 'content-type': 'application/xhtml+xml' },
        text: async () => '<html></html>',
      });

      const html = await fetchWithTimeout('https://example.com');
      expect(html).toBe('<html></html>');
    });
  });
});
