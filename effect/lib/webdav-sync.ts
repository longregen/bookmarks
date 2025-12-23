import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import { SettingsService, type ApiSettings } from './settings';
import {
  type BookmarkExport,
  ExportStorageService,
  ExportJobService,
  exportAllBookmarks,
  importBookmarks,
} from './export';
import { EventService, type EventPayloads } from './events';
import { ConfigService } from './config-registry';
import { UrlValidator } from './url-validator';
import { getErrorMessage } from './errors';
import type { SyncStatus } from './messages';

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  action: 'uploaded' | 'downloaded' | 'no-change' | 'skipped' | 'error';
  message: string;
  timestamp?: string;
  bookmarkCount?: number;
}

// ============================================================================
// Errors
// ============================================================================

export class WebDAVConfigError extends Data.TaggedError('WebDAVConfigError')<{
  readonly reason: 'not_configured' | 'validation_failed' | 'missing_credentials';
  readonly message: string;
}> {}

export class WebDAVNetworkError extends Data.TaggedError('WebDAVNetworkError')<{
  readonly url: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly operation: 'HEAD' | 'GET' | 'PUT' | 'PROPFIND' | 'MKCOL';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class WebDAVSyncError extends Data.TaggedError('WebDAVSyncError')<{
  readonly operation: 'upload' | 'download' | 'merge' | 'metadata';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class WebDAVAuthError extends Data.TaggedError('WebDAVAuthError')<{
  readonly url: string;
  readonly message: string;
}> {}

export type WebDAVError =
  | WebDAVConfigError
  | WebDAVNetworkError
  | WebDAVSyncError
  | WebDAVAuthError;

// ============================================================================
// Service Definition
// ============================================================================

export interface RemoteMetadata {
  exists: boolean;
  lastModified?: Date;
  etag?: string;
}

export class WebDAVSyncService extends Context.Tag('WebDAVSyncService')<
  WebDAVSyncService,
  {
    readonly getSyncStatus: () => Effect.Effect<SyncStatus, never, never>;
    readonly isWebDAVConfigured: () => Effect.Effect<boolean, never, SettingsService>;
    readonly performSync: (
      force?: boolean
    ) => Effect.Effect<SyncResult, never, SettingsService | ExportStorageService | ExportJobService | EventService | ConfigService | UrlValidator>;
    readonly triggerSyncIfEnabled: () => Effect.Effect<void, never, SettingsService | ExportStorageService | ExportJobService | EventService | ConfigService | UrlValidator>;
  }
>() {}

// ============================================================================
// Pure Helper Functions
// ============================================================================

function buildBaseUrl(settings: ApiSettings): string {
  const baseUrl = settings.webdavUrl.replace(/\/$/, '');
  const path = settings.webdavPath.replace(/^\//, '').replace(/\/$/, '');
  return `${baseUrl}/${path}`;
}

function buildFileUrl(settings: ApiSettings): string {
  return `${buildBaseUrl(settings)}/bookmarks.json`;
}

function buildFolderUrl(settings: ApiSettings): string {
  return `${buildBaseUrl(settings)}/`;
}

function getAuthHeader(settings: ApiSettings): string {
  return `Basic ${btoa(`${settings.webdavUsername}:${settings.webdavPassword}`)}`;
}

// ============================================================================
// Shared State for Debouncing
// ============================================================================

// Module-level refs for debounce state that persists across calls
const isSyncingRef = Effect.runSync(Ref.make(false));
const lastSyncAttemptRef = Effect.runSync(Ref.make(0));

/**
 * Reset debounce state (for testing)
 */
export function resetSyncState(): void {
  Effect.runSync(Ref.set(isSyncingRef, false));
  Effect.runSync(Ref.set(lastSyncAttemptRef, 0));
}

// ============================================================================
// Effect Operations
// ============================================================================

function isWebDAVConfiguredEffect(): Effect.Effect<
  boolean,
  never,
  SettingsService
> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    const settings = yield* settingsService.getSettings().pipe(
      Effect.catchAll(() => Effect.succeed({} as ApiSettings))
    );

    return !!(
      settings.webdavEnabled &&
      settings.webdavUrl &&
      settings.webdavUsername &&
      settings.webdavPassword
    );
  });
}

