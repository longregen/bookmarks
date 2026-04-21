import { db, type Bookmark, type Markdown, type BookmarkTag, JobType, JobStatus } from '../db/schema';
import { getSettings, saveSetting } from './settings';
import { events } from './events';
import { getErrorMessage } from './errors';
import { applyCacheBytesDelta, estimateMarkdownBytes, maybeEvictMarkdownLRU } from './content-tier';
import {
  ServerApiClient,
  ServerApiError,
  type ServerBookmark,
  type ServerBookmarkFull,
  type SyncChange,
  type FullSyncUploadRequest,
} from './server-api';
import { createJob } from './jobs';

type SyncAction = 'full_sync' | 'incremental_sync' | 'no_change';

interface SyncResult {
  success: boolean;
  action: SyncAction;
  message: string;
  timestamp: number;
  bookmarkCount: number;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  lastSyncError: string | null;
  isSyncing: boolean;
  pendingChanges: number;
}

type OfflineChangeType = 'create' | 'update' | 'delete';

interface OfflineChange {
  type: OfflineChangeType;
  bookmarkId: string;
  data?: Partial<ServerBookmark>;
  timestamp: number;
}

const OFFLINE_QUEUE_KEY = 'serverSync:offlineQueue';

const UPLOAD_BATCH_MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_BATCH_MAX_COUNT = 500;

