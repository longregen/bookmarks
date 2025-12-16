import { getSettings, saveSetting, type ApiSettings } from './settings';
import { exportAllBookmarks, importBookmarks, type BookmarkExport } from './export';
import { db } from '../db/schema';
import { createStateManager } from './state-manager';
import { broadcastEvent } from './events';
import { WEBDAV_SYNC_TIMEOUT_MS, WEBDAV_SYNC_DEBOUNCE_MS } from './constants';

// Sync state manager
const syncState = createStateManager({
  name: 'WebDAVSync',
  timeoutMs: WEBDAV_SYNC_TIMEOUT_MS,
});

// Debouncing state (separate from sync state)
let lastSyncAttempt = 0;

export interface SyncResult {
  success: boolean;
  action: 'uploaded' | 'downloaded' | 'no-change' | 'skipped' | 'error';
  message: string;
  timestamp?: string;
  bookmarkCount?: number;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  lastSyncError: string | null;
  isSyncing: boolean;
}

/**
 * Validate that a WebDAV URL uses HTTPS or is explicitly allowed to use HTTP
 */
export function validateSecureConnection(settings: ApiSettings): { valid: boolean; error?: string } {
  if (!settings.webdavUrl) {
    return { valid: false, error: 'WebDAV URL is not configured' };
  }

  try {
    const url = new URL(settings.webdavUrl);

    // Check if protocol is HTTP (insecure)
    if (url.protocol === 'http:') {
      if (!settings.webdavAllowInsecure) {
        return {
          valid: false,
          error: 'HTTP connections are not allowed for security reasons. Please use HTTPS or enable "Allow insecure connections" in settings.',
        };
      }
      // HTTP is allowed but log a warning
      console.warn('WARNING: WebDAV is using an insecure HTTP connection. Credentials are being sent in plain text.');
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid WebDAV URL format' };
  }
}

/**
 * Get current sync status from settings
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const settings = await getSettings();
  return {
    lastSyncTime: settings.webdavLastSyncTime || null,
    lastSyncError: settings.webdavLastSyncError || null,
    isSyncing: syncState.isActive(),
  };
}

/**
 * Check if WebDAV sync is properly configured
 */
export async function isWebDAVConfigured(): Promise<boolean> {
  const settings = await getSettings();
  return !!(
    settings.webdavEnabled &&
    settings.webdavUrl &&
    settings.webdavUsername &&
    settings.webdavPassword
  );
}

/**
 * Build the full WebDAV file URL for bookmarks.json
 */
function buildFileUrl(settings: ApiSettings): string {
  const baseUrl = settings.webdavUrl.replace(/\/$/, '');
  const path = settings.webdavPath.replace(/^\//, '').replace(/\/$/, '');
  return `${baseUrl}/${path}/bookmarks.json`;
}

/**
 * Build the folder URL for ensuring the sync folder exists
 */
function buildFolderUrl(settings: ApiSettings): string {
  const baseUrl = settings.webdavUrl.replace(/\/$/, '');
  const path = settings.webdavPath.replace(/^\//, '').replace(/\/$/, '');
  return `${baseUrl}/${path}/`;
}

/**
 * Get auth header for WebDAV requests
 */
function getAuthHeader(settings: ApiSettings): string {
  return 'Basic ' + btoa(`${settings.webdavUsername}:${settings.webdavPassword}`);
}

/**
 * Ensure the sync folder exists on the server
 */
async function ensureFolderExists(settings: ApiSettings): Promise<void> {
  const folderUrl = buildFolderUrl(settings);

  // Try PROPFIND first to check if folder exists
  try {
    const response = await fetch(folderUrl, {
      method: 'PROPFIND',
      headers: {
        'Depth': '0',
        'Authorization': getAuthHeader(settings),
      },
    });

    if (response.status === 207 || response.ok) {
      return; // Folder exists
    }
  } catch {
    // Folder might not exist, try to create it
  }

  // Create folder with MKCOL
  const mkcolResponse = await fetch(folderUrl, {
    method: 'MKCOL',
    headers: {
      'Authorization': getAuthHeader(settings),
    },
  });

  // 201 Created, 405 Method Not Allowed (folder exists), or 409 Conflict (parent missing)
  if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
    // Try to create parent folders one by one
    const pathParts = settings.webdavPath.replace(/^\//, '').replace(/\/$/, '').split('/');
    let currentPath = settings.webdavUrl.replace(/\/$/, '');

    for (const part of pathParts) {
      currentPath += '/' + part + '/';
      await fetch(currentPath, {
        method: 'MKCOL',
        headers: {
          'Authorization': getAuthHeader(settings),
        },
      });
    }
  }
}

/**
 * Get remote file metadata (Last-Modified, ETag)
 */
async function getRemoteMetadata(settings: ApiSettings): Promise<{
  exists: boolean;
  lastModified?: Date;
  etag?: string;
}> {
  const fileUrl = buildFileUrl(settings);

  try {
    const response = await fetch(fileUrl, {
      method: 'HEAD',
      headers: {
        'Authorization': getAuthHeader(settings),
      },
    });

    if (response.status === 404) {
      return { exists: false };
    }

    if (!response.ok) {
      throw new Error(`HEAD request failed: ${response.status}`);
    }

    const lastModifiedStr = response.headers.get('Last-Modified');
    const etag = response.headers.get('ETag') || undefined;

    return {
      exists: true,
      lastModified: lastModifiedStr ? new Date(lastModifiedStr) : undefined,
      etag,
    };
  } catch (error) {
    // Assume file doesn't exist if we can't check
    return { exists: false };
  }
}

/**
 * Download bookmarks from WebDAV server
 */
async function downloadFromServer(settings: ApiSettings): Promise<BookmarkExport | null> {
  const fileUrl = buildFileUrl(settings);

  const response = await fetch(fileUrl, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(settings),
      'Accept': 'application/json',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data as BookmarkExport;
}

/**
 * Upload bookmarks to WebDAV server
 */
async function uploadToServer(settings: ApiSettings, data: BookmarkExport): Promise<void> {
  await ensureFolderExists(settings);

  const fileUrl = buildFileUrl(settings);
  const json = JSON.stringify(data, null, 2);

  const response = await fetch(fileUrl, {
    method: 'PUT',
    headers: {
      'Authorization': getAuthHeader(settings),
      'Content-Type': 'application/json',
    },
    body: json,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Get local bookmarks' last update time
 */
async function getLocalLastUpdate(): Promise<Date | null> {
  const bookmarks = await db.bookmarks.orderBy('updatedAt').reverse().first();
  return bookmarks?.updatedAt || null;
}

/**
 * Perform WebDAV sync
 *
 * Strategy:
 * 1. If no remote file: upload local data
 * 2. If remote exists: compare timestamps
 *    - Local newer: upload
 *    - Remote newer: download and merge (import new bookmarks)
 *    - Same: no action needed
 */
export async function performSync(force = false): Promise<SyncResult> {
  // Debounce rapid sync requests
  const now = Date.now();
  if (!force && now - lastSyncAttempt < WEBDAV_SYNC_DEBOUNCE_MS) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync debounced (too frequent)',
    };
  }

  lastSyncAttempt = now;

  // Check configuration
  if (!await isWebDAVConfigured()) {
    return {
      success: false,
      action: 'skipped',
      message: 'WebDAV not configured or disabled',
    };
  }

  // Try to start syncing (returns false if already active)
  if (!syncState.start()) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync already in progress',
    };
  }

  // Broadcast that sync has started
  await broadcastEvent('SYNC_STATUS_UPDATED', { isSyncing: true });

  try {
    const settings = await getSettings();

    // Validate secure connection
    const validation = validateSecureConnection(settings);
    if (!validation.valid) {
      await saveSetting('webdavLastSyncError', validation.error || 'Connection validation failed');
      return {
        success: false,
        action: 'error',
        message: validation.error || 'Connection validation failed',
      };
    }

    // Get remote metadata
    const remote = await getRemoteMetadata(settings);
    const localLastUpdate = await getLocalLastUpdate();

    // Export local data
    const localData = await exportAllBookmarks();

    if (!remote.exists) {
      // No remote file - upload local data
      if (localData.bookmarkCount > 0) {
        await uploadToServer(settings, localData);
        const timestamp = new Date().toISOString();
        await saveSetting('webdavLastSyncTime', timestamp);
        await saveSetting('webdavLastSyncError', '');

        // Broadcast sync completed
        await broadcastEvent('SYNC_STATUS_UPDATED', {
          isSyncing: false,
          lastSyncTime: timestamp,
          lastSyncError: null
        });

        return {
          success: true,
          action: 'uploaded',
          message: `Uploaded ${localData.bookmarkCount} bookmarks`,
          timestamp,
          bookmarkCount: localData.bookmarkCount,
        };
      } else {
        // Nothing to sync
        const timestamp = new Date().toISOString();
        await saveSetting('webdavLastSyncTime', timestamp);
        await saveSetting('webdavLastSyncError', '');

        // Broadcast sync completed
        await broadcastEvent('SYNC_STATUS_UPDATED', {
          isSyncing: false,
          lastSyncTime: timestamp,
          lastSyncError: null
        });

        return {
          success: true,
          action: 'no-change',
          message: 'No bookmarks to sync',
          timestamp,
        };
      }
    }

    // Remote exists - compare timestamps
    const remoteData = await downloadFromServer(settings);

    if (!remoteData) {
      // Failed to download remote data, upload local
      await uploadToServer(settings, localData);
      const timestamp = new Date().toISOString();
      await saveSetting('webdavLastSyncTime', timestamp);
      await saveSetting('webdavLastSyncError', '');

      // Broadcast sync completed
      await broadcastEvent('SYNC_STATUS_UPDATED', {
        isSyncing: false,
        lastSyncTime: timestamp,
        lastSyncError: null
      });

      return {
        success: true,
        action: 'uploaded',
        message: `Uploaded ${localData.bookmarkCount} bookmarks`,
        timestamp,
        bookmarkCount: localData.bookmarkCount,
      };
    }

    // Compare timestamps
    const remoteExportTime = new Date(remoteData.exportedAt);
    const localExportTime = localLastUpdate || new Date(0);

    if (remoteExportTime > localExportTime) {
      // Remote is newer - import new bookmarks
      const result = await importBookmarks(remoteData, 'webdav-sync');
      const timestamp = new Date().toISOString();
      await saveSetting('webdavLastSyncTime', timestamp);
      await saveSetting('webdavLastSyncError', '');

      // After importing, upload merged data
      const mergedData = await exportAllBookmarks();
      await uploadToServer(settings, mergedData);

      // Broadcast sync completed
      await broadcastEvent('SYNC_STATUS_UPDATED', {
        isSyncing: false,
        lastSyncTime: timestamp,
        lastSyncError: null
      });

      return {
        success: true,
        action: 'downloaded',
        message: `Imported ${result.imported} bookmarks (${result.skipped} duplicates)`,
        timestamp,
        bookmarkCount: result.imported,
      };
    } else {
      // Local is newer or same - upload local data
      await uploadToServer(settings, localData);
      const timestamp = new Date().toISOString();
      await saveSetting('webdavLastSyncTime', timestamp);
      await saveSetting('webdavLastSyncError', '');

      // Broadcast sync completed
      await broadcastEvent('SYNC_STATUS_UPDATED', {
        isSyncing: false,
        lastSyncTime: timestamp,
        lastSyncError: null
      });

      return {
        success: true,
        action: 'uploaded',
        message: `Uploaded ${localData.bookmarkCount} bookmarks`,
        timestamp,
        bookmarkCount: localData.bookmarkCount,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await saveSetting('webdavLastSyncError', errorMessage);

    console.error('WebDAV sync error:', error);

    // Broadcast sync failed
    await broadcastEvent('SYNC_STATUS_UPDATED', {
      isSyncing: false,
      lastSyncError: errorMessage
    });

    return {
      success: false,
      action: 'error',
      message: errorMessage,
    };
  } finally {
    syncState.reset();
  }
}

/**
 * Trigger sync if enabled (for use by service worker)
 */
export async function triggerSyncIfEnabled(): Promise<void> {
  if (await isWebDAVConfigured()) {
    const result = await performSync();
    console.log('WebDAV sync result:', result);
  }
}
