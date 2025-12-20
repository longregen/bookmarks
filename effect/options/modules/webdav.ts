import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import { SettingsService, SettingsServiceLive } from '../../lib/settings';
import { LoggingService } from '../../services/logging-service';
import { createPoller, type Poller } from '../../../src/lib/polling-manager';
import { validateWebDAVUrl as validateWebDAVUrlShared } from '../../../src/lib/url-validator';
import { getErrorMessage } from '../../lib/errors';
import type { ApiSettings } from '../../../src/lib/platform';
import { DOMError, UIService, UIServiceLive, ButtonStateService, ButtonStateServiceLive } from '../shared';

/**
 * Error types for WebDAV module
 */
export class WebDAVConnectionError extends Data.TaggedError(
  'WebDAVConnectionError'
)<{
  readonly url: string;
  readonly code:
    | 'AUTHENTICATION_FAILED'
    | 'PATH_NOT_FOUND'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'UNKNOWN';
  readonly message: string;
  readonly status?: number;
  readonly originalError?: unknown;
}> {}

export class MessagingError extends Data.TaggedError('MessagingError')<{
  readonly messageType: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

// Note: This module keeps its own DOMService with additional methods beyond the shared version
// The shared DOMService and UIService could be used but this module has specific requirements

/**
 * Service for Chrome runtime messaging
 */
export class ChromeMessagingService extends Context.Tag('ChromeMessagingService')<
  ChromeMessagingService,
  {
    readonly sendMessage: <T>(message: {
      type: string;
      [key: string]: unknown;
    }) => Effect.Effect<T, MessagingError, never>;
  }
>() {}

/**
 * Service for WebDAV operations
 */
export class WebDAVService extends Context.Tag('WebDAVService')<
  WebDAVService,
  {
    readonly testConnection: (
      url: string,
      username: string,
      password: string
    ) => Effect.Effect<void, WebDAVConnectionError, never>;
    readonly validateUrl: (
      url: string,
      allowInsecure: boolean
    ) => Effect.Effect<
      { valid: boolean; warning?: string },
      never,
      never
    >;
  }
>() {}

/**
 * Service for DOM operations
 */
export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly getElement: <T extends HTMLElement>(
      id: string
    ) => Effect.Effect<T, DOMError, never>;
    readonly showStatus: (
      element: HTMLElement,
      message: string,
      type: 'success' | 'error' | 'info',
      duration?: number
    ) => Effect.Effect<void, never, never>;
    readonly updateText: (
      element: HTMLElement,
      text: string
    ) => Effect.Effect<void, never, never>;
    readonly addClass: (
      element: HTMLElement,
      className: string
    ) => Effect.Effect<void, never, never>;
    readonly removeClass: (
      element: HTMLElement,
      className: string
    ) => Effect.Effect<void, never, never>;
    readonly setDisabled: (
      element: HTMLButtonElement,
      disabled: boolean
    ) => Effect.Effect<void, never, never>;
  }
>() {}

/**
 * Live implementation of ChromeMessagingService
 */
export const ChromeMessagingServiceLive: Layer.Layer<
  ChromeMessagingService,
  never,
  never
> = Layer.succeed(ChromeMessagingService, {
  sendMessage: <T>(message: { type: string; [key: string]: unknown }) =>
    Effect.tryPromise({
      try: () => chrome.runtime.sendMessage(message) as Promise<T>,
      catch: (error) =>
        new MessagingError({
          messageType: message.type,
          message: `Failed to send message: ${message.type}`,
          originalError: error,
        }),
    }),
});

/**
 * Live implementation of WebDAVService
 */
export const WebDAVServiceLive: Layer.Layer<WebDAVService, never, never> =
  Layer.succeed(WebDAVService, {
    testConnection: (url: string, username: string, password: string) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: 'PROPFIND',
              headers: {
                Depth: '0',
                Authorization: `Basic ${btoa(`${username}:${password}`)}`,
                'Content-Type': 'application/xml',
              },
              body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
            }),
          catch: (error) => {
            if (error instanceof TypeError && error.message.includes('fetch')) {
              return new WebDAVConnectionError({
                url,
                code: 'NETWORK_ERROR',
                message: 'Network error. Check the URL and your connection.',
                originalError: error,
              });
            }
            return new WebDAVConnectionError({
              url,
              code: 'UNKNOWN',
              message: getErrorMessage(error),
              originalError: error,
            });
          },
        });

        // WebDAV returns 207 Multi-Status for successful PROPFIND
        if (response.status === 207 || response.ok) {
          return;
        }

        if (response.status === 401) {
          return yield* Effect.fail(
            new WebDAVConnectionError({
              url,
              code: 'AUTHENTICATION_FAILED',
              message: 'Authentication failed. Check username and password.',
              status: 401,
            })
          );
        }

        if (response.status === 404) {
          return yield* Effect.fail(
            new WebDAVConnectionError({
              url,
              code: 'PATH_NOT_FOUND',
              message: 'Path not found. Check the server URL.',
              status: 404,
            })
          );
        }

        return yield* Effect.fail(
          new WebDAVConnectionError({
            url,
            code: 'INVALID_RESPONSE',
            message: `Server returned status ${response.status}`,
            status: response.status,
          })
        );
      }),

    validateUrl: (url: string, allowInsecure: boolean) =>
      Effect.sync(() => validateWebDAVUrlShared(url, allowInsecure)),
  });

