import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { showStatusMessage, getElement, createElement } from '../../src/ui/dom';
import { openExtensionPage as openExtensionPageOrig } from '../../src/lib/tabs';
import type { SaveBookmarkResponse } from '../lib/messages';
import { getErrorMessage } from '../lib/errors';
import { TabsService, TabError, openExtensionPage } from '../lib/tabs';
import { SettingsService, SettingsError } from '../lib/settings';
import { MessagingService, MessagingError, sendMessage } from '../lib/messages';
import { setupThemeOnly, initializePlatform } from '../shared/ui-init';

// ============================================================================
// Typed Errors
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
// Services
// ============================================================================

/**
 * Service for Chrome scripting API operations
 */
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

/**
 * Service for popup-specific operations
 */
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
// Service Implementations
// ============================================================================

const makeChromeScriptingService = (): Effect.Effect<
  Context.Tag.Service<ChromeScriptingService>,
  never,
  never
> =>
  Effect.sync(() => ({
    queryActiveTab: () =>
      Effect.tryPromise({
        try: async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs.length === 0 || tabs[0] === undefined) {
            throw new ScriptingError({
              operation: 'query_tab',
              message: 'No active tab found',
            });
          }
          return tabs[0];
        },
        catch: (error) => {
          if (error instanceof ScriptingError) {
            return error;
          }
          return new ScriptingError({
            operation: 'query_tab',
            message: 'Failed to query active tab',
            cause: error,
          });
        },
      }),

    executeScript: <T>(tabId: number, func: () => Promise<T>) =>
      Effect.tryPromise({
        try: async () => {
          const results = await chrome.scripting.executeScript<T[], () => Promise<T>>({
            target: { tabId },
            func,
          });

          if (results.length === 0 || results[0]?.result === undefined) {
            throw new ScriptingError({
              operation: 'execute_script',
              message: 'Script execution returned no results',
            });
          }

          return results[0].result;
        },
        catch: (error) => {
          if (error instanceof ScriptingError) {
            return error;
          }
          return new ScriptingError({
            operation: 'execute_script',
            message: 'Failed to execute script',
            cause: error,
          });
        },
      }),
  }));

const makePopupService = (): Effect.Effect<
  Context.Tag.Service<PopupService>,
  never,
  ChromeScriptingService | MessagingService | TabsService | SettingsService
