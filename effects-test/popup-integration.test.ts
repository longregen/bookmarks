import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import type { SaveBookmarkResponse } from '../effect/lib/messages';
import { MessagingService, MessagingError } from '../effect/lib/messages';
import { TabsService, TabError } from '../effect/lib/tabs';
import { SettingsService, SettingsError } from '../effect/lib/settings';

// ============================================================================
// Typed Errors (re-defined to avoid importing popup.ts with side effects)
// ============================================================================

export class ScriptingError extends Data.TaggedError('ScriptingError')<{
  readonly operation: 'execute_script' | 'query_tab' | 'inject_content';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BookmarkSaveError extends Data.TaggedError('BookmarkSaveError')<{
  readonly reason:
    | 'no_active_tab'
    | 'no_tab_id'
    | 'no_url'
    | 'restricted_scheme'
    | 'incognito_mode'
    | 'permission_denied'
    | 'script_failed'
    | 'save_failed'
    | 'unknown';
  readonly message: string;
  readonly url?: string;
  readonly cause?: unknown;
}> {}

export class PopupError extends Data.TaggedError('PopupError')<{
  readonly operation: 'init' | 'save_bookmark' | 'check_config' | 'navigation';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Services (re-defined to avoid importing popup.ts with side effects)
// ============================================================================

export class ChromeScriptingService extends Context.Tag('ChromeScriptingService')<
  ChromeScriptingService,
  {
    readonly queryActiveTab: () => Effect.Effect<chrome.tabs.Tab, ScriptingError, never>;
    readonly executeScript: <T>(
      tabId: number,
      func: () => Promise<T>
    ) => Effect.Effect<T, ScriptingError, never>;
  }
>() {}

export class PopupService extends Context.Tag('PopupService')<
  PopupService,
  {
    readonly saveCurrentPage: () => Effect.Effect<
      SaveBookmarkResponse,
      BookmarkSaveError | ScriptingError | MessagingError,
      never
    >;
    readonly navigateToPage: (pagePath: string) => Effect.Effect<void, TabError, never>;
    readonly performSearch: (query: string) => Effect.Effect<void, TabError, never>;
    readonly checkEndpointConfiguration: () => Effect.Effect<
      boolean,
      SettingsError,
      never
    >;
  }
>() {}

// ============================================================================
// Mock Services
// ============================================================================

const createMockChromeScriptingService = (
  overrides: Partial<{
    queryActiveTab: typeof ChromeScriptingService.Service['queryActiveTab'];
    executeScript: typeof ChromeScriptingService.Service['executeScript'];
  }> = {}
) => {
  return Layer.succeed(ChromeScriptingService, {
    queryActiveTab:
      overrides.queryActiveTab ??
      (() =>
        Effect.succeed({
          id: 123,
          url: 'https://example.com',
          title: 'Example Page',
          active: true,
          windowId: 1,
        } as chrome.tabs.Tab)),

    executeScript:
      overrides.executeScript ??
      (<T>(_tabId: number, _func: () => Promise<T>) =>
        Effect.succeed({
          success: true,
          bookmarkId: 'bookmark-123',
        } as T)),
  });
};

const createMockMessagingService = (
  overrides: Partial<{
    sendMessage: typeof MessagingService.Service['sendMessage'];
    addMessageListener: typeof MessagingService.Service['addMessageListener'];
    broadcastEvent: typeof MessagingService.Service['broadcastEvent'];
  }> = {}
) => {
  return Layer.succeed(MessagingService, {
    sendMessage:
      overrides.sendMessage ??
      (() =>
        Effect.succeed({
          success: true,
          bookmarkId: 'bookmark-123',
        } as SaveBookmarkResponse)),

    addMessageListener:
      overrides.addMessageListener ?? (() => Effect.succeed(() => {})),

    broadcastEvent: overrides.broadcastEvent ?? (() => Effect.succeed(undefined)),
  });
};

const createMockTabsService = (
  overrides: Partial<{
    getExtensionUrl: typeof TabsService.Service['getExtensionUrl'];
    isExtensionUrl: typeof TabsService.Service['isExtensionUrl'];
    findExtensionTab: typeof TabsService.Service['findExtensionTab'];
    openExtensionPage: typeof TabsService.Service['openExtensionPage'];
  }> = {}
) => {
  return Layer.succeed(TabsService, {
    getExtensionUrl:
      overrides.getExtensionUrl ??
      ((path: string) => Effect.succeed(`chrome-extension://test-id/${path}`)),

    isExtensionUrl:
      overrides.isExtensionUrl ?? ((url: string | undefined) => Effect.succeed(false)),

    findExtensionTab: overrides.findExtensionTab ?? (() => Effect.succeed(null)),

    openExtensionPage: overrides.openExtensionPage ?? (() => Effect.void),
  });
};

const createMockSettingsService = (
  overrides: Partial<{
    getSettings: typeof SettingsService.Service['getSettings'];
    saveSetting: typeof SettingsService.Service['saveSetting'];
  }> = {}
) => {
  return Layer.succeed(SettingsService, {
    getSettings:
      overrides.getSettings ??
      (() =>
        Effect.succeed({
          apiKey: 'test-api-key',
          apiEndpoint: 'https://api.example.com',
          model: 'gpt-4',
          provider: 'openai',
        })),

    saveSetting: overrides.saveSetting ?? (() => Effect.void),
  });
};

// ============================================================================
// Helper to create PopupService with mocks
// ============================================================================

const createPopupServiceLayer = (mocks: {
  scripting?: ReturnType<typeof createMockChromeScriptingService>;
  messaging?: ReturnType<typeof createMockMessagingService>;
  tabs?: ReturnType<typeof createMockTabsService>;
  settings?: ReturnType<typeof createMockSettingsService>;
}) => {
  const scriptingLayer = mocks.scripting ?? createMockChromeScriptingService();
  const messagingLayer = mocks.messaging ?? createMockMessagingService();
  const tabsLayer = mocks.tabs ?? createMockTabsService();
  const settingsLayer = mocks.settings ?? createMockSettingsService();

  // Create PopupService implementation that uses the other services
  const makePopupService = Effect.gen(function* () {
    const scriptingService = yield* ChromeScriptingService;
    const messagingService = yield* MessagingService;
    const tabsService = yield* TabsService;
    const settingsService = yield* SettingsService;

    return {
      saveCurrentPage: () =>
        Effect.gen(function* () {
          const tab = yield* scriptingService.queryActiveTab();

          if (tab.id === undefined) {
            return yield* Effect.fail(
              new BookmarkSaveError({
                reason: 'no_tab_id',
                message: 'No active tab found',
              })
            );
          }

          if (tab.url === undefined || tab.url === '') {
            return yield* Effect.fail(
              new BookmarkSaveError({
                reason: 'no_url',
                message: 'Cannot save in incognito mode or restricted URLs',
              })
            );
          }

          const restrictedSchemes = [
            'chrome:',
            'about:',
            'chrome-extension:',
            'edge:',
            'moz-extension:',
          ];

          const isRestricted = restrictedSchemes.some((scheme) =>
            tab.url?.startsWith(scheme)
          );

          if (isRestricted) {
            return yield* Effect.fail(
              new BookmarkSaveError({
                reason: 'restricted_scheme',
                message: 'Cannot save browser internal pages',
                url: tab.url,
              })
            );
          }

          const result = yield* scriptingService.executeScript(
            tab.id,
            async () => {
              return {
                success: true,
                bookmarkId: 'bookmark-123',
              } as SaveBookmarkResponse;
            }
          );

          if (result === undefined || result === null) {
            return yield* Effect.fail(
              new BookmarkSaveError({
                reason: 'save_failed',
                message: 'No response from bookmark save',
                url: tab.url,
              })
            );
          }

          return result;
        }),

      navigateToPage: (pagePath: string) =>
        Effect.gen(function* () {
          yield* tabsService.openExtensionPage(pagePath);
        }),

      performSearch: (query: string) =>
        Effect.gen(function* () {
          const searchPath =
            query.trim() !== ''
              ? `src/search/search.html?q=${encodeURIComponent(query)}`
              : 'src/search/search.html';

          yield* tabsService.openExtensionPage(searchPath);
        }),

      checkEndpointConfiguration: () =>
        Effect.gen(function* () {
          const settings = yield* settingsService.getSettings();
          return settings.apiKey !== undefined && settings.apiKey !== '';
        }),
    };
  });

  const popupServiceLayer = Layer.effect(PopupService, makePopupService);

  // Provide the base services to the popup service layer, then merge
  return popupServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(scriptingLayer, messagingLayer, tabsLayer, settingsLayer)
    )
  );
};

