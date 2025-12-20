import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from '../lib/effect-utils';
import { LoggingService } from '../services/logging-service';
import {
  MessagingService,
  MessagingServiceChromeLayer,
  type Message,
  type SaveBookmarkResponse,
  type StartBulkImportResponse,
  type TabInfo,
  type StartProcessingResponse,
  type TriggerSyncResponse,
  type SyncStatus,
  type UpdateSyncSettingsResponse,
} from '../lib/messages';
import { getErrorMessage } from '../lib/errors';
import {
  ChromeApiError,
  wrapChromePromise,
  wrapChromeCallback,
  wrapChromeVoidPromise,
} from './utils/chrome-api';
import {
  createStandardMessageHandler,
  createNoArgMessageHandler,
} from './utils/message-handlers';
import {
  createChromeEventListener,
  createSimpleChromeEventListener,
} from './utils/event-listeners';

// ============================================================================
// Errors
// ============================================================================

export class ServiceWorkerError extends Data.TaggedError('ServiceWorkerError')<{
  readonly operation: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

// ============================================================================
// ChromeRuntimeService - Manages Chrome API interactions
// ============================================================================

export class ChromeRuntimeService extends Context.Tag('ChromeRuntimeService')<
  ChromeRuntimeService,
  {
    readonly queryActiveTab: () => Effect.Effect<
      chrome.tabs.Tab,
      ChromeApiError,
      never
    >;

    readonly executeScript: <T>(
      tabId: number,
      func: () => T
    ) => Effect.Effect<void, ChromeApiError, never>;

    readonly createAlarm: (
      name: string,
      options: chrome.alarms.AlarmCreateInfo
    ) => Effect.Effect<void, ChromeApiError, never>;

    readonly clearAlarm: (name: string) => Effect.Effect<void, ChromeApiError, never>;
  }
>() {}

const makeChromeRuntimeService = Effect.sync(() => ({
  queryActiveTab: () =>
    wrapChromeCallback<chrome.tabs.Tab>(
      'queryActiveTab',
      (resume) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs.at(0);
          if (tab === undefined) {
            throw new Error('No active tab found');
          }
          resume(tab);
        });
      }
    ),

  executeScript: <T>(tabId: number, func: () => T) =>
    wrapChromeVoidPromise(
      'executeScript',
      () =>
        chrome.scripting.executeScript({
          target: { tabId },
          func,
        })
    ),

  createAlarm: (name: string, options: chrome.alarms.AlarmCreateInfo) =>
    wrapChromePromise(
      'createAlarm',
      () => chrome.alarms.create(name, options)
    ),

  clearAlarm: (name: string) =>
    wrapChromeVoidPromise(
      'clearAlarm',
      () => chrome.alarms.clear(name)
    ),
}));

const ChromeRuntimeServiceLayer = makeEffectLayer(
  ChromeRuntimeService,
  makeChromeRuntimeService
);

// ============================================================================
// BookmarkService - Manages bookmark operations
// ============================================================================

export class BookmarkService extends Context.Tag('BookmarkService')<
  BookmarkService,
  {
    readonly saveBookmark: (data: {
      url: string;
      title: string;
      html: string;
    }) => Effect.Effect<SaveBookmarkResponse, ServiceWorkerError, never>;

    readonly startBulkImport: (
      urls: string[]
    ) => Effect.Effect<StartBulkImportResponse, ServiceWorkerError, never>;
  }
>() {}

