import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webAdapter } from '../src/lib/adapters/web';
import type { ApiSettings } from '../src/lib/platform';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => {
      return store[key] || null;
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    get _store() {
      return store;
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

describe.sequential('Web Adapter', () => {
  beforeEach(() => {
    // Explicitly clear the localStorage mock
    localStorageMock.clear();
    // Verify it's cleared
    expect(localStorageMock._store).toEqual({});
    vi.clearAllMocks();
  });

  describe('Settings', () => {
    it('should return default settings when localStorage is empty', async () => {
      const settings = await webAdapter.getSettings();

      expect(settings).toEqual({
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        chatModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
      });
    });

    it('should save and retrieve settings', async () => {
      await webAdapter.saveSetting('apiKey', 'test-key-123');
      await webAdapter.saveSetting('chatModel', 'gpt-4');

      const settings = await webAdapter.getSettings();
      expect(settings.apiKey).toBe('test-key-123');
      expect(settings.chatModel).toBe('gpt-4');
    });

    it('should merge saved settings with defaults', async () => {
      await webAdapter.saveSetting('apiKey', 'my-key');

      const settings = await webAdapter.getSettings();
      expect(settings.apiKey).toBe('my-key');
      expect(settings.apiBaseUrl).toBe('https://api.openai.com/v1'); // default
      expect(settings.chatModel).toBe('gpt-4o-mini'); // default
    });

    it('should handle malformed JSON in localStorage gracefully', async () => {
      // Verify localStorage is clear first
      expect(localStorageMock.getItem('bookmark-rag-settings')).toBeNull();

      // Set malformed JSON
      localStorageMock.setItem('bookmark-rag-settings', 'invalid-json{');

      // Verify it's set
      expect(localStorageMock.getItem('bookmark-rag-settings')).toBe('invalid-json{');

      const settings = await webAdapter.getSettings();
      expect(settings).toEqual({
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        chatModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
      });
    });
  });

  describe('Theme', () => {
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
  });

  describe('Fetch Content', () => {
    it('should have fetchContent method', () => {
      expect(webAdapter.fetchContent).toBeDefined();
      expect(typeof webAdapter.fetchContent).toBe('function');
    });

    // Note: Full fetchContent testing would require mocking fetch and CORS proxies
    // which is beyond the scope of basic unit tests. E2E tests would be more appropriate.
  });
});