/**
 * Live implementation of DOMService
 */
export const DOMServiceLive: Layer.Layer<DOMService, never, never> =
  Layer.succeed(DOMService, {
    getElement: <T extends HTMLElement>(id: string) =>
      Effect.sync(() => {
        const element = document.getElementById(id) as T | null;
        if (!element) {
          throw new DOMError({
            elementId: id,
            operation: 'query',
            message: `Element not found: ${id}`,
          });
        }
        return element;
      }),

    showStatus: (
      element: HTMLElement,
      message: string,
      type: 'success' | 'error' | 'info',
      duration = 5000
    ) =>
      Effect.sync(() => {
        element.textContent = message;
        element.className = `status ${type}`;
        element.style.display = 'block';

        if (duration > 0) {
          setTimeout(() => {
            element.style.display = 'none';
          }, duration);
        }
      }),

    updateText: (element: HTMLElement, text: string) =>
      Effect.sync(() => {
        element.textContent = text;
      }),

    addClass: (element: HTMLElement, className: string) =>
      Effect.sync(() => {
        element.classList.add(className);
      }),

    removeClass: (element: HTMLElement, className: string) =>
      Effect.sync(() => {
        element.classList.remove(className);
      }),

    setDisabled: (element: HTMLButtonElement, disabled: boolean) =>
      Effect.sync(() => {
        element.disabled = disabled;
      }),
  });

/**
 * Combined application layer
 */
export const AppLayer: Layer.Layer<
  SettingsService | ChromeMessagingService | WebDAVService | DOMService | UIService | ButtonStateService,
  never,
  never
> = Layer.mergeAll(
  SettingsServiceLive,
  ChromeMessagingServiceLive,
  WebDAVServiceLive,
  DOMServiceLive,
  UIServiceLive,
  ButtonStateServiceLive
);

/**
 * Load WebDAV settings and update UI
 */
function loadWebDAVSettings(elements: {
  webdavEnabledInput: HTMLInputElement;
  webdavUrlInput: HTMLInputElement;
  webdavUsernameInput: HTMLInputElement;
  webdavPasswordInput: HTMLInputElement;
  webdavPathInput: HTMLInputElement;
  webdavSyncIntervalInput: HTMLInputElement;
  webdavAllowInsecureInput: HTMLInputElement;
}): Effect.Effect<
  ApiSettings,
  never,
  SettingsService | WebDAVService | DOMService
> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    const webdavService = yield* WebDAVService;
    const domService = yield* DOMService;

    const settings = yield* Effect.orDie(settingsService.getSettings());

    // Update form values
    yield* Effect.sync(() => {
      elements.webdavEnabledInput.checked = settings.webdavEnabled;
      elements.webdavUrlInput.value = settings.webdavUrl;
      elements.webdavUsernameInput.value = settings.webdavUsername;
      elements.webdavPasswordInput.value = settings.webdavPassword;
      elements.webdavPathInput.value = settings.webdavPath;
      elements.webdavSyncIntervalInput.value = String(
        settings.webdavSyncInterval || 15
      );
      elements.webdavAllowInsecureInput.checked =
        settings.webdavAllowInsecure || false;
    });

    // Validate URL
    const url = yield* Effect.sync(() => elements.webdavUrlInput.value.trim());
    if (url !== '') {
      const validationResult = yield* webdavService.validateUrl(url, true);
      const warning = yield* domService.getElement<HTMLDivElement>(
        'webdavUrlWarning'
      );

      if (validationResult.valid && validationResult.warning !== undefined) {
        yield* domService.removeClass(warning, 'hidden');
      } else {
        yield* domService.addClass(warning, 'hidden');
      }
    }

    return settings;
  });
}

/**
 * Save WebDAV settings
 */
