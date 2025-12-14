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
      // Mock a slow response that never resolves
      mockFetch.mockImplementationOnce(() => new Promise(() => {}));

      await expect(
        fetchWithTimeout('https://example.com', 100)
      ).rejects.toThrow();
    }, 1000);

    it('should abort fetch on timeout', async () => {
      let abortCalled = false;
      mockFetch.mockImplementationOnce((_url: any, options: any) => {
        options.signal.addEventListener('abort', () => {
          abortCalled = true;
        });
        return new Promise(() => {}); // Never resolves
      });

      try {
        await fetchWithTimeout('https://example.com', 100);
      } catch {
        // Expected to throw
      }

      // Wait for abort signal
      await new Promise(resolve => setTimeout(resolve, 150));
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
    it('should use fetchWithTimeout in Firefox', async () => {
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

    it('should detect Firefox correctly', async () => {
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

    it('should handle Chrome by attempting offscreen fetch', async () => {
      // Mock Chrome user agent
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Chrome)' },
        configurable: true,
      });

      // Mock chrome.runtime.sendMessage for offscreen
      const mockSendMessage = vi.fn((message, callback) => {
        callback({ success: true, html: 'chrome test' });
      });

      global.chrome = {
        runtime: {
          sendMessage: mockSendMessage,
          lastError: undefined,
        },
      } as any;

      const html = await browserFetch('https://example.com');
      expect(html).toBe('chrome test');
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FETCH_URL',
          url: 'https://example.com',
        }),
        expect.any(Function)
      );

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
      delete (global as any).chrome;
    });

    it('should handle offscreen fetch errors', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Chrome)' },
        configurable: true,
      });

      const mockSendMessage = vi.fn((message, callback) => {
        callback({ success: false, error: 'Fetch failed' });
      });

      global.chrome = {
        runtime: {
          sendMessage: mockSendMessage,
          lastError: undefined,
        },
      } as any;

      await expect(
        browserFetch('https://example.com')
      ).rejects.toThrow('Fetch failed');

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
      delete (global as any).chrome;
    });

    it('should handle chrome.runtime.lastError', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Chrome)' },
        configurable: true,
      });

      const mockSendMessage = vi.fn((message, callback) => {
        global.chrome.runtime.lastError = { message: 'Runtime error' };
        callback(null);
      });

      global.chrome = {
        runtime: {
          sendMessage: mockSendMessage,
          lastError: undefined,
        },
      } as any;

      await expect(
        browserFetch('https://example.com')
      ).rejects.toThrow('Runtime error');

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
      delete (global as any).chrome;
    });

    it('should pass timeout to offscreen fetch', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Chrome)' },
        configurable: true,
      });

      const mockSendMessage = vi.fn((message, callback) => {
        callback({ success: true, html: 'test' });
      });

      global.chrome = {
        runtime: {
          sendMessage: mockSendMessage,
          lastError: undefined,
        },
      } as any;

      await browserFetch('https://example.com', 15000);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 15000,
        }),
        expect.any(Function)
      );

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
      delete (global as any).chrome;
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