function ensureFolderExistsEffect(
  settings: ApiSettings
): Effect.Effect<void, WebDAVNetworkError, never> {
  return Effect.gen(function* () {
    const folderUrl = buildFolderUrl(settings);

    // Try PROPFIND to check if folder exists
    const propfindResult = yield* Effect.tryPromise({
      try: () =>
        fetch(folderUrl, {
          method: 'PROPFIND',
          headers: {
            Depth: '0',
            Authorization: getAuthHeader(settings),
          },
        }),
      catch: (error) =>
        new WebDAVNetworkError({
          url: folderUrl,
          operation: 'PROPFIND',
          message: 'Failed to check folder existence',
          cause: error,
        }),
    });

    // Folder exists
    if (propfindResult.status === 207 || propfindResult.ok) {
      return;
    }

    // Try to create folder with MKCOL
    const mkcolResult = yield* Effect.tryPromise({
      try: () =>
        fetch(folderUrl, {
          method: 'MKCOL',
          headers: {
            Authorization: getAuthHeader(settings),
          },
        }),
      catch: (error) =>
        new WebDAVNetworkError({
          url: folderUrl,
          operation: 'MKCOL',
          message: 'Failed to create folder',
          cause: error,
        }),
    });

    // If MKCOL failed and not because it already exists (405), create parent folders
    if (!mkcolResult.ok && mkcolResult.status !== 405) {
      const pathParts = settings.webdavPath
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .split('/');
      let currentPath = settings.webdavUrl.replace(/\/$/, '');

      for (const part of pathParts) {
        currentPath += `/${part}/`;
        yield* Effect.tryPromise({
          try: () =>
            fetch(currentPath, {
              method: 'MKCOL',
              headers: {
                Authorization: getAuthHeader(settings),
              },
            }),
          catch: () =>
            new WebDAVNetworkError({
              url: currentPath,
              operation: 'MKCOL',
              message: 'Failed to create parent folder',
            }),
        }).pipe(
          Effect.catchAll(() => Effect.void) // Ignore errors - folder might already exist
        );
      }
    }
  });
}

function getRemoteMetadataEffect(
  settings: ApiSettings
): Effect.Effect<RemoteMetadata, WebDAVNetworkError, never> {
  return Effect.gen(function* () {
    const fileUrl = buildFileUrl(settings);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(fileUrl, {
          method: 'HEAD',
          headers: {
            Authorization: getAuthHeader(settings),
          },
        }),
      catch: (error) =>
        new WebDAVNetworkError({
          url: fileUrl,
          operation: 'HEAD',
          message: 'Failed to get remote metadata',
          cause: error,
        }),
    });

    if (response.status === 404) {
      return { exists: false };
    }

    if (!response.ok) {
      return yield* Effect.fail(
        new WebDAVNetworkError({
          url: fileUrl,
          status: response.status,
          statusText: response.statusText,
          operation: 'HEAD',
          message: `HEAD request failed: ${response.status}`,
        })
      );
    }

    const lastModifiedStr = response.headers.get('Last-Modified');
    const etag = response.headers.get('ETag');

    return {
      exists: true,
      lastModified:
        lastModifiedStr !== null && lastModifiedStr !== ''
          ? new Date(lastModifiedStr)
          : undefined,
      etag: etag ?? undefined,
    };
  });
}

function downloadFromServerEffect(
  settings: ApiSettings
): Effect.Effect<BookmarkExport | null, WebDAVNetworkError, never> {
  return Effect.gen(function* () {
    const fileUrl = buildFileUrl(settings);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(fileUrl, {
          method: 'GET',
          headers: {
            Authorization: getAuthHeader(settings),
            Accept: 'application/json',
          },
        }),
      catch: (error) =>
        new WebDAVNetworkError({
          url: fileUrl,
          operation: 'GET',
          message: 'Failed to download from server',
          cause: error,
        }),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return yield* Effect.fail(
        new WebDAVNetworkError({
          url: fileUrl,
          status: response.status,
          statusText: response.statusText,
          operation: 'GET',
          message: `Download failed: ${response.status} ${response.statusText}`,
        })
      );
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<BookmarkExport>,
      catch: (error) =>
        new WebDAVNetworkError({
          url: fileUrl,
          operation: 'GET',
          message: 'Failed to parse JSON response',
          cause: error,
        }),
    });

    return data;
  });
}