> =>
  Effect.gen(function* () {
    const scriptingService = yield* ChromeScriptingService;
    const messagingService = yield* MessagingService;
    const tabsService = yield* TabsService;
    const settingsService = yield* SettingsService;

    return {
      saveCurrentPage: () =>
        Effect.gen(function* () {
          // Query active tab
          const tab = yield* scriptingService.queryActiveTab();

          // Validate tab
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

          // Check for restricted schemes
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

          // Execute script to capture page data
          const result = yield* scriptingService.executeScript(
            tab.id,
            async () => {
              const url = location.href;
              const title = document.title;
              const html = document.documentElement.outerHTML;

              return (await chrome.runtime.sendMessage({
                type: 'bookmark:save_from_page',
                data: { url, title, html },
              })) as SaveBookmarkResponse;
            }
          );

          // Validate response
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

// ============================================================================
// Layers
// ============================================================================

export const ChromeScriptingServiceLive: Layer.Layer<
  ChromeScriptingService,
  never,
  never
> = Layer.effect(ChromeScriptingService, makeChromeScriptingService());

export const PopupServiceLive: Layer.Layer<
  PopupService,
  never,
  ChromeScriptingService | MessagingService | TabsService | SettingsService
> = Layer.effect(PopupService, makePopupService());

// ============================================================================
// UI Layer (traditional DOM manipulation with Effect for async operations)
// ============================================================================

// Get DOM elements
const saveBtn = getElement<HTMLButtonElement>('saveBtn');
const statusDiv = getElement<HTMLDivElement>('status');
const navLibrary = getElement<HTMLButtonElement>('navLibrary');
const navSearch = getElement<HTMLButtonElement>('navSearch');
const navStumble = getElement<HTMLButtonElement>('navStumble');
const navSettings = getElement<HTMLButtonElement>('navSettings');
const searchInput = getElement<HTMLInputElement>('searchInput');
const searchBtn = getElement<HTMLButtonElement>('searchBtn');

// ============================================================================
// UI Helper Functions
// ============================================================================

function showSuccessWithCTA(bookmarkId: string): void {
  statusDiv.className = 'status success success-with-cta';
  statusDiv.textContent = '';

  const message = createElement('span', {
    className: 'success-message',
    textContent: 'Bookmark saved!',
  });
  const ctaBtn = createElement('button', {
    className: 'btn-cta',
    textContent: 'View in Library',
  });
  ctaBtn.onclick = () => {
    void openExtensionPageOrig(`src/library/library.html?bookmarkId=${bookmarkId}`);
  };

  statusDiv.appendChild(message);
  statusDiv.appendChild(ctaBtn);
}

function showSaveSuccess(): void {
  saveBtn.disabled = true;
  saveBtn.classList.add('btn-success');
  saveBtn.textContent = '';
  saveBtn.appendChild(createElement('span', { className: 'icon', textContent: '✓' }));
  saveBtn.appendChild(document.createTextNode(' Saved!'));

  setTimeout(() => {
    saveBtn.classList.remove('btn-success');
    saveBtn.disabled = false;
    saveBtn.textContent = '';
    saveBtn.appendChild(
      createElement('span', { className: 'icon', textContent: '📌' })
    );
    saveBtn.appendChild(document.createTextNode(' Save This Page'));
  }, 2000);
}

function resetSaveButton(): void {
  saveBtn.disabled = false;
  saveBtn.textContent = '';
  saveBtn.appendChild(createElement('span', { className: 'icon', textContent: '📌' }));
  saveBtn.appendChild(document.createTextNode(' Save This Page'));
}

function showConfigurationWarning(): void {
  statusDiv.className = 'status warning';
  statusDiv.textContent = '';

  const message = createElement('span', {
    textContent: 'API endpoint not configured.',
  });
  const settingsLink = createElement('button', {
    className: 'btn-cta',
    textContent: 'Configure in Settings',
  });
  settingsLink.onclick = () => {
    void openExtensionPageOrig('src/options/options.html');
  };

  statusDiv.appendChild(message);
  statusDiv.appendChild(settingsLink);
}

// ============================================================================
// Effect Runtime Setup
// ============================================================================

// Create the full application layer with all dependencies
const AppLayer = Layer.mergeAll(
  ChromeScriptingServiceLive,
  Layer.succeed(MessagingService, {
    sendMessage: (message) =>
      Effect.async((resume) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resume(
              Effect.fail({
                messageType: message.type,
                reason: 'runtime_error' as const,
                details: chrome.runtime.lastError.message,
                originalError: chrome.runtime.lastError,
              })
            );
            return;
          }
          resume(Effect.succeed(response));
        });
      }),
    addMessageListener: () => Effect.succeed(() => {}),
    broadcastEvent: () => Effect.succeed(undefined),
  }),
  Layer.succeed(TabsService, {
    getExtensionUrl: (path) => Effect.sync(() => chrome.runtime.getURL(path)),
    isExtensionUrl: (url) =>
      Effect.gen(function* () {
        if (url === undefined || url === '') {
          return false;
        }
        const extensionUrlPrefix = chrome.runtime.getURL('');
        return url.startsWith(extensionUrlPrefix);
      }),
    findExtensionTab: () =>
      Effect.tryPromise({
        try: async () => {
          const tabs = await chrome.tabs.query({});
          const extensionUrlPrefix = chrome.runtime.getURL('');
          for (const tab of tabs) {
            if (tab.url?.startsWith(extensionUrlPrefix)) {
              return tab;
            }
          }
          return null;
        },
        catch: (error) =>
          new TabError({
            operation: 'query',
            message: 'Failed to find extension tab',
            cause: error,
          }),
      }),
    openExtensionPage: (pagePath) =>
      Effect.gen(function* () {
        const targetUrl = chrome.runtime.getURL(pagePath);
        const tabs = yield* Effect.tryPromise({
          try: () => chrome.tabs.query({}),
          catch: (error) =>
            new TabError({
              operation: 'query',
              message: 'Failed to query tabs',
              cause: error,
            }),
        });

        const extensionUrlPrefix = chrome.runtime.getURL('');
        const existingTab = tabs.find((tab) =>
          tab.url?.startsWith(extensionUrlPrefix)
        );

        if (existingTab?.id !== undefined) {
          yield* Effect.tryPromise({
            try: () =>
              chrome.tabs.update(existingTab.id, {
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

          if (existingTab.windowId !== undefined) {
            yield* Effect.tryPromise({
              try: () =>
                chrome.windows.update(existingTab.windowId, { focused: true }),
              catch: () => {},
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        } else {
          yield* Effect.tryPromise({
            try: () => chrome.tabs.create({ url: targetUrl }),
            catch: (error) =>
              new TabError({
                operation: 'create',
                message: 'Failed to create tab',
                cause: error,
              }),
          });
        }
      }),
  }),
  Layer.succeed(SettingsService, {
    getSettings: () =>
      Effect.tryPromise({
        try: async () => {
          const result = await chrome.storage.local.get([
            'apiKey',
            'apiEndpoint',
            'model',
            'provider',
          ]);
          return {
            apiKey: (result.apiKey as string) ?? '',
            apiEndpoint: (result.apiEndpoint as string) ?? '',
            model: (result.model as string) ?? '',
            provider: (result.provider as string) ?? '',
          };
        },
        catch: (error) => ({
          operation: 'read' as const,
          message: 'Failed to get settings',
          cause: error,
        }),
      }),
    saveSetting: (key, value) =>
      Effect.tryPromise({
        try: () => chrome.storage.local.set({ [key]: value }),
        catch: (error) => ({
          operation: 'write' as const,
          key,
          message: `Failed to save setting: ${key}`,
          cause: error,
        }),
      }),
  })
).pipe(Layer.provide(PopupServiceLive));

// Helper to run effects with the app layer
function runWithLayer<A, E>(
  effect: Effect.Effect<A, E, PopupService>
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================================================
// Event Handlers
// ============================================================================

saveBtn.addEventListener('click', async () => {
  let saveSucceeded = false;
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const result = await runWithLayer(
      Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.saveCurrentPage();
      })
    );

    if (result.success === true && result.bookmarkId !== undefined) {
      showSuccessWithCTA(result.bookmarkId);
      showSaveSuccess();
      saveSucceeded = true;
    } else {
      showStatusMessage(statusDiv, 'Bookmark saved!', 'success', 3000);
      showSaveSuccess();
      saveSucceeded = true;
    }
  } catch (error) {
    console.error('Error saving bookmark:', error);

    if (error instanceof BookmarkSaveError) {
      switch (error.reason) {
        case 'no_active_tab':
        case 'no_tab_id':
          showStatusMessage(statusDiv, 'No active tab found', 'error');
          break;
        case 'no_url':
        case 'incognito_mode':
          showStatusMessage(
            statusDiv,
            'Cannot save in incognito mode or restricted URLs',
            'error'
          );
          break;
        case 'restricted_scheme':
          showStatusMessage(statusDiv, 'Cannot save browser internal pages', 'error');
          break;
        case 'permission_denied':
        case 'script_failed':
          showStatusMessage(
            statusDiv,
            'Cannot access this page (permissions or restrictions)',
            'error'
          );
          break;
        default:
          showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
      }
    } else if (error instanceof ScriptingError) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('Cannot access') || errorMessage.includes('scripting')) {
        showStatusMessage(
          statusDiv,
          'Cannot access this page (permissions or restrictions)',
          'error'
        );
      } else {
        showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
      }
    } else {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('Cannot access') || errorMessage.includes('scripting')) {
        showStatusMessage(
          statusDiv,
          'Cannot access this page (permissions or restrictions)',
          'error'
        );
      } else {
        showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
      }
    }
  } finally {
    if (!saveSucceeded) {
      resetSaveButton();
    }
  }
});

navLibrary.addEventListener('click', () => {
  void runWithLayer(
    Effect.gen(function* () {
      const popupService = yield* PopupService;
      yield* popupService.navigateToPage('src/library/library.html');
    })
  ).catch((error) => {
    console.error('Navigation error:', error);
  });
});

navSearch.addEventListener('click', () => {
  void runWithLayer(
    Effect.gen(function* () {
      const popupService = yield* PopupService;
      yield* popupService.navigateToPage('src/search/search.html');
    })
  ).catch((error) => {
    console.error('Navigation error:', error);
  });
});

navStumble.addEventListener('click', () => {
  void runWithLayer(
    Effect.gen(function* () {
      const popupService = yield* PopupService;
      yield* popupService.navigateToPage('src/stumble/stumble.html');
    })
  ).catch((error) => {
    console.error('Navigation error:', error);
  });
});

navSettings.addEventListener('click', () => {
  void runWithLayer(
    Effect.gen(function* () {
      const popupService = yield* PopupService;
      yield* popupService.navigateToPage('src/options/options.html');
    })
  ).catch((error) => {
    console.error('Navigation error:', error);
  });
});

function performSearch(): void {
  const query = searchInput.value.trim();
  void runWithLayer(
    Effect.gen(function* () {
      const popupService = yield* PopupService;
      yield* popupService.performSearch(query);
    })
  ).catch((error) => {
    console.error('Search error:', error);
  });
}

searchBtn.addEventListener('click', performSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// ============================================================================
// Initialization
// ============================================================================

searchInput.focus();

void initializePlatform();
setupThemeOnly();

async function checkEndpointConfiguration(): Promise<void> {
  try {
    const hasApiKey = await runWithLayer(
      Effect.gen(function* () {
        const popupService = yield* PopupService;
        return yield* popupService.checkEndpointConfiguration();
      })
    );

    if (!hasApiKey) {
      showConfigurationWarning();
    }
  } catch (error) {
    console.error('Error checking settings:', error);
  }
}

void checkEndpointConfiguration();