function chunkUploadBookmarks(
  bookmarks: FullSyncUploadRequest['bookmarks'],
): FullSyncUploadRequest['bookmarks'][] {
  const batches: FullSyncUploadRequest['bookmarks'][] = [];
  let current: FullSyncUploadRequest['bookmarks'] = [];
  let currentBytes = 0;

  for (const b of bookmarks) {
    const size = JSON.stringify(b).length;
    if (current.length > 0 && (currentBytes + size > UPLOAD_BATCH_MAX_BYTES || current.length >= UPLOAD_BATCH_MAX_COUNT)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(b);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export class ServerSyncManager {
  private isSyncing = false;
  private isProcessingQueue = false;
  private offlineQueue: OfflineChange[] = [];
  private queueLoaded = false;

  private async ensureQueueLoaded(): Promise<void> {
    if (this.queueLoaded) return;
    await this.loadOfflineQueue();
  }

  private async loadOfflineQueue(): Promise<void> {
    try {
      if (__IS_WEB__) {
        const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
        if (stored !== null && stored !== '') {
          this.offlineQueue = JSON.parse(stored) as OfflineChange[];
        }
      } else {
        const result = await chrome.storage.local.get(OFFLINE_QUEUE_KEY);
        const stored = result[OFFLINE_QUEUE_KEY] as string | undefined;
        if (stored !== undefined && stored !== '') {
          this.offlineQueue = JSON.parse(stored) as OfflineChange[];
        }
      }
    } catch {
      this.offlineQueue = [];
    }
    this.queueLoaded = true;
  }

  private async saveOfflineQueue(): Promise<void> {
    try {
      if (__IS_WEB__) {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
      } else {
        await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: JSON.stringify(this.offlineQueue) });
      }
    } catch { /* best-effort persist */ }
  }

  private async isServerEnabled(): Promise<boolean> {
    const settings = await getSettings();
    return settings.serverEnabled && !!settings.serverUrl && !!settings.serverSessionToken;
  }

  async fullSync(): Promise<SyncResult> {
    if (!(await this.isServerEnabled())) {
      return { success: true, action: 'no_change', message: 'Server sync not enabled', timestamp: Date.now(), bookmarkCount: 0 };
    }

    if (this.isSyncing) {
      return { success: false, action: 'full_sync', message: 'Sync already in progress', timestamp: Date.now(), bookmarkCount: 0 };
    }

    this.isSyncing = true;
    await events.sync.started(false);

    try {
      const client = await ServerApiClient.fromSettings();

      // Upload local bookmarks to server first so nothing is lost
      await this.uploadLocalBookmarks(client);

      // Download all bookmarks from server (now includes both clients' data)
      const allBookmarks: ServerBookmark[] = [];
      let offset = 0;
      let syncTimestamp = '';

      for (;;) {
        const response = await client.downloadFullSync({ offset });
        allBookmarks.push(...response.bookmarks);
        syncTimestamp = response.syncTimestamp;
        if (!response.hasMore) break;
        offset = allBookmarks.length;
      }

      // Merge server bookmarks into local DB (upsert, don't clear)
      await this.mergeServerBookmarks(allBookmarks);

      const syncTime = new Date(syncTimestamp).getTime();
      await saveSetting('serverLastSyncTime', syncTimestamp);
      await saveSetting('serverLastSyncError', '');
      await events.sync.completed('downloaded', allBookmarks.length);

      return { success: true, action: 'full_sync', message: `Full sync completed: ${allBookmarks.length} bookmarks`, timestamp: syncTime, bookmarkCount: allBookmarks.length };
    } catch (error) {
      const errorMessage = this.formatError(error);
      await saveSetting('serverLastSyncError', errorMessage);
      await events.sync.failed(errorMessage);
      return { success: false, action: 'full_sync', message: errorMessage, timestamp: Date.now(), bookmarkCount: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  async incrementalSync(): Promise<SyncResult> {
    if (!(await this.isServerEnabled())) {
      return { success: true, action: 'no_change', message: 'Server sync not enabled', timestamp: Date.now(), bookmarkCount: 0 };
    }

    if (this.isSyncing) {
      return { success: false, action: 'incremental_sync', message: 'Sync already in progress', timestamp: Date.now(), bookmarkCount: 0 };
    }

    this.isSyncing = true;
    await events.sync.started(false);

    try {
      await this.processOfflineQueue();

      const settings = await getSettings();
      const client = await ServerApiClient.fromSettings();
      const lastSyncTime = settings.serverLastSyncTime || new Date(0).toISOString();

      const response = await client.getChanges(lastSyncTime);

      const changesApplied = await this.applyChanges(response.changes);

      await saveSetting('serverLastSyncTime', response.syncTimestamp);
      await saveSetting('serverLastSyncError', '');

      const action: SyncAction = changesApplied > 0 ? 'incremental_sync' : 'no_change';
      await events.sync.completed(changesApplied > 0 ? 'downloaded' : 'no-change', changesApplied);

      return {
        success: true,
        action,
        message: changesApplied > 0 ? `Incremental sync: ${changesApplied} changes applied` : 'No changes since last sync',
        timestamp: new Date(response.syncTimestamp).getTime(),
        bookmarkCount: changesApplied,
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      await saveSetting('serverLastSyncError', errorMessage);
      await events.sync.failed(errorMessage);
      return { success: false, action: 'incremental_sync', message: errorMessage, timestamp: Date.now(), bookmarkCount: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof ServerApiError && error.isUnauthorized()) {
      return 'Session expired. Please log in again.';
    }
    return getErrorMessage(error);
  }

  private async applyChanges(changes: SyncChange[]): Promise<number> {
    if (changes.length === 0) return 0;

    const deletions: string[] = [];
    const upserts: ServerBookmark[] = [];

    for (const change of changes) {
      if (change.type === 'deleted' && change.bookmarkId !== undefined && change.bookmarkId !== '') {
        deletions.push(change.bookmarkId);
      } else if (change.bookmark !== undefined) {
        upserts.push(change.bookmark);
      }
    }

    const now = new Date();

    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers, db.summaries, db.bookmarkTags], async () => {
      for (const bookmarkId of deletions) {
        await db.bookmarks.delete(bookmarkId);
        await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
        await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();
        await db.summaries.where('bookmarkId').equals(bookmarkId).delete();
        await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).delete();
      }

      for (const serverBookmark of upserts) {
        // Deduplicate: if a local bookmark exists with the same URL but a different ID,
        // re-key its derived records to the server ID to preserve processed content
        let preservedHtml = '';
        if (serverBookmark.url !== '') {
          const localDupe = await db.bookmarks.where('url').equals(serverBookmark.url).first();
          if (localDupe && localDupe.id !== serverBookmark.id) {
            preservedHtml = localDupe.html;
            await db.markdown.where('bookmarkId').equals(localDupe.id).modify({ bookmarkId: serverBookmark.id });
            await db.questionsAnswers.where('bookmarkId').equals(localDupe.id).modify({ bookmarkId: serverBookmark.id });
            await db.summaries.where('bookmarkId').equals(localDupe.id).modify({ bookmarkId: serverBookmark.id });
            await db.bookmarkTags.where('bookmarkId').equals(localDupe.id).delete();
            await db.bookmarks.delete(localDupe.id);
          }
        }

        const serverHtml = serverBookmark.html ?? '';
        const bookmark: Bookmark = {
          id: serverBookmark.id,
          url: serverBookmark.url,
          title: serverBookmark.title,
          html: serverHtml !== '' ? serverHtml : preservedHtml,
          status: serverBookmark.status as Bookmark['status'],
          errorMessage: serverBookmark.errorMessage ?? undefined,
          createdAt: new Date(serverBookmark.createdAt),
          updatedAt: new Date(serverBookmark.updatedAt),
        };
        await db.bookmarks.put(bookmark);

        await db.bookmarkTags.where('bookmarkId').equals(serverBookmark.id).delete();
        await db.bookmarkTags.bulkPut(
          serverBookmark.tags.map(tagName => ({ bookmarkId: serverBookmark.id, tagName, addedAt: now }))
        );
      }
    });

    return deletions.length + upserts.length;
  }

  async queueOfflineChange(change: OfflineChange): Promise<void> {
    await this.ensureQueueLoaded();
    const existingIndex = this.offlineQueue.findIndex(c => c.bookmarkId === change.bookmarkId);

    if (existingIndex < 0) {
      this.offlineQueue.push(change);
      await this.saveOfflineQueue();
      return;
    }

    const existing = this.offlineQueue[existingIndex];

    if (change.type === 'delete') {
      this.handleDeleteChange(existingIndex, existing);
    } else if (change.type === 'update') {
      this.handleUpdateChange(existing, change);
    } else {
      this.handleCreateChange(existingIndex, existing, change);
    }

    await this.saveOfflineQueue();
  }

  private handleDeleteChange(existingIndex: number, existing: OfflineChange): void {
    if (existing.type === 'create') {
      // Item was created offline and now deleted - remove from queue entirely
      // No need to sync since it never existed on server
      this.offlineQueue.splice(existingIndex, 1);
    } else {
      // Replace update with delete, or keep delete as-is
      this.offlineQueue[existingIndex] = { type: 'delete', bookmarkId: existing.bookmarkId, timestamp: Date.now() };
    }
  }

  private handleUpdateChange(existing: OfflineChange, change: OfflineChange): void {
    if (existing.type === 'create') {
      // Merge update into create - keep as create with merged data
      existing.data = { ...existing.data, ...change.data };
      existing.timestamp = change.timestamp;
    } else if (existing.type === 'update') {
      // Merge updates together
      existing.data = { ...existing.data, ...change.data };
      existing.timestamp = change.timestamp;
    }
    // If existing is delete, ignore the update (deleted items can't be updated)
  }

  private handleCreateChange(existingIndex: number, existing: OfflineChange, change: OfflineChange): void {
    if (existing.type === 'delete') {
      // Re-creating after delete - replace delete with create
      this.offlineQueue[existingIndex] = change;
    }
    // If existing is create or update, ignore (can't create twice)
  }

  async processOfflineQueue(): Promise<void> {
    await this.ensureQueueLoaded();
    if (this.isProcessingQueue || !(await this.isServerEnabled()) || this.offlineQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    try {
      const client = await ServerApiClient.fromSettings();
      const processedIndices = new Set<number>();

      for (let i = 0; i < this.offlineQueue.length; i++) {
        try {
          await this.sendOfflineChange(client, this.offlineQueue[i]);
          processedIndices.add(i);
        } catch (error) {
          if (error instanceof ServerApiError && error.isNotFound()) {
            // 404 means the resource is already gone — nothing left to do
            processedIndices.add(i);
          }
          // Keep other failed changes in queue for retry
        }
      }

      this.offlineQueue = this.offlineQueue.filter((_, i) => !processedIndices.has(i));
      await this.saveOfflineQueue();
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async sendOfflineChange(client: ServerApiClient, change: OfflineChange): Promise<void> {
    const data = change.data ?? {};
    switch (change.type) {
      case 'create':
        await client.createBookmark({
          url: data.url ?? '',
          title: data.title ?? '',
          html: data.html ?? '',
        });
        break;
      case 'update':
        await client.updateBookmark(change.bookmarkId, {
          title: data.title,
          html: data.html ?? undefined,
          tags: data.tags,
        });
        break;
      case 'delete':
        await client.deleteBookmark(change.bookmarkId);
        break;
    }
  }

  async getSyncStatus(): Promise<SyncStatus> {
    await this.ensureQueueLoaded();
    const settings = await getSettings();
    return {
      lastSyncTime: settings.serverLastSyncTime || null,
      lastSyncError: settings.serverLastSyncError || null,
      isSyncing: this.isSyncing,
      pendingChanges: this.offlineQueue.length,
    };
  }

  private async uploadLocalBookmarks(client: ServerApiClient): Promise<void> {
    const allBookmarks = await db.bookmarks.toArray();
    if (allBookmarks.length === 0) return;

    const allTags = await db.bookmarkTags.toArray();
    const tagsByBookmark = new Map<string, string[]>();
    for (const tag of allTags) {
      const tags = tagsByBookmark.get(tag.bookmarkId) ?? [];
      tags.push(tag.tagName);
      tagsByBookmark.set(tag.bookmarkId, tags);
    }

    const allMarkdown = await db.markdown.toArray();
    const markdownByBookmark = new Map<string, string>();
    for (const md of allMarkdown) {
      markdownByBookmark.set(md.bookmarkId, md.content);
    }

    const uploadBookmarks: FullSyncUploadRequest['bookmarks'] = allBookmarks.map(b => ({
      id: b.id,
      url: b.url,
      title: b.title,
      html: b.html,
      markdown: markdownByBookmark.get(b.id),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      tags: tagsByBookmark.get(b.id) ?? [],
    }));

    for (const batch of chunkUploadBookmarks(uploadBookmarks)) {
      await client.uploadFullSync({ bookmarks: batch });
    }
  }

  private async mergeServerBookmarks(serverBookmarks: ServerBookmark[]): Promise<void> {
    const now = new Date();
    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers, db.summaries, db.bookmarkTags], async () => {
      // Remove local bookmarks whose URLs are on the server with a different ID
      // (the server version is canonical after upload)
      for (const serverBookmark of serverBookmarks) {
        if (serverBookmark.url !== '') {
          const localDupe = await db.bookmarks.where('url').equals(serverBookmark.url).first();
          if (localDupe && localDupe.id !== serverBookmark.id) {
            // Re-key derived records to the server ID to preserve processed content
            await db.markdown.where('bookmarkId').equals(localDupe.id).modify({ bookmarkId: serverBookmark.id });
            await db.questionsAnswers.where('bookmarkId').equals(localDupe.id).modify({ bookmarkId: serverBookmark.id });
            await db.summaries.where('bookmarkId').equals(localDupe.id).modify({ bookmarkId: serverBookmark.id });
            await db.bookmarkTags.where('bookmarkId').equals(localDupe.id).delete();
            await db.bookmarks.delete(localDupe.id);
          }
        }
      }

      // Upsert all server bookmarks
      const bookmarkRecords: Bookmark[] = [];
      const tagRecords: BookmarkTag[] = [];

      for (const serverBookmark of serverBookmarks) {
        bookmarkRecords.push({
          id: serverBookmark.id,
          url: serverBookmark.url,
          title: serverBookmark.title,
          html: serverBookmark.html ?? '',
          status: serverBookmark.status as Bookmark['status'],
          errorMessage: serverBookmark.errorMessage ?? undefined,
          createdAt: new Date(serverBookmark.createdAt),
          updatedAt: new Date(serverBookmark.updatedAt),
        });

        for (const tagName of serverBookmark.tags) {
          tagRecords.push({ bookmarkId: serverBookmark.id, tagName, addedAt: now });
        }
      }

      await db.bookmarks.bulkPut(bookmarkRecords);
      // Clear and re-add tags for server bookmarks only
      for (const serverBookmark of serverBookmarks) {
        await db.bookmarkTags.where('bookmarkId').equals(serverBookmark.id).delete();
      }
      await db.bookmarkTags.bulkPut(tagRecords);
    });
  }

  async fetchBookmarkContent(bookmarkId: string): Promise<ServerBookmarkFull | null> {
    if (!(await this.isServerEnabled())) {
      return null;
    }

    try {
      const client = await ServerApiClient.fromSettings();
      const fullBookmark = await client.getBookmarkFull(bookmarkId);
      await this.cacheBookmarkContent(fullBookmark);
      try {
        await maybeEvictMarkdownLRU();
      } catch {
        // eviction is best-effort
      }
      return fullBookmark;
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound()) {
        return null;
      }
      console.error('Failed to fetch bookmark content:', getErrorMessage(error));
      return null;
    }
  }

  async uploadAllBookmarks(): Promise<{ success: boolean; jobId: string; message: string }> {
    if (!(await this.isServerEnabled())) {
      return { success: false, jobId: '', message: 'Server sync not enabled' };
    }

    const settings = await getSettings();
    const neverSynced = settings.serverLastSyncTime === '';
    if (settings.contentTier !== 'full' && !neverSynced) {
      // Once the user has synced at least once, the server is the source of
      // truth; a tiered-down client uploading would regress server state.
      // First-time uploads ARE allowed in any tier so a fresh install that
      // pre-selected summaries/titles can still push its seed content.
      return {
        success: false,
        jobId: '',
        message: 'Upload is only available in Full content tier. Switch back to Full to re-upload.',
      };
    }

    const job = await createJob({
      type: JobType.SYNC_UPLOAD,
      status: JobStatus.IN_PROGRESS,
    });

    try {
      const client = await ServerApiClient.fromSettings();

      const allBookmarks = await db.bookmarks.toArray();
      if (allBookmarks.length === 0) {
        await db.jobs.update(job.id, { status: JobStatus.COMPLETED });
        return { success: true, jobId: job.id, message: 'No bookmarks to upload' };
      }

      const allTags = await db.bookmarkTags.toArray();
      const tagsByBookmark = new Map<string, string[]>();
      for (const tag of allTags) {
        const tags = tagsByBookmark.get(tag.bookmarkId) ?? [];
        tags.push(tag.tagName);
        tagsByBookmark.set(tag.bookmarkId, tags);
      }

      const allMarkdown = await db.markdown.toArray();
      const markdownByBookmark = new Map<string, string>();
      for (const md of allMarkdown) {
        markdownByBookmark.set(md.bookmarkId, md.content);
      }

      const uploadBookmarks: FullSyncUploadRequest['bookmarks'] = allBookmarks.map(b => ({
        id: b.id,
        url: b.url,
        title: b.title,
        html: b.html,
        markdown: markdownByBookmark.get(b.id),
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        tags: tagsByBookmark.get(b.id) ?? [],
      }));

      const batches = chunkUploadBookmarks(uploadBookmarks);
      const result = { created: 0, updated: 0 };
      for (const batch of batches) {
        const batchResult = await client.uploadFullSync({ bookmarks: batch });
        result.created += batchResult.created;
        result.updated += batchResult.updated;
      }

      // After uploading, download all server bookmarks to merge data from other
      // clients and set the sync cursor to cover all existing server data.
      const serverBookmarks: ServerBookmark[] = [];
      let offset = 0;
      let syncTimestamp = '';
      for (;;) {
        const response = await client.downloadFullSync({ offset });
        serverBookmarks.push(...response.bookmarks);
        syncTimestamp = response.syncTimestamp;
        if (!response.hasMore) break;
        offset = serverBookmarks.length;
      }
      await this.mergeServerBookmarks(serverBookmarks);

      await saveSetting('serverLastSyncTime', syncTimestamp);
      await saveSetting('serverLastSyncError', '');
      await db.jobs.update(job.id, { status: JobStatus.COMPLETED });

      return {
        success: true,
        jobId: job.id,
        message: `Uploaded ${allBookmarks.length} bookmarks (${result.created} created, ${result.updated} updated)`,
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      await saveSetting('serverLastSyncError', errorMessage);
      await db.jobs.update(job.id, { status: JobStatus.FAILED });
      return { success: false, jobId: job.id, message: errorMessage };
    }
  }

  private async cacheBookmarkContent(fullBookmark: ServerBookmarkFull): Promise<void> {
    const now = new Date();
    const settings = await getSettings();
    const tier = settings.contentTier;
    const keepMarkdown = tier !== 'titles';
    const keepQaText = tier === 'full';

    let bytesAdded = 0;

    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers], async () => {
      const existing = await db.bookmarks.get(fullBookmark.id);
      if (existing) {
        existing.html = fullBookmark.html ?? '';
        await db.bookmarks.put(existing);
      }

      if (keepMarkdown && fullBookmark.markdown !== null && fullBookmark.markdown !== '') {
        const content = fullBookmark.markdown;
        const sizeBytes = estimateMarkdownBytes(content);
        const prev = await db.markdown.where('bookmarkId').equals(fullBookmark.id).first();
        bytesAdded = sizeBytes - (prev?.sizeBytes ?? 0);
        const markdown: Markdown = {
          id: prev?.id ?? `${fullBookmark.id}-md`,
          bookmarkId: fullBookmark.id,
          content,
          createdAt: prev?.createdAt ?? new Date(fullBookmark.createdAt),
          updatedAt: new Date(fullBookmark.updatedAt),
          lastAccessedAt: now,
          sizeBytes,
        };
        await db.markdown.put(markdown);
      }

      if (keepQaText && fullBookmark.qaPairs.length > 0) {
        await db.questionsAnswers.where('bookmarkId').equals(fullBookmark.id).delete();

        await db.questionsAnswers.bulkPut(fullBookmark.qaPairs.map(qa => ({
          id: qa.id,
          bookmarkId: fullBookmark.id,
          question: qa.question,
          answer: qa.answer,
          embeddingQuestion: [],
          embeddingAnswer: [],
          embeddingBoth: [],
          createdAt: new Date(qa.createdAt),
          updatedAt: now,
        })));
      }
    });

    if (bytesAdded !== 0) {
      await applyCacheBytesDelta(bytesAdded);
    }
  }

  async getOfflineQueueSummary(): Promise<{
    total: number;
    byType: { create: number; update: number; delete: number };
    oldestTimestamp: number | null;
    recent: { bookmarkId: string; type: OfflineChangeType; timestamp: number }[];
  }> {
    await this.ensureQueueLoaded();
    const byType = { create: 0, update: 0, delete: 0 };
    let oldest: number | null = null;
    for (const c of this.offlineQueue) {
      byType[c.type]++;
      if (oldest === null || c.timestamp < oldest) oldest = c.timestamp;
    }
    const recent = this.offlineQueue
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 5)
      .map(c => ({ bookmarkId: c.bookmarkId, type: c.type, timestamp: c.timestamp }));
    return { total: this.offlineQueue.length, byType, oldestTimestamp: oldest, recent };
  }

  async clearOfflineQueue(): Promise<number> {
    await this.ensureQueueLoaded();
    const count = this.offlineQueue.length;
    this.offlineQueue = [];
    await this.saveOfflineQueue();
    return count;
  }

}

export const serverSync = new ServerSyncManager();


