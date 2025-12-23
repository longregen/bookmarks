import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from './effect-utils';
import { ConfigService } from '../services/config-service';
import { LoggingService } from '../services/logging-service';
import type { GetPageHtmlResponse } from './messages';

export interface CapturedPage {
  html: string;
  title: string;
}

// ============================================================================
// Errors
// ============================================================================

export class TabCreationError extends Data.TaggedError('TabCreationError')<{
  readonly message: string;
  readonly url?: string;
  readonly originalError?: unknown;
}> {}

export class TabLoadTimeoutError extends Data.TaggedError('TabLoadTimeoutError')<{
  readonly tabId: number;
  readonly timeoutMs: number;
  readonly message: string;
}> {}

export class TabExtractionError extends Data.TaggedError('TabExtractionError')<{
  readonly tabId: number;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class HtmlTooLargeError extends Data.TaggedError('HtmlTooLargeError')<{
  readonly sizeBytes: number;
  readonly maxSizeBytes: number;
  readonly message: string;
}> {}

export type TabRendererError =
  | TabCreationError
  | TabLoadTimeoutError
  | TabExtractionError
  | HtmlTooLargeError;

// ============================================================================
// Services
// ============================================================================

export class ChromeTabService extends Context.Tag('ChromeTabService')<
  ChromeTabService,
  {
    readonly create: (
      options: chrome.tabs.CreateProperties
    ) => Effect.Effect<chrome.tabs.Tab, TabCreationError, never>;

    readonly remove: (tabId: number) => Effect.Effect<void, never, never>;

    readonly get: (
      tabId: number
    ) => Effect.Effect<chrome.tabs.Tab, TabCreationError, never>;

    readonly sendMessage: <T>(
      tabId: number,
      message: unknown
    ) => Effect.Effect<T | undefined, TabExtractionError, never>;

    readonly executeScript: <T>(
      tabId: number,
      func: (...args: any[]) => Promise<T>,
      args: any[]
    ) => Effect.Effect<T, TabExtractionError, never>;

    readonly onUpdated: {
      addListener: (
        listener: (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab
        ) => void
      ) => Effect.Effect<void, never, never>;
      removeListener: (
        listener: (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab
        ) => void
      ) => Effect.Effect<void, never, never>;
    };
  }
>() {}

export class ChromeAlarmService extends Context.Tag('ChromeAlarmService')<
  ChromeAlarmService,
  {
    readonly create: (
      name: string,
      alarmInfo: chrome.alarms.AlarmCreateInfo
    ) => Effect.Effect<void, never, never>;

    readonly clear: (name: string) => Effect.Effect<void, never, never>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

export const ChromeTabServiceLive: Layer.Layer<ChromeTabService, never, never> =
  makeLayer(ChromeTabService, {
    create: (options: chrome.tabs.CreateProperties) =>
      Effect.tryPromise({
        try: () => chrome.tabs.create(options),
        catch: (error) =>
          new TabCreationError({
            message: 'Failed to create tab',
            url: options.url,
            originalError: error,
          }),
      }).pipe(
        Effect.flatMap((tab) => {
          if (typeof tab.id !== 'number') {
            return Effect.fail(
              new TabCreationError({
                message: 'Failed to create tab - no tab ID returned',
                url: options.url,
              })
            );
          }
          return Effect.succeed(tab);
        })
      ),

    remove: (tabId: number) =>
      Effect.tryPromise({
        try: () => chrome.tabs.remove(tabId),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined)),

    get: (tabId: number) =>
      Effect.tryPromise({
        try: () => chrome.tabs.get(tabId),
        catch: (error) =>
          new TabCreationError({
            message: `Failed to get tab ${tabId}`,
            originalError: error,
          }),
      }),

    sendMessage: <T>(tabId: number, message: unknown) =>
      Effect.tryPromise({
        try: () => chrome.tabs.sendMessage(tabId, message) as Promise<T | undefined>,
        catch: (error) =>
          new TabExtractionError({
            tabId,
            message: 'Failed to send message to tab',
            originalError: error,
          }),
      }),

    executeScript: <T>(tabId: number, func: (...args: any[]) => Promise<T>, args: any[]) =>
      Effect.tryPromise({
        try: async () => {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func,
            args,
          });

          const result = results[0]?.result;
          if (
            results.length === 0 ||
            result === undefined
          ) {
            throw new Error('Script execution returned no results');
          }

          return result as T;
        },
        catch: (error) =>
          new TabExtractionError({
            tabId,
            message: 'Failed to execute script in tab',
            originalError: error,
          }),
      }),

    onUpdated: {
      addListener: (listener) =>
        Effect.sync(() => {
          chrome.tabs.onUpdated.addListener(listener);
        }),
      removeListener: (listener) =>
        Effect.sync(() => {
          chrome.tabs.onUpdated.removeListener(listener);
        }),
    },
  });

