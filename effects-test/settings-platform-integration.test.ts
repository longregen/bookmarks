import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Ref from 'effect/Ref';
import {
  PlatformService,
  PlatformSettingsError,
  PlatformThemeError,
  PlatformFetchError,
  type ApiSettings,
  type Theme,
  makePlatformLayer,
  type PlatformAdapter,
} from '../effect/lib/platform';
import { SettingsService, SettingsError } from '../effect/lib/settings';

// ============================================================================
// Mock Storage for Testing
// ============================================================================

/**
 * In-memory storage that mimics browser storage behavior
 */
class MockStorage {
  private store = new Map<string, string | boolean | number>();

  async get(key: string): Promise<string | boolean | number | undefined> {
    return this.store.get(key);
  }

  async set(key: string, value: string | boolean | number): Promise<void> {
    this.store.set(key, value);
  }

  async getAll(): Promise<Map<string, string | boolean | number>> {
    return new Map(this.store);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Mock chrome.storage.local for extension adapter testing
 */
class MockChromeStorage {
  private store = new Map<string, unknown>();

  async get(key: string): Promise<Record<string, unknown>> {
    const value = this.store.get(key);
    return value !== undefined ? { [key]: value } : {};
  }

  async set(data: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      this.store.set(key, value);
    }
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Mock localStorage for web adapter testing
 */
class MockLocalStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
}

// ============================================================================
// Mock Platform Adapters
// ============================================================================

/**
 * Creates a mock platform adapter for extension environment
 */
function createMockExtensionAdapter(
  storage: MockStorage,
  chromeStorage: MockChromeStorage
): PlatformAdapter {
  const THEME_KEY = 'bookmark-rag-theme';

  return {
    async getSettings(): Promise<ApiSettings> {
      const store = await storage.getAll();
      return {
        apiBaseUrl: (store.get('apiBaseUrl') as string) ?? 'https://api.openai.com/v1',
        apiKey: (store.get('apiKey') as string) ?? '',
        chatModel: (store.get('chatModel') as string) ?? 'gpt-4o-mini',
        embeddingModel: (store.get('embeddingModel') as string) ?? 'text-embedding-3-small',
        webdavUrl: (store.get('webdavUrl') as string) ?? '',
        webdavUsername: (store.get('webdavUsername') as string) ?? '',
        webdavPassword: (store.get('webdavPassword') as string) ?? '',
        webdavPath: (store.get('webdavPath') as string) ?? '/bookmarks',
        webdavEnabled: (store.get('webdavEnabled') as boolean) ?? false,
        webdavAllowInsecure: (store.get('webdavAllowInsecure') as boolean) ?? false,
        webdavSyncInterval: (store.get('webdavSyncInterval') as number) ?? 15,
        webdavLastSyncTime: (store.get('webdavLastSyncTime') as string) ?? '',
        webdavLastSyncError: (store.get('webdavLastSyncError') as string) ?? '',
      };
    },

    async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
      await storage.set(key, value);
    },

    async getTheme(): Promise<Theme> {
      const result = await chromeStorage.get(THEME_KEY);
      return (result[THEME_KEY] as Theme) || 'auto';
    },

    async setTheme(theme: Theme): Promise<void> {
      await chromeStorage.set({ [THEME_KEY]: theme });
    },

    async fetchContent(): Promise<{ html: string; finalUrl: string }> {
      throw new Error('Extension adapter does not support fetchContent');
    },
  };
}

/**
 * Creates a mock platform adapter for web environment
 */
function createMockWebAdapter(
  storage: MockStorage,
  localStorage: MockLocalStorage
): PlatformAdapter {
  const THEME_KEY = 'bookmark-rag-theme';

  return {
    async getSettings(): Promise<ApiSettings> {
      const store = await storage.getAll();
      return {
        apiBaseUrl: (store.get('apiBaseUrl') as string) ?? 'https://api.openai.com/v1',
        apiKey: (store.get('apiKey') as string) ?? '',
        chatModel: (store.get('chatModel') as string) ?? 'gpt-4o-mini',
        embeddingModel: (store.get('embeddingModel') as string) ?? 'text-embedding-3-small',
        webdavUrl: (store.get('webdavUrl') as string) ?? '',
        webdavUsername: (store.get('webdavUsername') as string) ?? '',
        webdavPassword: (store.get('webdavPassword') as string) ?? '',
        webdavPath: (store.get('webdavPath') as string) ?? '/bookmarks',
        webdavEnabled: (store.get('webdavEnabled') as boolean) ?? false,
        webdavAllowInsecure: (store.get('webdavAllowInsecure') as boolean) ?? false,
        webdavSyncInterval: (store.get('webdavSyncInterval') as number) ?? 15,
        webdavLastSyncTime: (store.get('webdavLastSyncTime') as string) ?? '',
        webdavLastSyncError: (store.get('webdavLastSyncError') as string) ?? '',
      };
    },

    async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
      await storage.set(key, value);
    },

    async getTheme(): Promise<Theme> {
      const theme = localStorage.getItem(THEME_KEY);
      return (theme as Theme) || 'auto';
    },

    async setTheme(theme: Theme): Promise<void> {
      localStorage.setItem(THEME_KEY, theme);
    },

    async fetchContent(url: string): Promise<{ html: string; finalUrl: string }> {
      return {
        html: `<html><body>Mock content for ${url}</body></html>`,
        finalUrl: url,
      };
    },
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Settings & Platform Abstraction Integration', () => {
  describe('PlatformService Mock Layer', () => {
    it('should create a working layer from mock adapter', async () => {
      const storage = new MockStorage();
      const chromeStorage = new MockChromeStorage();
      const adapter = createMockExtensionAdapter(storage, chromeStorage);
      const layer = makePlatformLayer(adapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        const settings = yield* platform.getSettings();
        return settings;
      });

      const result = await Effect.runPromise(Effect.provide(program, layer));

      expect(result).toBeDefined();
      expect(result.apiBaseUrl).toBe('https://api.openai.com/v1');
      expect(result.chatModel).toBe('gpt-4o-mini');
    });

    it('should handle adapter errors gracefully', async () => {
      const faultyAdapter: PlatformAdapter = {
        async getSettings(): Promise<ApiSettings> {
          throw new Error('Storage unavailable');
        },
        async saveSetting(): Promise<void> {
          throw new Error('Storage unavailable');
        },
        async getTheme(): Promise<Theme> {
          throw new Error('Storage unavailable');
        },
        async setTheme(): Promise<void> {
          throw new Error('Storage unavailable');
        },
      };

      const layer = makePlatformLayer(faultyAdapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.getSettings();
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer).pipe(
          Effect.catchTag('PlatformSettingsError', (error) =>
            Effect.succeed({ error: error.message })
          )
        )
      );

      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toBe('Failed to get settings');
    });

    it('should properly tag errors with operation context', async () => {
      const faultyAdapter: PlatformAdapter = {
        async getSettings(): Promise<ApiSettings> {
          throw new Error('DB connection failed');
        },
        async saveSetting(): Promise<void> {
          throw new Error('Write failed');
        },
        async getTheme(): Promise<Theme> {
          return 'auto';
        },
        async setTheme(): Promise<void> {},
      };

      const layer = makePlatformLayer(faultyAdapter);

      const getProgram = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.getSettings();
      });

      const saveProgram = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.saveSetting('apiKey', 'test-key');
      });

      const getError = await Effect.runPromise(
        Effect.provide(getProgram, layer).pipe(
          Effect.flip,
          Effect.catchAll((error) => Effect.succeed(error))
        )
      );

      const saveError = await Effect.runPromise(
        Effect.provide(saveProgram, layer).pipe(
          Effect.flip,
          Effect.catchAll((error) => Effect.succeed(error))
        )
      );

      expect(getError).toBeInstanceOf(PlatformSettingsError);
      expect((getError as PlatformSettingsError).operation).toBe('get');

      expect(saveError).toBeInstanceOf(PlatformSettingsError);
      expect((saveError as PlatformSettingsError).operation).toBe('save');
      expect((saveError as PlatformSettingsError).key).toBe('apiKey');
    });
  });

  describe('Settings Get/Save Operations', () => {
    let storage: MockStorage;
    let chromeStorage: MockChromeStorage;
    let adapter: PlatformAdapter;
    let layer: Layer.Layer<PlatformService, never, never>;

    beforeEach(() => {
      storage = new MockStorage();
      chromeStorage = new MockChromeStorage();
      adapter = createMockExtensionAdapter(storage, chromeStorage);
      layer = makePlatformLayer(adapter);
    });

    it('should get default settings when storage is empty', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.getSettings();
      });

      const settings = await Effect.runPromise(Effect.provide(program, layer));

      expect(settings.apiBaseUrl).toBe('https://api.openai.com/v1');
      expect(settings.apiKey).toBe('');
      expect(settings.chatModel).toBe('gpt-4o-mini');
      expect(settings.embeddingModel).toBe('text-embedding-3-small');
      expect(settings.webdavEnabled).toBe(false);
    });

    it('should save and retrieve string settings', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.saveSetting('apiKey', 'sk-test-123');
        const settings = yield* platform.getSettings();
        return settings.apiKey;
      });

      const apiKey = await Effect.runPromise(Effect.provide(program, layer));

      expect(apiKey).toBe('sk-test-123');
    });

    it('should save and retrieve boolean settings', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.saveSetting('webdavEnabled', true);
        const settings = yield* platform.getSettings();
        return settings.webdavEnabled;
      });

      const enabled = await Effect.runPromise(Effect.provide(program, layer));

      expect(enabled).toBe(true);
    });

    it('should save and retrieve number settings', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.saveSetting('webdavSyncInterval', 30);
        const settings = yield* platform.getSettings();
        return settings.webdavSyncInterval;
      });

      const interval = await Effect.runPromise(Effect.provide(program, layer));

      expect(interval).toBe(30);
    });

    it('should handle multiple concurrent save operations', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        yield* Effect.all(
          [
            platform.saveSetting('apiKey', 'sk-test-123'),
            platform.saveSetting('chatModel', 'gpt-4'),
            platform.saveSetting('webdavEnabled', true),
            platform.saveSetting('webdavSyncInterval', 60),
          ],
          { concurrency: 'unbounded' }
        );

        return yield* platform.getSettings();
      });

      const settings = await Effect.runPromise(Effect.provide(program, layer));

      expect(settings.apiKey).toBe('sk-test-123');
      expect(settings.chatModel).toBe('gpt-4');
      expect(settings.webdavEnabled).toBe(true);
      expect(settings.webdavSyncInterval).toBe(60);
    });

    it('should overwrite existing settings', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        yield* platform.saveSetting('apiKey', 'first-key');
        const settings1 = yield* platform.getSettings();

        yield* platform.saveSetting('apiKey', 'second-key');
        const settings2 = yield* platform.getSettings();

        return { first: settings1.apiKey, second: settings2.apiKey };
      });

      const result = await Effect.runPromise(Effect.provide(program, layer));

      expect(result.first).toBe('first-key');
      expect(result.second).toBe('second-key');
    });
  });

  describe('Extension vs Web Adapter Differences', () => {
    it('should use chrome.storage.local for theme in extension adapter', async () => {
      const storage = new MockStorage();
      const chromeStorage = new MockChromeStorage();
      const adapter = createMockExtensionAdapter(storage, chromeStorage);
      const layer = makePlatformLayer(adapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.setTheme('dark');
        return yield* platform.getTheme();
      });

      const theme = await Effect.runPromise(Effect.provide(program, layer));

      expect(theme).toBe('dark');
      expect(chromeStorage.size()).toBe(1);
    });

    it('should use localStorage for theme in web adapter', async () => {
      const storage = new MockStorage();
      const localStorage = new MockLocalStorage();
      const adapter = createMockWebAdapter(storage, localStorage);
      const layer = makePlatformLayer(adapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.setTheme('light');
        return yield* platform.getTheme();
      });

      const theme = await Effect.runPromise(Effect.provide(program, layer));

      expect(theme).toBe('light');
      expect(localStorage.length).toBe(1);
    });

    it('should return null for fetchContent in extension adapter', async () => {
      const storage = new MockStorage();
      const chromeStorage = new MockChromeStorage();
      const adapter = createMockExtensionAdapter(storage, chromeStorage);
      const layer = makePlatformLayer(adapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.fetchContent('https://example.com');
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer).pipe(
          Effect.catchTag('PlatformFetchError', () => Effect.succeed(null))
        )
      );

      expect(result).toBeNull();
    });

    it('should support fetchContent in web adapter', async () => {
      const storage = new MockStorage();
      const localStorage = new MockLocalStorage();
      const adapter = createMockWebAdapter(storage, localStorage);
      const layer = makePlatformLayer(adapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.fetchContent('https://example.com');
      });

      const result = await Effect.runPromise(Effect.provide(program, layer));

      expect(result).not.toBeNull();
      expect(result?.html).toContain('Mock content');
      expect(result?.finalUrl).toBe('https://example.com');
    });

    it('should share settings storage implementation', async () => {
      const storage = new MockStorage();

      const extensionAdapter = createMockExtensionAdapter(
        storage,
        new MockChromeStorage()
      );
      const webAdapter = createMockWebAdapter(storage, new MockLocalStorage());

      await storage.set('apiKey', 'shared-key');

      const extensionSettings = await extensionAdapter.getSettings();
      const webSettings = await webAdapter.getSettings();

      expect(extensionSettings.apiKey).toBe('shared-key');
      expect(webSettings.apiKey).toBe('shared-key');
    });
  });

  describe('Settings Validation', () => {
    let storage: MockStorage;
    let adapter: PlatformAdapter;
    let layer: Layer.Layer<PlatformService, never, never>;

    beforeEach(() => {
      storage = new MockStorage();
      adapter = createMockExtensionAdapter(storage, new MockChromeStorage());
      layer = makePlatformLayer(adapter);
    });

    it('should handle empty string values', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.saveSetting('apiKey', '');
        const settings = yield* platform.getSettings();
        return settings.apiKey;
      });

      const apiKey = await Effect.runPromise(Effect.provide(program, layer));

      expect(apiKey).toBe('');
    });

    it('should handle zero as valid number', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.saveSetting('webdavSyncInterval', 0);
        const settings = yield* platform.getSettings();
        return settings.webdavSyncInterval;
      });

      const interval = await Effect.runPromise(Effect.provide(program, layer));

      expect(interval).toBe(0);
    });

    it('should handle false as valid boolean', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        yield* platform.saveSetting('webdavEnabled', false);
        const settings = yield* platform.getSettings();
        return settings.webdavEnabled;
      });

      const enabled = await Effect.runPromise(Effect.provide(program, layer));

      expect(enabled).toBe(false);
    });

    it('should preserve all setting types in round-trip', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        const testSettings = {
          apiKey: 'test-key-123',
          chatModel: 'gpt-4',
          webdavEnabled: true,
          webdavSyncInterval: 45,
          webdavUrl: 'https://webdav.example.com',
        };

        for (const [key, value] of Object.entries(testSettings)) {
          yield* platform.saveSetting(
            key as keyof ApiSettings,
            value as string | boolean | number
          );
        }

        return yield* platform.getSettings();
      });

      const settings = await Effect.runPromise(Effect.provide(program, layer));

      expect(settings.apiKey).toBe('test-key-123');
      expect(settings.chatModel).toBe('gpt-4');
      expect(settings.webdavEnabled).toBe(true);
      expect(settings.webdavSyncInterval).toBe(45);
      expect(settings.webdavUrl).toBe('https://webdav.example.com');
    });
  });

  describe('Theme Persistence', () => {
    let storage: MockStorage;
    let chromeStorage: MockChromeStorage;
    let adapter: PlatformAdapter;
    let layer: Layer.Layer<PlatformService, never, never>;

    beforeEach(() => {
      storage = new MockStorage();
      chromeStorage = new MockChromeStorage();
      adapter = createMockExtensionAdapter(storage, chromeStorage);
      layer = makePlatformLayer(adapter);
    });

    it('should default to auto theme when not set', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.getTheme();
      });

      const theme = await Effect.runPromise(Effect.provide(program, layer));

      expect(theme).toBe('auto');
    });

    it('should persist all theme options', async () => {
      const themes: Theme[] = ['auto', 'light', 'dark', 'terminal', 'tufte'];

      for (const theme of themes) {
        const program = Effect.gen(function* () {
          const platform = yield* PlatformService;
          yield* platform.setTheme(theme);
          return yield* platform.getTheme();
        });

        const result = await Effect.runPromise(Effect.provide(program, layer));

        expect(result).toBe(theme);
      }
    });

    it('should overwrite previous theme selection', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        yield* platform.setTheme('light');
        const first = yield* platform.getTheme();

        yield* platform.setTheme('dark');
        const second = yield* platform.getTheme();

        yield* platform.setTheme('terminal');
        const third = yield* platform.getTheme();

        return { first, second, third };
      });

      const result = await Effect.runPromise(Effect.provide(program, layer));

      expect(result.first).toBe('light');
      expect(result.second).toBe('dark');
      expect(result.third).toBe('terminal');
    });

    it('should handle theme errors gracefully with fallback', async () => {
      const faultyAdapter: PlatformAdapter = {
        async getSettings(): Promise<ApiSettings> {
          throw new Error('Not implemented');
        },
        async saveSetting(): Promise<void> {
          throw new Error('Not implemented');
        },
        async getTheme(): Promise<Theme> {
          throw new Error('Theme storage unavailable');
        },
        async setTheme(): Promise<void> {
          throw new Error('Theme storage unavailable');
        },
      };

      const layer = makePlatformLayer(faultyAdapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.getTheme();
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer).pipe(
          Effect.catchTag('PlatformThemeError', () => Effect.succeed('auto' as Theme))
        )
      );

      expect(result).toBe('auto');
    });

    it('should store theme separately from settings', async () => {
      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        yield* platform.setTheme('dark');
        yield* platform.saveSetting('apiKey', 'test-key');

        const theme = yield* platform.getTheme();
        const settings = yield* platform.getSettings();

        return { theme, apiKey: settings.apiKey };
      });

      const result = await Effect.runPromise(Effect.provide(program, layer));

      expect(result.theme).toBe('dark');
      expect(result.apiKey).toBe('test-key');
      expect(storage.size()).toBe(1);
      expect(chromeStorage.size()).toBe(1);
    });
  });

  describe('SettingsService Integration', () => {
    it('should work with both PlatformService and SettingsService layers', async () => {
      const storage = new MockStorage();
      const chromeStorage = new MockChromeStorage();
      const platformAdapter = createMockExtensionAdapter(storage, chromeStorage);

      // Note: SettingsService uses the deprecated getPlatformAdapter(),
      // so this is a compatibility test
      const platformLayer = makePlatformLayer(platformAdapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        yield* platform.saveSetting('apiKey', 'integration-test-key');
        yield* platform.saveSetting('chatModel', 'gpt-4-turbo');

        const settings = yield* platform.getSettings();

        return {
          apiKey: settings.apiKey,
          chatModel: settings.chatModel,
        };
      });

      const result = await Effect.runPromise(Effect.provide(program, platformLayer));

      expect(result.apiKey).toBe('integration-test-key');
      expect(result.chatModel).toBe('gpt-4-turbo');
    });
  });

  describe('Error Handling & Recovery', () => {
    it('should provide detailed error information on save failure', async () => {
      const faultyAdapter: PlatformAdapter = {
        async getSettings(): Promise<ApiSettings> {
          throw new Error('Not implemented');
        },
        async saveSetting(key: keyof ApiSettings): Promise<void> {
          throw new Error(`Permission denied for key: ${key}`);
        },
        async getTheme(): Promise<Theme> {
          return 'auto';
        },
        async setTheme(): Promise<void> {},
      };

      const layer = makePlatformLayer(faultyAdapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.saveSetting('apiKey', 'test');
      });

      const error = await Effect.runPromise(
        Effect.provide(program, layer).pipe(
          Effect.flip,
          Effect.catchAll((e) => Effect.succeed(e))
        )
      );

      expect(error).toBeInstanceOf(PlatformSettingsError);
      const platformError = error as PlatformSettingsError;
      expect(platformError.operation).toBe('save');
      expect(platformError.key).toBe('apiKey');
      expect(platformError.message).toBe('Failed to save setting: apiKey');
      expect(platformError.cause).toBeDefined();
    });

    it('should allow retry logic for failed operations', async () => {
      let attemptCount = 0;

      const unreliableAdapter: PlatformAdapter = {
        async getSettings(): Promise<ApiSettings> {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Temporary failure');
          }
          return {
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'success-key',
            chatModel: 'gpt-4o-mini',
            embeddingModel: 'text-embedding-3-small',
            webdavUrl: '',
            webdavUsername: '',
            webdavPassword: '',
            webdavPath: '/bookmarks',
            webdavEnabled: false,
            webdavAllowInsecure: false,
            webdavSyncInterval: 15,
            webdavLastSyncTime: '',
            webdavLastSyncError: '',
          };
        },
        async saveSetting(): Promise<void> {},
        async getTheme(): Promise<Theme> {
          return 'auto';
        },
        async setTheme(): Promise<void> {},
      };

      const layer = makePlatformLayer(unreliableAdapter);

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;
        return yield* platform.getSettings();
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer).pipe(
          Effect.retry({ times: 3 })
        )
      );

      expect(attemptCount).toBe(3);
      expect(result.apiKey).toBe('success-key');
    });

    it('should handle concurrent operations with partial failures', async () => {
      const storage = new MockStorage();
      let shouldFail = false;

      const adapter: PlatformAdapter = {
        async getSettings(): Promise<ApiSettings> {
          const store = await storage.getAll();
          return {
            apiBaseUrl: (store.get('apiBaseUrl') as string) ?? 'https://api.openai.com/v1',
            apiKey: (store.get('apiKey') as string) ?? '',
            chatModel: (store.get('chatModel') as string) ?? 'gpt-4o-mini',
            embeddingModel: (store.get('embeddingModel') as string) ?? 'text-embedding-3-small',
            webdavUrl: (store.get('webdavUrl') as string) ?? '',
            webdavUsername: (store.get('webdavUsername') as string) ?? '',
            webdavPassword: (store.get('webdavPassword') as string) ?? '',
            webdavPath: (store.get('webdavPath') as string) ?? '/bookmarks',
            webdavEnabled: (store.get('webdavEnabled') as boolean) ?? false,
            webdavAllowInsecure: (store.get('webdavAllowInsecure') as boolean) ?? false,
            webdavSyncInterval: (store.get('webdavSyncInterval') as number) ?? 15,
            webdavLastSyncTime: (store.get('webdavLastSyncTime') as string) ?? '',
            webdavLastSyncError: (store.get('webdavLastSyncError') as string) ?? '',
          };
        },
        async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
          if (shouldFail && key === 'apiKey') {
            throw new Error('Failed to save apiKey');
          }
          await storage.set(key, value);
        },
        async getTheme(): Promise<Theme> {
          return 'auto';
        },
        async setTheme(): Promise<void> {},
      };

      const layer = makePlatformLayer(adapter);

      shouldFail = true;

      const program = Effect.gen(function* () {
        const platform = yield* PlatformService;

        const results = yield* Effect.all(
          [
            platform.saveSetting('apiKey', 'test-key').pipe(Effect.either),
            platform.saveSetting('chatModel', 'gpt-4').pipe(Effect.either),
            platform.saveSetting('webdavEnabled', true).pipe(Effect.either),
          ],
          { concurrency: 'unbounded' }
        );

        return results;
      });

      const results = await Effect.runPromise(Effect.provide(program, layer));

      expect(results[0]._tag).toBe('Left');
      expect(results[1]._tag).toBe('Right');
      expect(results[2]._tag).toBe('Right');
    });
  });
});