function saveWebDAVSettings(settings: {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  path: string;
  syncInterval: number;
}): Effect.Effect<void, never, SettingsService | ChromeMessagingService> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    const messagingService = yield* ChromeMessagingService;

    yield* Effect.orDie(
      settingsService.saveSetting('webdavEnabled', settings.enabled)
    );
    yield* Effect.orDie(
      settingsService.saveSetting('webdavUrl', settings.url)
    );
    yield* Effect.orDie(
      settingsService.saveSetting('webdavUsername', settings.username)
    );
    yield* Effect.orDie(
      settingsService.saveSetting('webdavPassword', settings.password)
    );
    yield* Effect.orDie(
      settingsService.saveSetting('webdavPath', settings.path)
    );
    yield* Effect.orDie(
      settingsService.saveSetting('webdavSyncInterval', settings.syncInterval)
    );

    yield* Effect.orDie(
      messagingService.sendMessage({ type: 'sync:update_settings' })
    );
  });
}

/**
 * Test WebDAV connection
 */
function testConnection(
  url: string,
  username: string,
  password: string
): Effect.Effect<void, WebDAVConnectionError, WebDAVService> {
  return Effect.gen(function* () {
    const webdavService = yield* WebDAVService;
    yield* webdavService.testConnection(url, username, password);
  });
}

/**
 * Update sync status display
 */
function updateSyncStatus(elements: {
  syncStatusIndicator: HTMLDivElement;
  syncNowBtn: HTMLButtonElement;
}): Effect.Effect<void, never, ChromeMessagingService | DOMService> {
  return Effect.gen(function* () {
    const messagingService = yield* ChromeMessagingService;
    const domService = yield* DOMService;

    const response = yield* Effect.orDie(
      messagingService.sendMessage<{
        isSyncing?: boolean;
        lastSyncError?: string;
        lastSyncTime?: string;
      }>({ type: 'query:sync_status' })
    );

    const statusText = yield* Effect.sync(() => {
      const el = elements.syncStatusIndicator.querySelector('.sync-status-text');
      if (!el) throw new Error('Status text element not found');
      return el as HTMLElement;
    });

    yield* domService.removeClass(elements.syncStatusIndicator, 'syncing');
    yield* domService.removeClass(elements.syncStatusIndicator, 'success');
    yield* domService.removeClass(elements.syncStatusIndicator, 'error');

    if (response.isSyncing) {
      yield* domService.addClass(elements.syncStatusIndicator, 'syncing');
      yield* domService.updateText(statusText, 'Syncing...');
      yield* domService.setDisabled(elements.syncNowBtn, true);
      yield* domService.updateText(elements.syncNowBtn, 'Syncing...');
    } else if (response.lastSyncError) {
      yield* domService.addClass(elements.syncStatusIndicator, 'error');
      yield* domService.updateText(statusText, `Error: ${response.lastSyncError}`);
      yield* domService.setDisabled(elements.syncNowBtn, false);
      yield* domService.updateText(elements.syncNowBtn, 'Sync Now');
    } else if (response.lastSyncTime) {
      yield* domService.addClass(elements.syncStatusIndicator, 'success');
      const formattedTime = yield* Effect.sync(() =>
        formatSyncTime(response.lastSyncTime!)
      );
      yield* domService.updateText(statusText, `Last synced: ${formattedTime}`);
      yield* domService.setDisabled(elements.syncNowBtn, false);
      yield* domService.updateText(elements.syncNowBtn, 'Sync Now');
    } else {
      yield* domService.updateText(statusText, 'Not synced yet');
      yield* domService.setDisabled(elements.syncNowBtn, false);
      yield* domService.updateText(elements.syncNowBtn, 'Sync Now');
    }
  });
}

/**
 * Trigger manual sync
 */
function triggerSync(): Effect.Effect<
  { success: boolean; message?: string },
  never,
  ChromeMessagingService
> {
  return Effect.gen(function* () {
    const messagingService = yield* ChromeMessagingService;
    const result = yield* Effect.orDie(
      messagingService.sendMessage<{ success?: boolean; message?: string }>({
        type: 'sync:trigger',
      })
    );
    return {
      success: result.success ?? false,
      message: result.message,
    };
  });
}

/**
 * Format sync time for display
 */
