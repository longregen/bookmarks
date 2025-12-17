import { getSettings, saveSetting, type ApiSettings } from './settings';
import { exportAllBookmarks, importBookmarks, type BookmarkExport } from './export';
import { db } from '../db/schema';
import { broadcastEvent } from './events';
import { config } from './config-registry';
import { validateWebDAVUrl } from './url-validator';
import { getErrorMessage } from './errors';
import type { SyncStatus } from './messages';

let isSyncing = false;
let lastSyncAttempt = 0;

export interface SyncResult {
  success: boolean;
  action: 'uploaded' | 'downloaded' | 'no-change' | 'skipped' | 'error';
  message: string;
  timestamp?: string;
  bookmarkCount?: number;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const settings = await getSettings();
  return {
    lastSyncTime: settings.webdavLastSyncTime || null,
    lastSyncError: settings.webdavLastSyncError || null,
    isSyncing,
  };
}

async function isWebDAVConfigured(): Promise<boolean> {
  const settings = await getSettings();
  return !!(
    settings.webdavEnabled &&
    settings.webdavUrl &&
    settings.webdavUsername &&
    settings.webdavPassword
  );
}

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
  // eslint-disable-next-line no-empty
  } catch {}

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
      currentPath += `/${part}/`;
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
    const etag = response.headers.get('ETag');

    return {
      exists: true,
      lastModified: (lastModifiedStr !== null && lastModifiedStr !== '') ? new Date(lastModifiedStr) : undefined,
      etag: etag ?? undefined,
    };
  } catch (_error) {
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

  const data = await response.json() as BookmarkExport;
  return data;
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
  return bookmarks?.updatedAt ?? null;
}

async function completeSyncSuccess(action: SyncResult['action'], message: string, count?: number): Promise<SyncResult> {
  const timestamp = new Date().toISOString();
  await saveSetting('webdavLastSyncTime', timestamp);
  await saveSetting('webdavLastSyncError', '');
  await broadcastEvent('SYNC_STATUS_UPDATED', { isSyncing: false, lastSyncTime: timestamp, lastSyncError: null });
  return { success: true, action, message, timestamp, bookmarkCount: count };
}

export async function performSync(force = false): Promise<SyncResult> {
  const now = Date.now();
  if (!force && now - lastSyncAttempt < config.WEBDAV_SYNC_DEBOUNCE_MS) {
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

  if (isSyncing) {
    return {
      success: true,
      action: 'skipped',
      message: 'Sync already in progress',
    };
  }

  isSyncing = true;

  await broadcastEvent('SYNC_STATUS_UPDATED', { isSyncing: true });

  try {
    const settings = await getSettings();

    const validation = validateWebDAVUrl(settings.webdavUrl, settings.webdavAllowInsecure);
    if (!validation.valid) {
      await saveSetting('webdavLastSyncError', validation.error ?? 'Connection validation failed');
      return {
        success: false,
        action: 'error',
        message: validation.error ?? 'Connection validation failed',
      };
    }

    const remote = await getRemoteMetadata(settings);
    const localLastUpdate = await getLocalLastUpdate();
    const localData = await exportAllBookmarks();

    if (!remote.exists) {
      if (localData.bookmarkCount > 0) {
        await uploadToServer(settings, localData);
        return await completeSyncSuccess('uploaded', `Uploaded ${localData.bookmarkCount} bookmarks`, localData.bookmarkCount);
      } else {
        return await completeSyncSuccess('no-change', 'No bookmarks to sync');
      }
    }

    const remoteData = await downloadFromServer(settings);

    if (!remoteData) {
      await uploadToServer(settings, localData);
      return await completeSyncSuccess('uploaded', `Uploaded ${localData.bookmarkCount} bookmarks`, localData.bookmarkCount);
    }

    const remoteExportTime = new Date(remoteData.exportedAt);
    const localExportTime = localLastUpdate ?? new Date(0);

    if (remoteExportTime > localExportTime) {
      const result = await importBookmarks(remoteData, 'webdav-sync');
      const mergedData = await exportAllBookmarks();
      await uploadToServer(settings, mergedData);
      return await completeSyncSuccess('downloaded', `Imported ${result.imported} bookmarks (${result.skipped} duplicates)`, result.imported);
    } else {
      await uploadToServer(settings, localData);
      return await completeSyncSuccess('uploaded', `Uploaded ${localData.bookmarkCount} bookmarks`, localData.bookmarkCount);
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);
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
    isSyncing = false;
  }
}

export async function triggerSyncIfEnabled(): Promise<void> {
  if (await isWebDAVConfigured()) {
    await performSync();
  }
}
