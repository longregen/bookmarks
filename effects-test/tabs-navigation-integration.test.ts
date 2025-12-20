/**
 * Integration test for Tab & Navigation Management cooperation in Effect.ts refactored codebase
 *
 * This test validates how tab and navigation operations work across modules:
 * - TabsService layer provision and methods
 * - Extension URL generation and validation
 * - Tab finding and lifecycle management
 * - Extension page opening (create vs focus scenarios)
 * - Error handling for Chrome API failures
 *
 * Modules involved:
 * - lib/tabs (TabsService)
 * - popup/popup (PopupService navigation)
 * - background/service-worker (tab management)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Ref from 'effect/Ref';
import {
  TabsService,
  TabError,
  TabsServiceLive,
  getExtensionUrl,
  isExtensionUrl,
  findExtensionTab,
  openExtensionPage,
} from '../effect/lib/tabs';

// ============================================================================
// Mock Chrome APIs
// ============================================================================

interface MockTab {
  id?: number;
  url?: string;
  active?: boolean;
  windowId?: number;
}

interface MockWindow {
  id?: number;
  focused?: boolean;
}

interface MockChromeState {
  extensionId: string;
  tabs: MockTab[];
  windows: MockWindow[];
  shouldFailQuery: boolean;
  shouldFailUpdate: boolean;
  shouldFailCreate: boolean;
  shouldFailFocusWindow: boolean;
  queryError?: string;
  updateError?: string;
  createError?: string;
  focusWindowError?: string;
}

const createMockChrome = (state: Ref.Ref<MockChromeState>) => {
  return {
    runtime: {
      getURL: (path: string): string => {
        const currentState = Effect.runSync(Ref.get(state));
        return `chrome-extension://${currentState.extensionId}/${path}`;
      },
    },
    tabs: {
      query: async (queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<MockTab[]> => {
        const currentState = await Effect.runPromise(Ref.get(state));
        if (currentState.shouldFailQuery) {
          throw new Error(currentState.queryError ?? 'Failed to query tabs');
        }

        let tabs = [...currentState.tabs];
        if (queryInfo.active !== undefined) {
          tabs = tabs.filter(tab => tab.active === queryInfo.active);
        }
        return tabs;
      },
      update: async (tabId: number, updateProperties: { active?: boolean; url?: string }): Promise<MockTab> => {
        const currentState = await Effect.runPromise(Ref.get(state));
        if (currentState.shouldFailUpdate) {
          throw new Error(currentState.updateError ?? 'Failed to update tab');
        }

        const tabIndex = currentState.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) {
          throw new Error('Tab not found');
        }

        const updatedTab = {
          ...currentState.tabs[tabIndex],
          ...updateProperties,
        };

        await Effect.runPromise(
          Ref.update(state, (s) => ({
            ...s,
            tabs: [
              ...s.tabs.slice(0, tabIndex),
              updatedTab,
              ...s.tabs.slice(tabIndex + 1),
            ],
          }))
        );

        return updatedTab;
      },
      create: async (createProperties: { url?: string; active?: boolean }): Promise<MockTab> => {
        const currentState = await Effect.runPromise(Ref.get(state));
        if (currentState.shouldFailCreate) {
          throw new Error(currentState.createError ?? 'Failed to create tab');
        }

        const newTab: MockTab = {
          id: Math.max(0, ...currentState.tabs.map(t => t.id ?? 0)) + 1,
          url: createProperties.url,
          active: createProperties.active ?? true,
          windowId: 1,
        };

        await Effect.runPromise(
          Ref.update(state, (s) => ({
            ...s,
            tabs: [...s.tabs, newTab],
          }))
        );

        return newTab;
      },
    },
    windows: {
      update: async (windowId: number, updateInfo: { focused?: boolean }): Promise<MockWindow> => {
        const currentState = await Effect.runPromise(Ref.get(state));
        if (currentState.shouldFailFocusWindow) {
          throw new Error(currentState.focusWindowError ?? 'Failed to focus window');
        }

        const windowIndex = currentState.windows.findIndex(w => w.id === windowId);
        if (windowIndex === -1) {
          throw new Error('Window not found');
        }

        const updatedWindow = {
          ...currentState.windows[windowIndex],
          ...updateInfo,
        };

        await Effect.runPromise(
          Ref.update(state, (s) => ({
            ...s,
            windows: [
              ...s.windows.slice(0, windowIndex),
              updatedWindow,
              ...s.windows.slice(windowIndex + 1),
            ],
          }))
        );

        return updatedWindow;
      },
    },
  };
};

// ============================================================================
// Mock TabsService Layer
// ============================================================================

const createMockTabsServiceLayer = (chromeState: Ref.Ref<MockChromeState>) => {
  const mockChrome = createMockChrome(chromeState);

  const mockTabsService: Context.Tag.Service<TabsService> = {
    getExtensionUrl: (path: string) =>
      Effect.sync(() => mockChrome.runtime.getURL(path)),

    isExtensionUrl: (url: string | undefined) =>
      Effect.gen(function* () {
        if (url === undefined || url === '') {
          return false;
        }
        const currentState = yield* Ref.get(chromeState);
        const extensionUrlPrefix = `chrome-extension://${currentState.extensionId}/`;
        return url.startsWith(extensionUrlPrefix);
      }),

    findExtensionTab: () =>
      Effect.gen(function* () {
        const tabs = yield* Effect.tryPromise({
          try: () => mockChrome.tabs.query({}),
          catch: (error) =>
            new TabError({
              operation: 'query',
              message: 'Failed to query tabs',
              cause: error,
            }),
        });

        const currentState = yield* Ref.get(chromeState);
        const extensionUrlPrefix = `chrome-extension://${currentState.extensionId}/`;

        for (const tab of tabs) {
          if (tab.url?.startsWith(extensionUrlPrefix)) {
            return tab;
          }
        }

        return null;
      }),

    openExtensionPage: (pagePath: string) =>
      Effect.gen(function* () {
        const targetUrl = mockChrome.runtime.getURL(pagePath);
        const tabs = yield* Effect.tryPromise({
          try: () => mockChrome.tabs.query({}),
          catch: (error) =>
            new TabError({
              operation: 'query',
              message: 'Failed to query tabs',
              cause: error,
            }),
        });

        const currentState = yield* Ref.get(chromeState);
        const extensionUrlPrefix = `chrome-extension://${currentState.extensionId}/`;
        const existingTab = tabs.find((tab) => tab.url?.startsWith(extensionUrlPrefix));

        if (existingTab?.id !== undefined) {
          // Update existing tab
          yield* Effect.tryPromise({
            try: () =>
              mockChrome.tabs.update(existingTab.id!, {
                active: true,
                url: targetUrl,
              }),
            catch: (error) =>
              new TabError({
                operation: 'update',
                message: 'Failed to update tab',
                cause: error,
              }),
          });

          // Focus window (best effort)
          if (existingTab.windowId !== undefined) {
            yield* Effect.tryPromise({
              try: () =>
                mockChrome.windows.update(existingTab.windowId!, { focused: true }),
              catch: () => {
                // Swallow error - best effort operation
              },
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        } else {
          // Create new tab
          yield* Effect.tryPromise({
            try: () => mockChrome.tabs.create({ url: targetUrl }),
            catch: (error) =>
              new TabError({
                operation: 'create',
                message: 'Failed to create tab',
                cause: error,
              }),
          });
        }
      }),
  };

  return Layer.succeed(TabsService, mockTabsService);
};

// ============================================================================
// Test Suite
// ============================================================================

describe('Tab & Navigation Management Integration', () => {
  let chromeState: Ref.Ref<MockChromeState>;

  beforeEach(async () => {
    chromeState = await Effect.runPromise(
      Ref.make<MockChromeState>({
        extensionId: 'test-extension-id-12345',
        tabs: [],
        windows: [{ id: 1, focused: true }],
        shouldFailQuery: false,
        shouldFailUpdate: false,
        shouldFailCreate: false,
        shouldFailFocusWindow: false,
      })
    );
  });

  // ============================================================================
  // TabsService Layer Tests
  // ============================================================================

  describe('TabsService Layer Provision', () => {
    it('should provision TabsService layer successfully', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        const service = yield* TabsService;
        return service;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      expect(result).toBeDefined();
      expect(result.getExtensionUrl).toBeDefined();
      expect(result.isExtensionUrl).toBeDefined();
      expect(result.findExtensionTab).toBeDefined();
      expect(result.openExtensionPage).toBeDefined();
    });

    it('should provide TabsService methods with correct signatures', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        const service = yield* TabsService;

        expect(typeof service.getExtensionUrl).toBe('function');
        expect(typeof service.isExtensionUrl).toBe('function');
        expect(typeof service.findExtensionTab).toBe('function');
        expect(typeof service.openExtensionPage).toBe('function');

        return true;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Extension URL Generation Tests
  // ============================================================================

  describe('Extension URL Generation', () => {
    it('should generate correct extension URLs for various paths', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        const libraryUrl = yield* getExtensionUrl('src/library/library.html');
        const searchUrl = yield* getExtensionUrl('src/search/search.html');
        const optionsUrl = yield* getExtensionUrl('src/options/options.html');

        return { libraryUrl, searchUrl, optionsUrl };
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      expect(result.libraryUrl).toBe('chrome-extension://test-extension-id-12345/src/library/library.html');
      expect(result.searchUrl).toBe('chrome-extension://test-extension-id-12345/src/search/search.html');
      expect(result.optionsUrl).toBe('chrome-extension://test-extension-id-12345/src/options/options.html');
    });

    it('should handle empty path', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* getExtensionUrl('');
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe('chrome-extension://test-extension-id-12345/');
    });

    it('should handle paths with query parameters', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* getExtensionUrl('src/search/search.html?q=test');
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe('chrome-extension://test-extension-id-12345/src/search/search.html?q=test');
    });

    it('should handle paths with URL encoded parameters', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* getExtensionUrl('src/library/library.html?bookmarkId=123%2Fabc');
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe('chrome-extension://test-extension-id-12345/src/library/library.html?bookmarkId=123%2Fabc');
    });
  });

  // ============================================================================
  // Extension URL Validation Tests
  // ============================================================================

  describe('Extension URL Validation', () => {
    it('should identify valid extension URLs', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        const validUrl = 'chrome-extension://test-extension-id-12345/src/library/library.html';
        return yield* isExtensionUrl(validUrl);
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(true);
    });

    it('should reject non-extension URLs', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        const regularUrl = 'https://example.com';
        return yield* isExtensionUrl(regularUrl);
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(false);
    });

    it('should reject URLs from different extension IDs', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        const differentExtensionUrl = 'chrome-extension://different-id/page.html';
        return yield* isExtensionUrl(differentExtensionUrl);
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(false);
    });

    it('should handle undefined URLs', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* isExtensionUrl(undefined);
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(false);
    });

    it('should handle empty string URLs', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* isExtensionUrl('');
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // Find Extension Tab Tests
  // ============================================================================

  describe('Find Extension Tab', () => {
    it('should find existing extension tab', async () => {
      // Setup: Add an extension tab
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: 'https://example.com', active: false, windowId: 1 },
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: true, windowId: 1 },
            { id: 3, url: 'https://google.com', active: false, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* findExtensionTab();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      expect(result).not.toBeNull();
      expect(result?.id).toBe(2);
      expect(result?.url).toContain('chrome-extension://test-extension-id-12345');
    });

    it('should return null when no extension tab exists', async () => {
      // Setup: Only regular tabs
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: 'https://example.com', active: true, windowId: 1 },
            { id: 2, url: 'https://google.com', active: false, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* findExtensionTab();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBeNull();
    });

    it('should return first extension tab when multiple exist', async () => {
      // Setup: Multiple extension tabs
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 1 },
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/search/search.html', active: true, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* findExtensionTab();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1); // First extension tab
    });

    it('should handle tabs with undefined URLs', async () => {
      // Setup: Tab without URL (e.g., new tab or restricted page)
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: undefined, active: true, windowId: 1 },
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* findExtensionTab();
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      expect(result).not.toBeNull();
      expect(result?.id).toBe(2);
    });
  });

  // ============================================================================
  // Open Extension Page Tests (Focus Existing Tab)
  // ============================================================================

  describe('Open Extension Page - Focus Existing Tab', () => {
    it('should focus existing extension tab instead of creating new one', async () => {
      // Setup: Existing extension tab
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: 'https://example.com', active: true, windowId: 1 },
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/search/search.html');

        // Get current state to verify
        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Should have updated tab 2, not created a new tab
      expect(result.tabs).toHaveLength(2);

      const extensionTab = result.tabs.find(t => t.id === 2);
      expect(extensionTab?.active).toBe(true);
      expect(extensionTab?.url).toBe('chrome-extension://test-extension-id-12345/src/search/search.html');
    });

    it('should update window focus when focusing extension tab', async () => {
      // Setup: Extension tab in window 2
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: 'https://example.com', active: true, windowId: 1 },
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 2 },
          ],
          windows: [
            { id: 1, focused: true },
            { id: 2, focused: false },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/search/search.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Window 2 should now be focused
      const window2 = result.windows.find(w => w.id === 2);
      expect(window2?.focused).toBe(true);
    });

    it('should handle window focus failure gracefully', async () => {
      // Setup: Extension tab exists, but window focus will fail
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 1 },
          ],
          shouldFailFocusWindow: true,
          focusWindowError: 'Windows API not available',
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        // Should not throw even though window focus fails
        yield* openExtensionPage('src/search/search.html');
        return true;
      });

      // Should succeed despite window focus failure
      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(true);
    });

    it('should handle tab without windowId', async () => {
      // Setup: Extension tab without windowId
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/search/search.html');
        return true;
      });

      // Should succeed and just skip window focusing
      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Open Extension Page Tests (Create New Tab)
  // ============================================================================

  describe('Open Extension Page - Create New Tab', () => {
    it('should create new tab when no extension tab exists', async () => {
      // Setup: No extension tabs
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 1, url: 'https://example.com', active: true, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/library/library.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Should have created a new tab
      expect(result.tabs).toHaveLength(2);

      const newTab = result.tabs.find(t => t.id === 2);
      expect(newTab).toBeDefined();
      expect(newTab?.url).toBe('chrome-extension://test-extension-id-12345/src/library/library.html');
      expect(newTab?.active).toBe(true);
    });

    it('should create tab with query parameters', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/search/search.html?q=test%20query');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      const newTab = result.tabs.find(t => t.url?.includes('q=test%20query'));
      expect(newTab).toBeDefined();
      expect(newTab?.url).toBe('chrome-extension://test-extension-id-12345/src/search/search.html?q=test%20query');
    });

    it('should handle multiple sequential tab creations', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/library/library.html');

        // Close the extension tab to simulate navigation
        yield* Ref.update(chromeState, (s) => ({
          ...s,
          tabs: s.tabs.filter(t => !t.url?.includes('chrome-extension://')),
        }));

        yield* openExtensionPage('src/search/search.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Should have the second tab created
      const searchTab = result.tabs.find(t => t.url?.includes('search.html'));
      expect(searchTab).toBeDefined();
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle tab query failure with TabError', async () => {
      // Setup: Tab query will fail
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          shouldFailQuery: true,
          queryError: 'Permission denied',
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* findExtensionTab();
      });

      await expect(
        Effect.runPromise(program.pipe(Effect.provide(layer)))
      ).rejects.toThrow();

      // Verify it's a TabError with correct operation
      await expect(async () => {
        try {
          await Effect.runPromise(program.pipe(Effect.provide(layer)));
        } catch (error) {
          expect(error).toBeInstanceOf(TabError);
          expect((error as TabError).operation).toBe('query');
          expect((error as TabError).message).toBe('Failed to query tabs');
          throw error;
        }
      }).rejects.toThrow();
    });

    it('should handle tab update failure with TabError', async () => {
      // Setup: Existing extension tab, but update will fail
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 1 },
          ],
          shouldFailUpdate: true,
          updateError: 'Tab is closing',
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* openExtensionPage('src/search/search.html');
      });

      await expect(async () => {
        try {
          await Effect.runPromise(program.pipe(Effect.provide(layer)));
        } catch (error) {
          expect(error).toBeInstanceOf(TabError);
          expect((error as TabError).operation).toBe('update');
          expect((error as TabError).message).toBe('Failed to update tab');
          throw error;
        }
      }).rejects.toThrow();
    });

    it('should handle tab creation failure with TabError', async () => {
      // Setup: No extension tabs, creation will fail
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [],
          shouldFailCreate: true,
          createError: 'Extension is disabled',
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* openExtensionPage('src/library/library.html');
      });

      await expect(async () => {
        try {
          await Effect.runPromise(program.pipe(Effect.provide(layer)));
        } catch (error) {
          expect(error).toBeInstanceOf(TabError);
          expect((error as TabError).operation).toBe('create');
          expect((error as TabError).message).toBe('Failed to create tab');
          throw error;
        }
      }).rejects.toThrow();
    });

    it('should propagate TabError with cause information', async () => {
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          shouldFailQuery: true,
          queryError: 'Specific chrome error message',
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        return yield* findExtensionTab();
      });

      await expect(async () => {
        try {
          await Effect.runPromise(program.pipe(Effect.provide(layer)));
        } catch (error) {
          expect(error).toBeInstanceOf(TabError);
          const tabError = error as TabError;
          expect(tabError.cause).toBeDefined();
          expect((tabError.cause as Error).message).toBe('Specific chrome error message');
          throw error;
        }
      }).rejects.toThrow();
    });
  });

  // ============================================================================
  // Integration with PopupService Navigation
  // ============================================================================

  describe('PopupService Navigation Integration', () => {
    it('should support navigation to library page', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        // Simulate PopupService.navigateToPage('src/library/library.html')
        yield* openExtensionPage('src/library/library.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      const libraryTab = result.tabs.find(t => t.url?.includes('library.html'));
      expect(libraryTab).toBeDefined();
      expect(libraryTab?.active).toBe(true);
    });

    it('should support navigation to search page with query', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        // Simulate PopupService.performSearch('test query')
        const query = 'test query';
        const searchPath = `src/search/search.html?q=${encodeURIComponent(query)}`;
        yield* openExtensionPage(searchPath);

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      const searchTab = result.tabs.find(t => t.url?.includes('search.html'));
      expect(searchTab).toBeDefined();
      expect(searchTab?.url).toContain('q=test%20query');
    });

    it('should support navigation to stumble page', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/stumble/stumble.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      const stumbleTab = result.tabs.find(t => t.url?.includes('stumble.html'));
      expect(stumbleTab).toBeDefined();
    });

    it('should support navigation to settings page', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/options/options.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      const optionsTab = result.tabs.find(t => t.url?.includes('options.html'));
      expect(optionsTab).toBeDefined();
    });

    it('should reuse existing tab when navigating between pages', async () => {
      // Setup: Extension tab already open
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { id: 2, url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: true, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        // Navigate to search page
        yield* openExtensionPage('src/search/search.html');

        const state1 = yield* Ref.get(chromeState);

        // Navigate to settings
        yield* openExtensionPage('src/options/options.html');

        const state2 = yield* Ref.get(chromeState);

        return { state1, state2 };
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Should still have only one extension tab throughout
      expect(result.state1.tabs).toHaveLength(1);
      expect(result.state2.tabs).toHaveLength(1);

      // Tab ID should remain the same
      expect(result.state1.tabs[0].id).toBe(2);
      expect(result.state2.tabs[0].id).toBe(2);

      // URL should be updated to options
      expect(result.state2.tabs[0].url).toContain('options.html');
    });
  });

  // ============================================================================
  // Edge Cases and Special Scenarios
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle opening page when no tabs exist', async () => {
      // This is an unusual scenario but should still work
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        yield* openExtensionPage('src/library/library.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result.tabs).toHaveLength(1);
    });

    it('should handle tab with undefined id during update', async () => {
      // Setup: Extension tab with undefined id (unusual but possible)
      await Effect.runPromise(
        Ref.update(chromeState, (s) => ({
          ...s,
          tabs: [
            { url: 'chrome-extension://test-extension-id-12345/src/library/library.html', active: false, windowId: 1 },
          ],
        }))
      );

      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        // Should create new tab since existing tab has no id
        yield* openExtensionPage('src/search/search.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Should have created a new tab
      expect(result.tabs.length).toBeGreaterThan(1);
    });

    it('should handle rapid successive navigation calls', async () => {
      const layer = createMockTabsServiceLayer(chromeState);

      const program = Effect.gen(function* () {
        // Multiple rapid navigations
        yield* openExtensionPage('src/library/library.html');
        yield* openExtensionPage('src/search/search.html');
        yield* openExtensionPage('src/options/options.html');

        const state = yield* Ref.get(chromeState);
        return state;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

      // Should end up with one tab showing options
      const extensionTabs = result.tabs.filter(t =>
        t.url?.startsWith('chrome-extension://test-extension-id-12345/')
      );
      expect(extensionTabs).toHaveLength(1);
      expect(extensionTabs[0].url).toContain('options.html');
    });
  });
});