export const ChromeAlarmServiceLive: Layer.Layer<
  ChromeAlarmService,
  never,
  never
> = makeLayer(ChromeAlarmService, {
  create: (name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) =>
    Effect.tryPromise({
      try: () => chrome.alarms.create(name, alarmInfo),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined)),

  clear: (name: string) =>
    Effect.tryPromise({
      try: () => chrome.alarms.clear(name),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined)),
});

// ============================================================================
// Helper Effects
// ============================================================================

const KEEPALIVE_ALARM_NAME = 'tab-renderer-keepalive';

function sleep(ms: number): Effect.Effect<void, never, never> {
  if (ms <= 0) return Effect.void;
  return Effect.async<void, never, never>((resume) => {
    const timeoutId = setTimeout(() => {
      resume(Effect.void);
    }, ms);
    return Effect.sync(() => {
      clearTimeout(timeoutId);
    });
  });
}

function keepaliveResource(): Effect.Effect<
  void,
  never,
  ChromeAlarmService | LoggingService
> {
  return Effect.gen(function* () {
    const alarmService = yield* ChromeAlarmService;
    const logging = yield* LoggingService;

    return yield* Effect.acquireRelease(
      Effect.gen(function* () {
        yield* logging.debug('Starting keepalive alarm');
        yield* alarmService.create(KEEPALIVE_ALARM_NAME, {
          periodInMinutes: 0.5,
        });
      }),
      () =>
        Effect.gen(function* () {
          yield* logging.debug('Stopping keepalive alarm');
          yield* alarmService.clear(KEEPALIVE_ALARM_NAME);
        })
    );
  });
}

function waitForTabLoad(
  tabId: number,
  timeoutMs: number
): Effect.Effect<void, TabLoadTimeoutError, ChromeTabService> {
  return Effect.gen(function* () {
    const tabService = yield* ChromeTabService;

    // Check if tab is already complete
    const initialTab = yield* tabService.get(tabId);
    if (initialTab.status === 'complete') {
      return;
    }

    // Wait for tab to complete with timeout
    yield* Effect.async<void, TabLoadTimeoutError, never>((resume) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let listener:
        | ((
            updatedTabId: number,
            changeInfo: chrome.tabs.TabChangeInfo,
            tab: chrome.tabs.Tab
          ) => void)
        | undefined;

      const cleanup = (): void => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (listener !== undefined) {
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resume(
          Effect.fail(
            new TabLoadTimeoutError({
              tabId,
              timeoutMs,
              message: 'Tab load timeout',
            })
          )
        );
      }, timeoutMs);

      listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ): void => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          cleanup();
          resume(Effect.void);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      return Effect.sync(cleanup);
    });
  });
}

function executeExtraction(
  tabId: number,
  settleTimeMs: number,
  maxMultiplier: number
): Effect.Effect<CapturedPage, TabExtractionError, ChromeTabService> {
  return Effect.gen(function* () {
    const tabService = yield* ChromeTabService;

    // Firefox doesn't allow chrome.scripting.executeScript() on programmatically created tabs
    // Use message passing to content script instead
    if (__IS_FIREFOX__) {
      return yield* executeExtractionViaMessage(tabId, settleTimeMs);
    }

    const result = yield* tabService.executeScript<{ html: string; title: string }>(
      tabId,
      (settleMs: number, multiplier: number) =>
        new Promise<{ html: string; title: string }>((resolve) => {
          let settleTimeout: ReturnType<typeof setTimeout>;
          const maxWaitMs = settleMs * multiplier;

          // Hard timeout to prevent hanging on pages with continuous DOM mutations
          const maxTimeout = setTimeout(() => {
            observer.disconnect();
            resolve({
              html: document.documentElement.outerHTML,
              title: document.title,
            });
          }, maxWaitMs);

          const observer = new MutationObserver(() => {
            clearTimeout(settleTimeout);
            settleTimeout = setTimeout(() => {
              clearTimeout(maxTimeout);
              observer.disconnect();
              resolve({
                html: document.documentElement.outerHTML,
                title: document.title,
              });
            }, settleMs);
          });

          const target = document.body;
          observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });

          settleTimeout = setTimeout(() => {
            clearTimeout(maxTimeout);
            observer.disconnect();
            resolve({
              html: document.documentElement.outerHTML,
              title: document.title,
            });
          }, settleMs);
        }),
      [settleTimeMs, maxMultiplier]
    );

    if (result.html === undefined || result.html === '') {
      return yield* Effect.fail(
        new TabExtractionError({
          tabId,
          message: 'Failed to extract HTML from page',
        })
      );
    }

    return result;
  });
}

