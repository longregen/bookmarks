import { getSettings, saveSetting, type ApiSettings } from './settings';
import { exportAllBookmarks, importBookmarks, type BookmarkExport } from './export';
import { db } from '../db/schema';
import { createStateManager } from './state-manager';
import { broadcastEvent } from './events';
import { WEBDAV_SYNC_TIMEOUT_MS, WEBDAV_SYNC_DEBOUNCE_MS } from './constants';

const syncState = createStateManager({
  name: 'WebDAVSync',
  timeoutMs: WEBDAV_SYNC_TIMEOUT_MS,
});

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

export function validateSecureConnection(settings: ApiSettings): { valid: boolean; error?: string } {
  if (!settings.webdavUrl) {
    return { valid: false, error: 'WebDAV URL is not configured' };
  }

  try {
    const url = new URL(settings.webdavUrl);
    if (url.protocol === 'http:') {
      if (!settings.webdavAllowInsecure) {
        return {
          valid: false,
          error: 'HTTP connections are not allowed for security reasons. Please use HTTPS or enable "Allow insecure connections" in settings.',
        };
      }
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid WebDAV URL format' };
  }
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const settings = await getSettings();
  return {
    lastSyncTime: settings.webdavLastSyncTime || null,
    lastSyncError: settings.webdavLastSyncError || null,
    isSyncing: syncState.isActive(),
  };
}

export async function isWebDAVConfigured(): Promise<boolean> {
  const settings = await getSettings();
  return !!(
    settings.webdavEnabled &&
    settings.webdavUrl &&
    settings.webdavUsername &&
    settings.webdavPassword
  );
}

function buildFileUrl(settings: ApiSettings): string {
  const baseUrl = settings.webdavUrl.replace(/\/$/, '');
  const path = settings.webdavPath.replace(/^\//, '').replace(/\/$/, '');
  return `${baseUrl}/${path}/bookmarks.json`;
}

function buildFolderUrl(settings: ApiSettings): string {
  const baseUrl = settings.webdavUrl.replace(/\/$/, '');
  const path = settings.webdavPath.replace(/^\//, '').replace(/\/$/, '');
  return `${baseUrl}/${path}/`;
}

function getAuthHeader(settings: ApiSettings): string {
  return 'Basic ' + btoa(`${settings.webdavUsername}:${settings.webdavPassword}`);
}

async function ensureFolderExists(settings: ApiSettings): Promise<void> {
  const folderUrl = buildFolderUrl(settings);

  try {
    const response = await fetch(folderUrl, {
      method: 'PROPFIND',
      headers: {
        'Depth': '0',
        'Authorization': getAuthHeader(settings),
      },
    });

    if (response.status === 207 || response.ok) {
      return;
    }
  } catch {
  }

  const mkcolResponse = await fetch(folderUrl, {
    method: 'MKCOL',
    headers: {
      'Authorization': getAuthHeader(settings),
    },
  });

  if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
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
    return { exists: false };
  }
}

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

async function getLocalLastUpdate(): Promise<Date | null> {
  const bookmarks = await db.bookmarks.orderBy('updatedAt').reverse().first();
  return bookmarks?.updatedAt || null;
}

export async function performSync(force = false): Promise<SyncResult> {
  const now = Date.now();
  if (!force && now - lastSyncAttempt < WEBDAV_SYNC_DEBOUNCE_MS) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync debounced (too frequent)',
    };
  }

  lastSyncAttempt = now;

  if (!await isWebDAVConfigured()) {
    return {
      success: false,
      action: 'skipped',
      message: 'WebDAV not configured or disabled',
    };
  }

  if (!syncState.start()) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync already in progress',
    };
  }

  await broadcastEvent('SYNC_STATUS_UPDATED', { isSyncing: true });

  try {
    const settings = await getSettings();

    const validation = validateSecureConnection(settings);
    if (!validation.valid) {
      await saveSetting('webdavLastSyncError', validation.error || 'Connection validation failed');
      return {
        success: false,
        action: 'error',
        message: validation.error || 'Connection validation failed',
      };
    }

    const remote = await getRemoteMetadata(settings);
    const localLastUpdate = await getLocalLastUpdate();
    const localData = await exportAllBookmarks();

    if (!remote.exists) {
      if (localData.bookmarkCount > 0) {
        await uploadToServer(settings, localData);
        const timestamp = new Date().toISOString();
        await saveSetting('webdavLastSyncTime', timestamp);
        await saveSetting('webdavLastSyncError', '');
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
        const timestamp = new Date().toISOString();
        await saveSetting('webdavLastSyncTime', timestamp);
        await saveSetting('webdavLastSyncError', '');
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

    const remoteData = await downloadFromServer(settings);

    if (!remoteData) {
      await uploadToServer(settings, localData);
      const timestamp = new Date().toISOString();
      await saveSetting('webdavLastSyncTime', timestamp);
      await saveSetting('webdavLastSyncError', '');
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

    const remoteExportTime = new Date(remoteData.exportedAt);
    const localExportTime = localLastUpdate || new Date(0);

    if (remoteExportTime > localExportTime) {
      const result = await importBookmarks(remoteData, 'webdav-sync');
      const timestamp = new Date().toISOString();
      await saveSetting('webdavLastSyncTime', timestamp);
      await saveSetting('webdavLastSyncError', '');
      const mergedData = await exportAllBookmarks();
      await uploadToServer(settings, mergedData);
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
      await uploadToServer(settings, localData);
      const timestamp = new Date().toISOString();
      await saveSetting('webdavLastSyncTime', timestamp);
      await saveSetting('webdavLastSyncError', '');
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

export async function triggerSyncIfEnabled(): Promise<void> {
  if (await isWebDAVConfigured()) {
    await performSync();
  }
}
