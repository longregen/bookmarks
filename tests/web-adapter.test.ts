import { describe, it, expect, beforeEach } from 'vitest';

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

describe('Web Adapter', () => {
  let webAdapter: typeof import('../src/lib/adapters/web').webAdapter;

  beforeEach(async () => {
    localStorageMock.clear();

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

});