const makeBookmarkService = Effect.gen(function* () {
  const { db } = yield* Effect.promise(() => import('../db/schema'));

  return {
    saveBookmark: (data: { url: string; title: string; html: string }) =>
      Effect.gen(function* () {
        const { url, title, html } = data;

        try {
          const existing = yield* Effect.promise(() =>
            db.bookmarks.where('url').equals(url).first()
          );

          if (existing) {
            yield* Effect.promise(() =>
              db.bookmarks.update(existing.id, {
                title,
                html,
                status: 'pending' as const,
                errorMessage: undefined,
                updatedAt: new Date(),
              })
            );

            return { success: true, bookmarkId: existing.id, updated: true };
          }

          const id = crypto.randomUUID();
          const now = new Date();

          yield* Effect.promise(() =>
            db.bookmarks.add({
              id,
              url,
              title,
              html,
              status: 'pending' as const,
              createdAt: now,
              updatedAt: now,
            })
          );

          return { success: true, bookmarkId: id };
        } catch (error) {
          return yield* Effect.fail(
            new ServiceWorkerError({
              operation: 'saveBookmark',
              message: getErrorMessage(error),
              originalError: error,
            })
          );
        }
      }),

    startBulkImport: (urls: string[]) =>
      Effect.gen(function* () {
        try {
          if (__IS_CHROME__) {
            const { ensureOffscreenDocument } = yield* Effect.promise(() =>
              import('../lib/offscreen')
            );
            yield* Effect.promise(() => ensureOffscreenDocument());
          }

          const { createBulkImportJob } = yield* Effect.promise(() =>
            import('../lib/bulk-import')
          );
          const jobId = yield* Effect.promise(() => createBulkImportJob(urls));

          return {
            success: true,
            jobId,
            totalUrls: urls.length,
          };
        } catch (error) {
          return yield* Effect.fail(
            new ServiceWorkerError({
              operation: 'startBulkImport',
              message: getErrorMessage(error),
              originalError: error,
            })
          );
        }
      }),
  };
});

const BookmarkServiceLayer = makeEffectLayer(BookmarkService, makeBookmarkService);

// ============================================================================
// QueueService - Manages job queue operations
// ============================================================================

export class QueueService extends Context.Tag('QueueService')<
  QueueService,
  {
    readonly startProcessing: () => Effect.Effect<void, ServiceWorkerError, never>;
  }
>() {}

const makeQueueService = Effect.gen(function* () {
  const { startProcessingQueue } = yield* Effect.promise(() =>
    import('../../src/background/queue')
  );

  return {
    startProcessing: () =>
      Effect.tryPromise({
        try: () => startProcessingQueue(),
        catch: (error) =>
          new ServiceWorkerError({
            operation: 'startProcessing',
            message: getErrorMessage(error),
            originalError: error,
          }),
      }),
  };
});

const QueueServiceLayer = makeEffectLayer(QueueService, makeQueueService);

// ============================================================================
// SyncService - Manages WebDAV sync operations
// ============================================================================

export class SyncService extends Context.Tag('SyncService')<
  SyncService,
  {
    readonly performSync: (
      force: boolean
    ) => Effect.Effect<TriggerSyncResponse, ServiceWorkerError, never>;

    readonly getSyncStatus: () => Effect.Effect<SyncStatus, ServiceWorkerError, never>;

    readonly triggerSyncIfEnabled: () => Effect.Effect<void, ServiceWorkerError, never>;
  }
>() {}

const makeSyncService = Effect.gen(function* () {
  const { performSync, getSyncStatus, triggerSyncIfEnabled } = yield* Effect.promise(
    () => import('../../src/lib/webdav-sync')
  );

  return {
    performSync: (force: boolean) =>
      Effect.tryPromise({
        try: () => performSync(force),
        catch: (error) =>
          new ServiceWorkerError({
            operation: 'performSync',
            message: getErrorMessage(error),
            originalError: error,
          }),
      }),

    getSyncStatus: () =>
      Effect.tryPromise({
        try: () => getSyncStatus(),
        catch: (error) =>
          new ServiceWorkerError({
            operation: 'getSyncStatus',
            message: getErrorMessage(error),
            originalError: error,
          }),
      }),

    triggerSyncIfEnabled: () =>
      Effect.tryPromise({
        try: () => triggerSyncIfEnabled(),
        catch: (error) =>
          new ServiceWorkerError({
            operation: 'triggerSyncIfEnabled',
            message: getErrorMessage(error),
            originalError: error,
          }),
      }),
  };
});

const SyncServiceLayer = makeEffectLayer(SyncService, makeSyncService);

