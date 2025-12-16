import { getSettings, saveSetting, type ApiSettings } from './settings';
import { exportAllBookmarks, importBookmarks, type BookmarkExport } from './export';
import { db } from '../db/schema';
import { broadcastSyncStatus } from './events';
import { LOCK_TIMEOUT_MS, SYNC_DEBOUNCE_MS } from './constants';
import * as crypto from 'crypto';
// Session ID to detect stale locks from previous service worker instances
const SESSION_ID = `sync-session-${Date.now()}-${crypto.randomBytes(9).toString('base64url')}`;

// Sync lock state with timestamp and session validation
interface SyncLock {
  isLocked: boolean;
  timestamp: number;
  sessionId: string;
}

let syncLock: SyncLock = {
  isLocked: false,
  timestamp: 0,
  sessionId: SESSION_ID,
};

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
 * Check if the current sync lock is stale (timed out or from a previous session)
 */
function isSyncLockStale(lock: SyncLock): boolean {
  // Lock is stale if it's from a different session
  if (lock.sessionId !== SESSION_ID) {
    console.log('Sync lock is from a different session, treating as stale');
    return true;
  }

  // Lock is stale if it's been held for more than LOCK_TIMEOUT_MS
  const lockAge = Date.now() - lock.timestamp;
  if (lockAge > LOCK_TIMEOUT_MS) {
    console.log(`Sync lock has timed out (${Math.round(lockAge / 1000)}s old), treating as stale`);
    return true;
  }

  return false;
}

/**
 * Acquire the sync lock
 */
async function acquireSyncLock(): Promise<boolean> {
  if (syncLock.isLocked && !isSyncLockStale(syncLock)) {
    return false; // Lock is held and valid
  }

  // Acquire or reset the lock
  syncLock = {
    isLocked: true,
    timestamp: Date.now(),
    sessionId: SESSION_ID,
  };

  // Broadcast that syncing has started
  const status = await getSyncStatus();
  await broadcastSyncStatus(status).catch(err => {
    console.error('Failed to broadcast sync status:', err);
  });

  return true;
}

/**
 * Release the sync lock
 */
async function releaseSyncLock(): Promise<void> {
  syncLock = {
    isLocked: false,
    timestamp: Date.now(),
    sessionId: SESSION_ID,
  };

  // Broadcast that syncing has ended
  const status = await getSyncStatus();
  await broadcastSyncStatus(status).catch(err => {
    console.error('Failed to broadcast sync status:', err);
  });
}

/**
 * Check if currently syncing (respecting stale lock detection)
 */
function isSyncingNow(): boolean {
  return syncLock.isLocked && !isSyncLockStale(syncLock);
}

/**
 * Get current sync status from settings
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const settings = await getSettings();
  return {
    lastSyncTime: settings.webdavLastSyncTime || null,
    lastSyncError: settings.webdavLastSyncError || null,
    isSyncing: isSyncingNow(),
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
 * Validate that WebDAV URL uses HTTPS (or is explicitly allowed to use HTTP)
 * @throws Error if URL uses HTTP and insecure HTTP is not allowed
 */
function validateHTTPS(settings: ApiSettings): void {
  try {
    const url = new URL(settings.webdavUrl);
    if (url.protocol === 'http:' && !settings.webdavAllowInsecureHTTP) {
      throw new Error(
        'Security Error: WebDAV credentials cannot be sent over HTTP. ' +
        'Please use HTTPS or enable "Allow Insecure HTTP" in settings if using a local network.'
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid WebDAV URL format');
    }
    throw error;
  }
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
  if (!force && now - lastSyncAttempt < SYNC_DEBOUNCE_MS) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync debounced (too frequent)',
    };
  }

  lastSyncAttempt = now;

  // Check if already syncing (with stale lock detection)
  if (!(await acquireSyncLock())) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync already in progress',
    };
  }

  // Check configuration
  if (!await isWebDAVConfigured()) {
    await releaseSyncLock();
    return {
      success: false,
      action: 'skipped',
      message: 'WebDAV not configured or disabled',
    };
  }

  try {
    const settings = await getSettings();

    // Validate HTTPS before syncing
    validateHTTPS(settings);

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

    return {
      success: false,
      action: 'error',
      message: errorMessage,
    };
  } finally {
    await releaseSyncLock();
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