function executeExtractionViaMessage(
  tabId: number,
  settleTimeMs: number
): Effect.Effect<CapturedPage, TabExtractionError, ChromeTabService> {
  return Effect.gen(function* () {
    const tabService = yield* ChromeTabService;

    // Wait for page to settle before extracting
    yield* sleep(settleTimeMs);

    const response = yield* tabService.sendMessage<GetPageHtmlResponse>(tabId, {
      type: 'query:current_page_dom',
    });

    if (
      response === undefined ||
      !response.success ||
      response.html === undefined ||
      response.html === ''
    ) {
      return yield* Effect.fail(
        new TabExtractionError({
          tabId,
          message: response?.error ?? 'Failed to extract HTML from page via message',
        })
      );
    }

    // Get title from the tab
    const tab = yield* tabService.get(tabId);
    const title = tab.title ?? '';

    return { html: response.html, title };
  });
}

function createTabResource(
  url: string
): Effect.Effect<number, TabCreationError, ChromeTabService | LoggingService> {
  return Effect.gen(function* () {
    const tabService = yield* ChromeTabService;
    const logging = yield* LoggingService;

    return yield* Effect.acquireRelease(
      Effect.gen(function* () {
        yield* logging.debug('Creating tab', { url });
        const tab = yield* tabService.create({ url, active: false });
        return tab.id as number;
      }),
      (tabId) =>
        Effect.gen(function* () {
          yield* logging.debug('Removing tab', { tabId });
          yield* tabService.remove(tabId);
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* logging.error('Failed to close tab', {
                tabId,
                error: String(error),
              });
            })
          )
        )
    );
  });
}

// ============================================================================
// Public API
// ============================================================================

export function renderPage(
  url: string,
  timeoutMs?: number
): Effect.Effect<
  CapturedPage,
  TabRendererError,
  ConfigService | ChromeTabService | ChromeAlarmService | LoggingService
> {
  return Effect.gen(function* () {
    const config = yield* ConfigService;
    const logging = yield* LoggingService;

    const fetchTimeout = timeoutMs ?? (yield* config.get<number>('FETCH_TIMEOUT_MS'));
    const settleTimeMs = yield* config.get<number>('PAGE_SETTLE_TIME_MS').pipe(
      Effect.orElseSucceed(() => 2000)
    );
    const maxMultiplier = yield* config.get<number>('PAGE_SETTLE_MAX_MULTIPLIER').pipe(
      Effect.orElseSucceed(() => 3)
    );
    const maxHtmlSize = yield* config.get<number>('FETCH_MAX_HTML_SIZE');
    const tabCreationDelayMs = yield* config.get<number>('TAB_CREATION_DELAY_MS');

    yield* logging.debug('Rendering page', { url, timeoutMs: fetchTimeout });

    // Keepalive resource
    yield* keepaliveResource();

    // Tab resource with automatic cleanup
    const tabId = yield* createTabResource(url);

    // Wait for tab to load
    yield* waitForTabLoad(tabId, fetchTimeout);

    // Extract content
    const { html, title } = yield* executeExtraction(
      tabId,
      settleTimeMs,
      maxMultiplier
    );

    // Validate size
    if (html.length > maxHtmlSize) {
      return yield* Effect.fail(
        new HtmlTooLargeError({
          sizeBytes: html.length,
          maxSizeBytes: maxHtmlSize,
          message: `HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`,
        })
      );
    }

    // Add delay between tab operations to prevent browser overload during bulk imports
    if (tabCreationDelayMs > 0) {
      yield* sleep(tabCreationDelayMs);
    }

    return { html, title };
  }).pipe(
    Effect.scoped // Ensure all resources are cleaned up
  );
}

// ============================================================================
// Convenience Layers
// ============================================================================

export const TabRendererLive: Layer.Layer<
  ChromeTabService | ChromeAlarmService,
  never,
  never
> = Layer.mergeAll(ChromeTabServiceLive, ChromeAlarmServiceLive);