function uploadToServerEffect(
  settings: ApiSettings,
  data: BookmarkExport
): Effect.Effect<void, WebDAVNetworkError, never> {
  return Effect.gen(function* () {
    yield* ensureFolderExistsEffect(settings);

    const fileUrl = buildFileUrl(settings);
    const json = JSON.stringify(data, null, 2);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(fileUrl, {
          method: 'PUT',
          headers: {
            Authorization: getAuthHeader(settings),
            'Content-Type': 'application/json',
          },
          body: json,
        }),
      catch: (error) =>
        new WebDAVNetworkError({
          url: fileUrl,
          operation: 'PUT',
          message: 'Failed to upload to server',
          cause: error,
        }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new WebDAVNetworkError({
          url: fileUrl,
          status: response.status,
          statusText: response.statusText,
          operation: 'PUT',
          message: `Upload failed: ${response.status} ${response.statusText}`,
        })
      );
    }
  });
}

function getLocalLastUpdateEffect(): Effect.Effect<
  Date | null,
  never,
  ExportStorageService
> {
  return Effect.gen(function* () {
    const storage = yield* ExportStorageService;
    const bookmarks = yield* storage.getBookmarksArray().pipe(
      Effect.catchAll(() => Effect.succeed([]))
    );

    if (bookmarks.length === 0) {
      return null;
    }

    const sorted = bookmarks.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    return sorted[0]?.updatedAt ?? null;
  });
}

function completeSyncSuccessEffect(
  action: 'uploaded' | 'downloaded' | 'no-change',
  message: string,
  count?: number
): Effect.Effect<SyncResult, never, SettingsService | EventService> {
  return Effect.gen(function* () {
    const timestamp = new Date().toISOString();
    const settingsService = yield* SettingsService;
    const eventService = yield* EventService;

    yield* settingsService.saveSetting('webdavLastSyncTime', timestamp).pipe(
      Effect.catchAll(() => Effect.void)
    );
    yield* settingsService.saveSetting('webdavLastSyncError', '').pipe(
      Effect.catchAll(() => Effect.void)
    );

    yield* eventService.broadcastEvent('sync:completed', { action, bookmarkCount: count }).pipe(
      Effect.catchAll(() => Effect.void)
    );

    return {
      success: true,
      action,
      message,
      timestamp,
      bookmarkCount: count,
    };
  });
}

function performSyncEffect(
  force = false
): Effect.Effect<
  SyncResult,
  never,
  SettingsService | ExportStorageService | ExportJobService | EventService | ConfigService | UrlValidator
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const settingsService = yield* SettingsService;
    const eventService = yield* EventService;
    const urlValidator = yield* UrlValidator;

    // Check debounce
    const now = Date.now();

    const lastAttempt = yield* Ref.get(lastSyncAttemptRef);
    const debounceMs = yield* configService.get('WEBDAV_SYNC_DEBOUNCE_MS');

    if (!force && now - lastAttempt < debounceMs) {
      return {
        success: true,
        action: 'skipped' as const,
        message: 'Sync debounced (too frequent)',
      };
    }

    yield* Ref.set(lastSyncAttemptRef, now);

    // Check if configured
    const configured = yield* isWebDAVConfiguredEffect();
    if (!configured) {
      return {
        success: false,
        action: 'skipped' as const,
        message: 'WebDAV not configured or disabled',
      };
    }

    // Check if already syncing
    const alreadySyncing = yield* Ref.get(isSyncingRef);
    if (alreadySyncing) {
      return {
        success: true,
        action: 'skipped' as const,
        message: 'Sync already in progress',
      };
    }

    yield* Ref.set(isSyncingRef, true);

    // Broadcast sync started event
    yield* eventService.broadcastEvent('sync:started', { manual: force }).pipe(
      Effect.catchAll(() => Effect.void)
    );

    const result = yield* Effect.gen(function* () {
      const settings = yield* settingsService.getSettings();

      // Validate URL
      const validation = yield* urlValidator.validateWebDAVUrl(
        settings.webdavUrl,
        settings.webdavAllowInsecure
      );

      if (!validation.valid) {
        const errorMessage = validation.error ?? 'Connection validation failed';
        yield* settingsService.saveSetting('webdavLastSyncError', errorMessage).pipe(
          Effect.catchAll(() => Effect.void)
        );
        return {
          success: false,
          action: 'error' as const,
          message: errorMessage,
        };
      }

      // Get remote metadata
      const remote = yield* getRemoteMetadataEffect(settings);
      const localLastUpdate = yield* getLocalLastUpdateEffect();
      const localData = yield* exportAllBookmarks();

      // Remote file doesn't exist
      if (!remote.exists) {
        if (localData.bookmarkCount > 0) {
          yield* uploadToServerEffect(settings, localData);
          return yield* completeSyncSuccessEffect(
            'uploaded',
            `Uploaded ${localData.bookmarkCount} bookmarks`,
            localData.bookmarkCount
          );
        } else {
          return yield* completeSyncSuccessEffect('no-change', 'No bookmarks to sync');
        }
      }

      // Download remote data
      const remoteData = yield* downloadFromServerEffect(settings);

      if (!remoteData) {
        yield* uploadToServerEffect(settings, localData);
        return yield* completeSyncSuccessEffect(
          'uploaded',
          `Uploaded ${localData.bookmarkCount} bookmarks`,
          localData.bookmarkCount
        );
      }

      // Compare timestamps to determine sync direction
      const remoteExportTime = new Date(remoteData.exportedAt);
      const localExportTime = localLastUpdate ?? new Date(0);

      if (remoteExportTime > localExportTime) {
        // Download and merge
        const result = yield* importBookmarks(remoteData, 'webdav-sync');
        const mergedData = yield* exportAllBookmarks();
        yield* uploadToServerEffect(settings, mergedData);
        return yield* completeSyncSuccessEffect(
          'downloaded',
          `Imported ${result.imported} bookmarks (${result.skipped} duplicates)`,
          result.imported
        );
      } else {
        // Upload local data
        yield* uploadToServerEffect(settings, localData);
        return yield* completeSyncSuccessEffect(
          'uploaded',
          `Uploaded ${localData.bookmarkCount} bookmarks`,
          localData.bookmarkCount
        );
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage = getErrorMessage(error);
          yield* settingsService.saveSetting('webdavLastSyncError', errorMessage).pipe(
            Effect.catchAll(() => Effect.void)
          );

          yield* eventService.broadcastEvent('sync:failed', { error: errorMessage }).pipe(
            Effect.catchAll(() => Effect.void)
          );

          return {
            success: false,
            action: 'error' as const,
            message: errorMessage,
          };
        })
      )
    );

    yield* Ref.set(isSyncingRef, false);
    return result;
  });
}