// ============================================================================
// SettingsService - Manages extension settings
// ============================================================================

export class SettingsService extends Context.Tag('SettingsService')<
  SettingsService,
  {
    readonly getSettings: () => Effect.Effect<
      {
        webdavEnabled: boolean;
        webdavSyncInterval: number;
      },
      ServiceWorkerError,
      never
    >;
  }
>() {}

const makeSettingsService = Effect.gen(function* () {
  const { getSettings } = yield* Effect.promise(() => import('../../src/lib/settings'));

  return {
    getSettings: () =>
      Effect.tryPromise({
        try: () => getSettings(),
        catch: (error) =>
          new ServiceWorkerError({
            operation: 'getSettings',
            message: getErrorMessage(error),
            originalError: error,
          }),
      }),
  };
});

const SettingsServiceLayer = makeEffectLayer(SettingsService, makeSettingsService);

// ============================================================================
// PlatformService - Manages platform adapter setup
// ============================================================================

export class PlatformService extends Context.Tag('PlatformService')<
  PlatformService,
  {
    readonly initialize: () => Effect.Effect<void, never, never>;
  }
>() {}

const makePlatformService = Effect.gen(function* () {
  const { setPlatformAdapter } = yield* Effect.promise(() =>
    import('../../src/lib/platform')
  );
  const { extensionAdapter } = yield* Effect.promise(() =>
    import('../../src/lib/adapters/extension')
  );

  return {
    initialize: () =>
      Effect.sync(() => {
        setPlatformAdapter(extensionAdapter);
      }),
  };
});

const PlatformServiceLayer = makeEffectLayer(PlatformService, makePlatformService);

// ============================================================================
// Alarm Management
// ============================================================================

const WEBDAV_SYNC_ALARM = 'webdav-sync';

const setupSyncAlarm = Effect.gen(function* () {
  const chromeRuntime = yield* ChromeRuntimeService;
  const settings = yield* SettingsService;
  const logging = yield* LoggingService;

  const config = yield* settings.getSettings();

  yield* chromeRuntime.clearAlarm(WEBDAV_SYNC_ALARM);

  if (config.webdavEnabled && config.webdavSyncInterval > 0) {
    yield* chromeRuntime.createAlarm(WEBDAV_SYNC_ALARM, {
      periodInMinutes: config.webdavSyncInterval,
      delayInMinutes: 1,
    });

    yield* logging.info(
      `WebDAV sync alarm set for every ${config.webdavSyncInterval} minutes`
    );
  } else {
    yield* logging.info('WebDAV sync alarm disabled');
  }
});

// ============================================================================
// Message Handlers
// ============================================================================

const handleSaveBookmark = (data: {
  url: string;
  title: string;
  html: string;
}): Effect.Effect<
  SaveBookmarkResponse,
  ServiceWorkerError,
  BookmarkService | QueueService
> =>
  Effect.gen(function* () {
    const bookmarkService = yield* BookmarkService;
    const queueService = yield* QueueService;

    const response = yield* bookmarkService.saveBookmark(data);
    yield* queueService.startProcessing();

    return response;
  });

const handleBulkImport = (
  urls: string[]
): Effect.Effect<
  StartBulkImportResponse,
  ServiceWorkerError,
  BookmarkService | QueueService
> =>
  Effect.gen(function* () {
    const bookmarkService = yield* BookmarkService;
    const queueService = yield* QueueService;

    const response = yield* bookmarkService.startBulkImport(urls);
    yield* queueService.startProcessing();

    return response;
  });

const handleSyncTrigger: Effect.Effect<
  TriggerSyncResponse,
  ServiceWorkerError,
  SyncService
> = Effect.gen(function* () {
  const syncService = yield* SyncService;
  return yield* syncService.performSync(true);
});

const handleSyncStatus: Effect.Effect<
  SyncStatus,
  ServiceWorkerError,
  SyncService
> = Effect.gen(function* () {
  const syncService = yield* SyncService;
  return yield* syncService.getSyncStatus();
});

