import { describe, it, expect, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => { store = {}; },
    removeItem: (key: string) => { delete store[key]; },
    get _store() { return store; },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Web Adapter', () => {
  let webAdapter: typeof import('../src/lib/adapters/web').webAdapter;

  beforeEach(async () => {
    localStorageMock.clear();
    mockFetch.mockReset();

    const module = await import('../src/lib/adapters/web');
    webAdapter = module.webAdapter;
  });

  describe('Theme (localStorage)', () => {
    it('should return auto as default theme', async () => {
      const theme = await webAdapter.getTheme();
      expect(theme).toBe('auto');
    });

    it('should save and retrieve theme', async () => {
      await webAdapter.setTheme('dark');
      const theme = await webAdapter.getTheme();
      expect(theme).toBe('dark');
    });

    it('should support all theme values', async () => {
      const themes = ['auto', 'light', 'dark', 'terminal', 'tufte'] as const;

      for (const themeValue of themes) {
        await webAdapter.setTheme(themeValue);
        const retrieved = await webAdapter.getTheme();
        expect(retrieved).toBe(themeValue);
      }
    });

    it('should persist theme in localStorage', async () => {
      await webAdapter.setTheme('terminal');
      expect(localStorageMock.getItem('bookmark-rag-theme')).toBe('terminal');
    });
  });

  describe('Fetch Content', () => {
    it('should have fetchContent method', () => {
      expect(webAdapter.fetchContent).toBeDefined();
      expect(typeof webAdapter.fetchContent).toBe('function');
    });

    it('should try direct fetch first', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        url: 'https://example.com',
        text: () => Promise.resolve('<html><body>Hello</body></html>'),
      });

      const result = await webAdapter.fetchContent!('https://example.com');

      expect(result.html).toBe('<html><body>Hello</body></html>');
      expect(mockFetch).toHaveBeenCalledWith('https://example.com');
    });

    it('should fall back to CORS proxy on direct fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('CORS error'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>Proxied content</html>'),
      });

      const result = await webAdapter.fetchContent!('https://example.com');

      expect(result.html).toBe('<html>Proxied content</html>');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toContain('corsproxy.io');
    });

    it('should try multiple proxies if first fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('CORS error'));
      mockFetch.mockRejectedValueOnce(new Error('Proxy error'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>Second proxy</html>'),
      });

      const result = await webAdapter.fetchContent!('https://example.com');

      expect(result.html).toBe('<html>Second proxy</html>');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[2][0]).toContain('allorigins');
    });

    it('should throw error if all methods fail', async () => {
      mockFetch.mockRejectedValue(new Error('All failed'));

      await expect(webAdapter.fetchContent!('https://example.com'))
        .rejects.toThrow('Failed to fetch content');
    });
  });
});