function formatSyncTime(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else {
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else {
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
}

/**
 * Show connection status
 */
function showConnectionStatus(
  statusElement: HTMLDivElement,
  type: 'success' | 'error' | 'testing',
  message: string
): Effect.Effect<void, never, DOMService> {
  return Effect.gen(function* () {
    const domService = yield* DOMService;

    yield* Effect.sync(() => {
      statusElement.className = `connection-status ${type}`;
    });

    const statusText = yield* Effect.sync(() => {
      const el = statusElement.querySelector('.status-text');
      if (!el) throw new Error('Status text element not found');
      return el as HTMLElement;
    });

    yield* domService.updateText(statusText, message);
  });
}


/**
 * Initialize WebDAV module with Effect-based logic
 */
export function initWebDAVModule(): () => void {
  // Get DOM elements
  const webdavForm = document.getElementById('webdavForm') as HTMLFormElement;
  const webdavEnabledInput = document.getElementById(
    'webdavEnabled'
  ) as HTMLInputElement;
  const webdavFieldsDiv = document.getElementById(
    'webdavFields'
  ) as HTMLDivElement;
  const webdavUrlInput = document.getElementById('webdavUrl') as HTMLInputElement;
  const webdavUsernameInput = document.getElementById(
    'webdavUsername'
  ) as HTMLInputElement;
  const webdavPasswordInput = document.getElementById(
    'webdavPassword'
  ) as HTMLInputElement;
  const webdavPathInput = document.getElementById(
    'webdavPath'
  ) as HTMLInputElement;
  const webdavSyncIntervalInput = document.getElementById(
    'webdavSyncInterval'
  ) as HTMLInputElement;
  const webdavAllowInsecureInput = document.getElementById(
    'webdavAllowInsecure'
  ) as HTMLInputElement;
  const testWebdavBtn = document.getElementById(
    'testWebdavBtn'
  ) as HTMLButtonElement;
  const webdavConnectionStatus = document.getElementById(
    'webdavConnectionStatus'
  ) as HTMLDivElement;
  const webdavUrlWarning = document.getElementById(
    'webdavUrlWarning'
  ) as HTMLDivElement;

  const syncStatusIndicator = document.getElementById(
    'syncStatusIndicator'
  ) as HTMLDivElement;
  const syncNowBtn = document.getElementById('syncNowBtn') as HTMLButtonElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;

  // Polling for sync status
  const syncStatusPoller: Poller = createPoller(async () => {
    await Effect.runPromise(
      Effect.provide(
        updateSyncStatus({ syncStatusIndicator, syncNowBtn }),
        AppLayer
      )
    );
  }, 10000);

  // Update visibility of WebDAV fields
  function updateWebDAVFieldsVisibility(): void {
    if (webdavEnabledInput.checked) {
      webdavFieldsDiv.classList.remove('hidden');
    } else {
      webdavFieldsDiv.classList.add('hidden');
    }
  }

  // Validate WebDAV URL
  function validateWebDAVUrl(): void {
    const url = webdavUrlInput.value.trim();

    if (url === '') {
      webdavUrlWarning.classList.add('hidden');
      return;
    }

    const result = validateWebDAVUrlShared(url, true);

    if (result.valid && result.warning !== undefined) {
      webdavUrlWarning.classList.remove('hidden');
    } else {
      webdavUrlWarning.classList.add('hidden');
    }
  }

  // Event handlers
  webdavEnabledInput.addEventListener('change', () => {
    updateWebDAVFieldsVisibility();
    if (webdavEnabledInput.checked) {
      syncStatusPoller.start();
    } else {
      syncStatusPoller.stop();
    }
  });

  webdavUrlInput.addEventListener('input', validateWebDAVUrl);

  webdavForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = webdavForm.querySelector<HTMLButtonElement>(
      '[type="submit"]'
    );
    if (!submitBtn) return;

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const buttonStateService = yield* ButtonStateService;
          const domService = yield* DOMService;
          const uiService = yield* UIService;

          yield* buttonStateService.withButtonState(
            submitBtn,
            'Saving...',
            Effect.gen(function* () {
              yield* saveWebDAVSettings({
                enabled: webdavEnabledInput.checked,
                url: webdavUrlInput.value.trim(),
                username: webdavUsernameInput.value.trim(),
                password: webdavPasswordInput.value,
                path: webdavPathInput.value.trim() || '/bookmarks',
                syncInterval:
                  parseInt(webdavSyncIntervalInput.value, 10) || 15,
              });

              yield* uiService.showStatus(
                statusDiv,
                'WebDAV settings saved successfully!',
                'success',
                5000
              );

              if (webdavEnabledInput.checked) {
                yield* updateSyncStatus({ syncStatusIndicator, syncNowBtn });
              }
            })
          );
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const uiService = yield* UIService;
              console.error('Error saving WebDAV settings:', error);
              yield* uiService.showStatus(
                statusDiv,
                'Failed to save WebDAV settings',
                'error',
                5000
              );
            })
          )
        ),
        AppLayer
      )
    );
  });

  testWebdavBtn.addEventListener('click', async () => {
    const url = webdavUrlInput.value.trim();
    const username = webdavUsernameInput.value.trim();
    const password = webdavPasswordInput.value;

    if (!url || !username || !password) {
      await Effect.runPromise(
        Effect.provide(
          showConnectionStatus(
            webdavConnectionStatus,
            'error',
            'Please fill in URL, username, and password'
          ),
          AppLayer
        )
      );
      return;
    }

    await Effect.runPromise(
      Effect.provide(
        showConnectionStatus(webdavConnectionStatus, 'testing', 'Testing connection...'),
        AppLayer
      )
    );

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const buttonStateService = yield* ButtonStateService;

          yield* buttonStateService.withButtonState(
            testWebdavBtn,
            'Testing...',
            Effect.gen(function* () {
              yield* testConnection(url, username, password);
              yield* showConnectionStatus(
                webdavConnectionStatus,
                'success',
                'Connection successful!'
              );
            }).pipe(
              Effect.catchTag('WebDAVConnectionError', (error) =>
                showConnectionStatus(
                  webdavConnectionStatus,
                  'error',
                  error.message
                )
              )
            )
          );
        }).pipe(
          Effect.catchAll((error) =>
            showConnectionStatus(
              webdavConnectionStatus,
              'error',
              `Connection failed: ${getErrorMessage(error)}`
            )
          )
        ),
        AppLayer
      )
    );
  });

  syncNowBtn.addEventListener('click', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const buttonStateService = yield* ButtonStateService;
          const domService = yield* DOMService;
          const uiService = yield* UIService;

          yield* buttonStateService.withButtonState(
            syncNowBtn,
            'Syncing...',
            Effect.gen(function* () {
              const statusText = yield* Effect.sync(() => {
                const el = syncStatusIndicator.querySelector('.sync-status-text');
                if (!el) throw new Error('Status text element not found');
                return el as HTMLElement;
              });

              yield* domService.removeClass(syncStatusIndicator, 'success');
              yield* domService.removeClass(syncStatusIndicator, 'error');
              yield* domService.addClass(syncStatusIndicator, 'syncing');
              yield* domService.updateText(statusText, 'Syncing...');

              const result = yield* triggerSync();

              yield* domService.removeClass(syncStatusIndicator, 'syncing');

              if (result.success) {
                yield* domService.addClass(syncStatusIndicator, 'success');
                yield* domService.updateText(
                  statusText,
                  result.message ?? 'Sync completed'
                );
                yield* uiService.showStatus(
                  statusDiv,
                  `Sync completed: ${result.message ?? 'Success'}`,
                  'success',
                  5000
                );
              } else {
                yield* domService.addClass(syncStatusIndicator, 'error');
                yield* domService.updateText(
                  statusText,
                  `Error: ${result.message ?? 'Unknown error'}`
                );
                yield* uiService.showStatus(
                  statusDiv,
                  `Sync failed: ${result.message ?? 'Unknown error'}`,
                  'error',
                  5000
                );
              }

              yield* Effect.sync(() =>
                setTimeout(
                  () =>
                    void Effect.runPromise(
                      Effect.provide(
                        updateSyncStatus({ syncStatusIndicator, syncNowBtn }),
                        AppLayer
                      )
                    ),
                  1000
                )
              );
            })
          );
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const uiService = yield* UIService;
              console.error('Error triggering sync:', error);
              yield* uiService.showStatus(
                statusDiv,
                'Failed to trigger sync',
                'error',
                5000
              );
            })
          )
        ),
        AppLayer
      )
    );
  });

  // Initial load
  Effect.runPromise(
    Effect.provide(
      loadWebDAVSettings({
        webdavEnabledInput,
        webdavUrlInput,
        webdavUsernameInput,
        webdavPasswordInput,
        webdavPathInput,
        webdavSyncIntervalInput,
        webdavAllowInsecureInput,
      }).pipe(
        Effect.flatMap((settings) =>
          settings.webdavEnabled
            ? updateSyncStatus({ syncStatusIndicator, syncNowBtn })
            : Effect.void
        )
      ),
      AppLayer
    )
  ).catch((error) => {
    console.error('Error loading WebDAV settings:', error);
  });

  // Start polling if enabled
  if (webdavEnabledInput.checked) {
    syncStatusPoller.start();
  }

  // Return cleanup function
  return (): void => {
    syncStatusPoller.stop();
  };
}