const handleSyncUpdateSettings: Effect.Effect<
  UpdateSyncSettingsResponse,
  ServiceWorkerError,
  ChromeRuntimeService | SettingsService | LoggingService
> = Effect.gen(function* () {
  yield* setupSyncAlarm;
  return { success: true };
});

const handleCurrentTabInfo: Effect.Effect<
  TabInfo,
  ChromeApiError,
  ChromeRuntimeService
> = Effect.gen(function* () {
  const chromeRuntime = yield* ChromeRuntimeService;

  const tab = yield* chromeRuntime.queryActiveTab();

  if (tab.url !== undefined && tab.url !== '' && tab.title !== undefined && tab.title !== '') {
    return {
      url: tab.url,
      title: tab.title,
    };
  }

  return {
    error:
      'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)',
  };
});

const handleBookmarkRetry: Effect.Effect<
  StartProcessingResponse,
  ServiceWorkerError,
  QueueService
> = Effect.gen(function* () {
  const queueService = yield* QueueService;
  yield* queueService.startProcessing();
  return { success: true };
});

// ============================================================================
// Event Listeners
// ============================================================================

const registerMessageListeners = Effect.gen(function* () {
  const messaging = yield* MessagingService;
  const logging = yield* LoggingService;

  const cleanups: Array<() => void> = [];

  yield* logging.debug('Registering message listeners');

  // bookmark:save_from_page
  cleanups.push(
    yield* createStandardMessageHandler(
      messaging,
      'bookmark:save_from_page',
      (msg: { data: { url: string; title: string; html: string } }) =>
        handleSaveBookmark(msg.data),
      MainLayer
    )
  );

  // import:create_from_url_list
  cleanups.push(
    yield* createStandardMessageHandler(
      messaging,
      'import:create_from_url_list',
      (msg: { urls: string[] }) => handleBulkImport(msg.urls),
      MainLayer
    )
  );

  // sync:trigger
  cleanups.push(
    yield* createStandardMessageHandler(
      messaging,
      'sync:trigger',
      () => handleSyncTrigger,
      MainLayer
    )
  );

  // query:sync_status
  cleanups.push(
    yield* createNoArgMessageHandler(
      messaging,
      'query:sync_status',
      handleSyncStatus,
      MainLayer,
      (error) => ({
        lastSyncTime: null,
        lastSyncError: getErrorMessage(error),
        isSyncing: false,
      })
    )
  );

  // sync:update_settings
  cleanups.push(
    yield* createStandardMessageHandler(
      messaging,
      'sync:update_settings',
      () => handleSyncUpdateSettings,
      MainLayer
    )
  );

  // query:current_tab_info
  cleanups.push(
    yield* createNoArgMessageHandler(
      messaging,
      'query:current_tab_info',
      handleCurrentTabInfo,
      MainLayer,
      (error) => ({ error: getErrorMessage(error) })
    )
  );

  // bookmark:retry
  cleanups.push(
    yield* createStandardMessageHandler(
      messaging,
      'bookmark:retry',
      () => handleBookmarkRetry,
      MainLayer
    )
  );

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
});

const registerAlarmListener = createChromeEventListener(
  chrome.alarms.onAlarm,
  'alarm',
  (alarm: chrome.alarms.Alarm) =>
    Effect.gen(function* () {
      if (alarm.name === WEBDAV_SYNC_ALARM) {
        const syncService = yield* SyncService;
        const logging = yield* LoggingService;

        yield* logging.info('WebDAV sync alarm triggered');
        yield* syncService.triggerSyncIfEnabled();
      }
    }),
  MainLayer
);