// ============================================================================
// Service Layer Implementation
// ============================================================================

export const WebDAVSyncServiceLive: Layer.Layer<
  WebDAVSyncService,
  never,
  never
> = Layer.effect(
  WebDAVSyncService,
  Effect.gen(function* () {
    const isSyncingRef = yield* Ref.make(false);
    const lastSyncAttemptRef = yield* Ref.make(0);

    return {
      getSyncStatus: () =>
        Effect.gen(function* () {
          const isSyncing = yield* Ref.get(isSyncingRef);
          // Note: We can't access settings here without the SettingsService dependency
          // This is a simplified version - in practice, you'd need to require SettingsService
          return {
            lastSyncTime: null,
            lastSyncError: null,
            isSyncing,
          };
        }),

      isWebDAVConfigured: () => isWebDAVConfiguredEffect(),

      performSync: (force = false) => performSyncEffect(force),

      triggerSyncIfEnabled: () =>
        Effect.gen(function* () {
          const configured = yield* isWebDAVConfiguredEffect();
          if (configured) {
            yield* performSyncEffect();
          }
        }).pipe(Effect.asVoid),
    };
  })
);

// ============================================================================
// Public API Functions (for compatibility with existing code)
// ============================================================================

/**
 * Get current sync status
 */
export function getSyncStatus(): Effect.Effect<SyncStatus, never, SettingsService> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    const settings = yield* settingsService.getSettings().pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          webdavLastSyncTime: '',
          webdavLastSyncError: '',
        } as ApiSettings)
      )
    );

    return {
      lastSyncTime: settings.webdavLastSyncTime || null,
      lastSyncError: settings.webdavLastSyncError || null,
      isSyncing: false, // This would need state management for accurate tracking
    };
  });
}

/**
 * Perform a WebDAV sync operation
 */
export function performSync(
  force = false
): Effect.Effect<
  SyncResult,
  never,
  SettingsService | ExportStorageService | ExportJobService | EventService | ConfigService | UrlValidator
> {
  return performSyncEffect(force);
}

/**
 * Trigger sync if WebDAV is configured and enabled
 */
export function triggerSyncIfEnabled(): Effect.Effect<
  void,
  never,
  SettingsService | ExportStorageService | ExportJobService | EventService | ConfigService | UrlValidator
> {
  return Effect.gen(function* () {
    const configured = yield* isWebDAVConfiguredEffect();
    if (configured) {
      yield* performSyncEffect();
    }
  }).pipe(Effect.asVoid);
}