// ============================================================================
// Tests: PopupService Mock Layer
// ============================================================================

describe('Popup Actions Integration', () => {
  describe('PopupService Mock Layer', () => {
    it('should successfully initialize PopupService with all mock dependencies', async () => {
      const testLayer = createPopupServiceLayer({});

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        expect(popupService).toBeDefined();
        expect(popupService.saveCurrentPage).toBeInstanceOf(Function);
        expect(popupService.navigateToPage).toBeInstanceOf(Function);
        expect(popupService.performSearch).toBeInstanceOf(Function);
        expect(popupService.checkEndpointConfiguration).toBeInstanceOf(Function);
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    });

    it('should allow custom mock implementations', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 999,
            url: 'https://custom.com',
            title: 'Custom Tab',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        const result = yield* popupService.saveCurrentPage();
        return result;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
      expect(result.success).toBe(true);
      expect(result.bookmarkId).toBe('bookmark-123');
    });
  });

  // ============================================================================
  // Tests: saveCurrentPage Flow
  // ============================================================================

  describe('saveCurrentPage Flow', () => {
    it('should successfully save a bookmark from the current page', async () => {
      const testLayer = createPopupServiceLayer({});

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        const result = yield* popupService.saveCurrentPage();
        return result;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
      expect(result.success).toBe(true);
      expect(result.bookmarkId).toBe('bookmark-123');
    });

    it('should fail when no tab ID is available', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            url: 'https://example.com',
            title: 'Example',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('no_tab_id');
      }
    });

    it('should fail when tab has no URL', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 123,
            title: 'Example',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('no_url');
      }
    });

    it('should fail for restricted chrome:// scheme', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 123,
            url: 'chrome://settings',
            title: 'Settings',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('restricted_scheme');
        expect(result.left.url).toBe('chrome://settings');
      }
    });

    it('should fail for restricted about: scheme', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 123,
            url: 'about:blank',
            title: 'Blank',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('restricted_scheme');
        expect(result.left.url).toBe('about:blank');
      }
    });

    it('should fail for restricted chrome-extension:// scheme', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 123,
            url: 'chrome-extension://test-id/popup.html',
            title: 'Extension Page',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('restricted_scheme');
      }
    });

    it('should handle script execution failures', async () => {
      const customScriptingService = createMockChromeScriptingService({
        executeScript: () =>
          Effect.fail(
            new ScriptingError({
              operation: 'execute_script',
              message: 'Script execution failed',
            })
          ),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ScriptingError);
        expect(result.left.operation).toBe('execute_script');
      }
    });

    it('should fail when script returns null response', async () => {
      const customScriptingService = createMockChromeScriptingService({
        executeScript: () => Effect.succeed(null as any),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('save_failed');
      }
    });

    it('should handle successful save with updated bookmark', async () => {
      const customScriptingService = createMockChromeScriptingService({
        executeScript: () =>
          Effect.succeed({
            success: true,
            bookmarkId: 'existing-bookmark',
            updated: true,
          } as SaveBookmarkResponse),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result.success).toBe(true);
      expect(result.bookmarkId).toBe('existing-bookmark');
      expect(result.updated).toBe(true);
    });
  });

  // ============================================================================
  // Tests: Navigation to Extension Pages
  // ============================================================================

  describe('Navigation to Extension Pages', () => {
    it('should navigate to library page', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.navigateToPage('src/library/library.html');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/library/library.html');
    });

    it('should navigate to search page', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.navigateToPage('src/search/search.html');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/search/search.html');
    });

    it('should navigate to settings page', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.navigateToPage('src/options/options.html');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/options/options.html');
    });

    it('should handle navigation errors', async () => {
      const customTabsService = createMockTabsService({
        openExtensionPage: () =>
          Effect.fail(
            new TabError({
              operation: 'create',
              message: 'Failed to create tab',
            })
          ),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.navigateToPage('src/library/library.html');
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(TabError);
        expect(result.left.operation).toBe('create');
      }
    });
  });

  // ============================================================================
  // Tests: Search Query Handling
  // ============================================================================

  describe('Search Query Handling', () => {
    it('should perform search with query parameter', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.performSearch('typescript patterns');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/search/search.html?q=typescript%20patterns');
    });

    it('should navigate to search page without query when empty', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.performSearch('');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/search/search.html');
    });

    it('should navigate to search page when query is only whitespace', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.performSearch('   ');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/search/search.html');
    });

    it('should properly encode special characters in search query', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.performSearch('hello & goodbye');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe('src/search/search.html?q=hello%20%26%20goodbye');
    });

    it('should handle UTF-8 characters in search query', async () => {
      let navigatedTo: string | null = null;

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigatedTo = pagePath;
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        yield* popupService.performSearch('日本語 search');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(navigatedTo).toBe(
        'src/search/search.html?q=%E6%97%A5%E6%9C%AC%E8%AA%9E%20search'
      );
    });
  });

  // ============================================================================
  // Tests: Endpoint Configuration Check
  // ============================================================================

  describe('Endpoint Configuration Check', () => {
    it('should return true when API key is configured', async () => {
      const testLayer = createPopupServiceLayer({});

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.checkEndpointConfiguration();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(true);
    });

    it('should return false when API key is empty', async () => {
      const customSettingsService = createMockSettingsService({
        getSettings: () =>
          Effect.succeed({
            apiKey: '',
            apiEndpoint: 'https://api.example.com',
            model: 'gpt-4',
            provider: 'openai',
          }),
      });

      const testLayer = createPopupServiceLayer({
        settings: customSettingsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.checkEndpointConfiguration();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(false);
    });

    it('should return false when API key is undefined', async () => {
      const customSettingsService = createMockSettingsService({
        getSettings: () =>
          Effect.succeed({
            apiKey: undefined as any,
            apiEndpoint: 'https://api.example.com',
            model: 'gpt-4',
            provider: 'openai',
          }),
      });

      const testLayer = createPopupServiceLayer({
        settings: customSettingsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.checkEndpointConfiguration();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(false);
    });

    it('should handle settings read errors', async () => {
      const customSettingsService = createMockSettingsService({
        getSettings: () =>
          Effect.fail(
            new SettingsError({
              operation: 'read',
              message: 'Failed to read settings',
            })
          ),
      });

      const testLayer = createPopupServiceLayer({
        settings: customSettingsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.checkEndpointConfiguration();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(SettingsError);
        expect(result.left.operation).toBe('read');
      }
    });
  });

  // ============================================================================
  // Tests: Error States
  // ============================================================================

  describe('Error States', () => {
    it('should handle ChromeScriptingService errors when querying active tab', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.fail(
            new ScriptingError({
              operation: 'query_tab',
              message: 'No active tab found',
            })
          ),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ScriptingError);
        expect(result.left.operation).toBe('query_tab');
      }
    });

    it('should handle permission denied errors', async () => {
      const customScriptingService = createMockChromeScriptingService({
        executeScript: () =>
          Effect.fail(
            new ScriptingError({
              operation: 'execute_script',
              message: 'Cannot access contents of the page',
            })
          ),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ScriptingError);
        expect(result.left.message).toContain('Cannot access contents');
      }
    });

    it('should handle all restricted page schemes', async () => {
      const restrictedUrls = [
        'chrome://settings',
        'about:blank',
        'chrome-extension://test/page.html',
        'edge://settings',
        'moz-extension://test/page.html',
      ];

      for (const url of restrictedUrls) {
        const customScriptingService = createMockChromeScriptingService({
          queryActiveTab: () =>
            Effect.succeed({
              id: 123,
              url,
              title: 'Restricted Page',
              active: true,
            } as chrome.tabs.Tab),
        });

        const testLayer = createPopupServiceLayer({
          scripting: customScriptingService,
        });

        const program = Effect.gen(function* () {
          const popupService = yield* PopupService;
          return yield* popupService.saveCurrentPage();
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(testLayer), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(BookmarkSaveError);
          expect(result.left.reason).toBe('restricted_scheme');
        }
      }
    });

    it('should handle incognito mode (empty URL)', async () => {
      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 123,
            url: '',
            title: 'Incognito',
            active: true,
            incognito: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.reason).toBe('no_url');
      }
    });

    it('should provide detailed error context for BookmarkSaveError', async () => {
      const testUrl = 'chrome://settings/privacy';

      const customScriptingService = createMockChromeScriptingService({
        queryActiveTab: () =>
          Effect.succeed({
            id: 123,
            url: testUrl,
            title: 'Privacy Settings',
            active: true,
          } as chrome.tabs.Tab),
      });

      const testLayer = createPopupServiceLayer({
        scripting: customScriptingService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkSaveError);
        expect(result.left.url).toBe(testUrl);
        expect(result.left.message).toBe('Cannot save browser internal pages');
      }
    });
  });

  // ============================================================================
  // Tests: Integration - Full Workflows
  // ============================================================================

  describe('Integration - Full Workflows', () => {
    it('should complete full workflow: check config, save bookmark, navigate', async () => {
      let navigationCalls: string[] = [];

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigationCalls.push(pagePath);
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;

        const hasApiKey = yield* popupService.checkEndpointConfiguration();
        expect(hasApiKey).toBe(true);

        const saveResult = yield* popupService.saveCurrentPage();
        expect(saveResult.success).toBe(true);

        yield* popupService.navigateToPage(
          `src/library/library.html?bookmarkId=${saveResult.bookmarkId}`
        );

        return { hasApiKey, saveResult, navigationCalls };
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result.hasApiKey).toBe(true);
      expect(result.saveResult.success).toBe(true);
      expect(result.navigationCalls).toHaveLength(1);
      expect(result.navigationCalls[0]).toBe(
        'src/library/library.html?bookmarkId=bookmark-123'
      );
    });

    it('should handle workflow with missing API key', async () => {
      const customSettingsService = createMockSettingsService({
        getSettings: () =>
          Effect.succeed({
            apiKey: '',
            apiEndpoint: '',
            model: '',
            provider: '',
          }),
      });

      const testLayer = createPopupServiceLayer({
        settings: customSettingsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;
        const hasApiKey = yield* popupService.checkEndpointConfiguration();
        return hasApiKey;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(false);
    });

    it('should handle multiple sequential operations', async () => {
      let navigationLog: string[] = [];

      const customTabsService = createMockTabsService({
        openExtensionPage: (pagePath: string) =>
          Effect.sync(() => {
            navigationLog.push(pagePath);
          }),
      });

      const testLayer = createPopupServiceLayer({
        tabs: customTabsService,
      });

      const program = Effect.gen(function* () {
        const popupService = yield* PopupService;

        yield* popupService.performSearch('react hooks');
        yield* popupService.navigateToPage('src/library/library.html');
        yield* popupService.navigateToPage('src/options/options.html');

        return navigationLog;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('src/search/search.html?q=react%20hooks');
      expect(result[1]).toBe('src/library/library.html');
      expect(result[2]).toBe('src/options/options.html');
    });
  });
});