const registerCommandListener = createChromeEventListener(
  chrome.commands.onCommand,
  'command',
  (command: string) =>
    Effect.gen(function* () {
      if (command === 'save-bookmark') {
        const chromeRuntime = yield* ChromeRuntimeService;
        const logging = yield* LoggingService;

        const tab = yield* chromeRuntime.queryActiveTab();

        if (tab.id === undefined) {
          yield* logging.warn('Cannot save bookmark: tab ID is undefined');
          return;
        }

        if (tab.url === undefined || tab.url === '') {
          yield* logging.warn(
            'Cannot save bookmark: tab URL is undefined (incognito mode or restricted URL)'
          );
          return;
        }

        yield* chromeRuntime.executeScript(tab.id, () => {
          void chrome.runtime.sendMessage({
            type: 'user_request:capture_current_tab',
          });
        });
      }
    }),
  MainLayer
);

const registerInstallListener = createSimpleChromeEventListener(
  chrome.runtime.onInstalled,
  'install',
  'Extension installed/updated',
  initializeExtension,
  MainLayer
);

const registerStartupListener = createSimpleChromeEventListener(
  chrome.runtime.onStartup,
  'startup',
  'Browser started, initializing',
  initializeExtension,
  MainLayer
);

// ============================================================================
// Initialization
// ============================================================================

const initializeExtension = Effect.gen(function* () {
  const logging = yield* LoggingService;
  const queueService = yield* QueueService;
  const syncService = yield* SyncService;

  yield* logging.info('Initializing extension...');

  yield* queueService.startProcessing().pipe(
    Effect.catchAll((error) =>
      logging.error('Error starting queue processing', {
        error: getErrorMessage(error),
      })
    )
  );

  yield* setupSyncAlarm.pipe(
    Effect.catchAll((error) =>
      logging.error('Error setting up sync alarm', {
        error: getErrorMessage(error),
      })
    )
  );

  yield* syncService.triggerSyncIfEnabled().pipe(
    Effect.catchAll((error) =>
      logging.error('Initial WebDAV sync failed', {
        error: getErrorMessage(error),
      })
    )
  );

  yield* logging.info('Extension initialization complete');
});

// ============================================================================
// Service Layer Composition
// ============================================================================

const AppLayer = Layer.mergeAll(
  MessagingServiceChromeLayer,
  ChromeRuntimeServiceLayer,
  BookmarkServiceLayer,
  QueueServiceLayer,
  SyncServiceLayer,
  SettingsServiceLayer,
  PlatformServiceLayer
);

const LoggingServiceLayer = makeLayer(LoggingService, {
  debug: (message: string, context?: Record<string, unknown>) =>
    Effect.sync(() => {
      if (context) {
        console.log(`[DEBUG] ${message}`, context);
      } else {
        console.log(`[DEBUG] ${message}`);
      }
    }),

  info: (message: string, context?: Record<string, unknown>) =>
    Effect.sync(() => {
      if (context) {
        console.log(`[INFO] ${message}`, context);
      } else {
        console.log(`[INFO] ${message}`);
      }
    }),

  warn: (message: string, context?: Record<string, unknown>) =>
    Effect.sync(() => {
      if (context) {
        console.warn(`[WARN] ${message}`, context);
      } else {
        console.warn(`[WARN] ${message}`);
      }
    }),

  error: (message: string, context?: Record<string, unknown>) =>
    Effect.sync(() => {
      if (context) {
        console.error(`[ERROR] ${message}`, context);
      } else {
        console.error(`[ERROR] ${message}`);
      }
    }),
});

const MainLayer = Layer.mergeAll(AppLayer, LoggingServiceLayer);

// ============================================================================
// Main Program
// ============================================================================

const program = Effect.gen(function* () {
  const logging = yield* LoggingService;
  const platform = yield* PlatformService;

  yield* platform.initialize();
  yield* logging.info('Bookmark RAG service worker loaded');

  yield* registerMessageListeners;
  yield* registerAlarmListener;
  yield* registerCommandListener;
  yield* registerInstallListener;
  yield* registerStartupListener;

  yield* initializeExtension;

  yield* logging.info('Service worker fully initialized');
});

// Run the program
// Skip during tests to avoid initialization errors
if (!import.meta.vitest) {
  Effect.runPromise(program.pipe(Effect.provide(MainLayer))).catch((error) => {
    console.error('Service worker initialization failed:', error);
  });
}
