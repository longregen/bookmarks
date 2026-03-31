import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import type { ServerBookmark, SyncChange } from '../src/lib/server-api';

// Mock dependencies before importing ServerSyncManager
const mockGetSettings = vi.fn().mockResolvedValue({
  serverEnabled: true,
  serverUrl: 'https://server.test',
  serverSessionToken: 'tok',
  serverLastSyncTime: '2024-01-01T00:00:00.000Z',
});

vi.mock('../src/lib/settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  saveSetting: vi.fn(),
}));

vi.mock('../src/lib/events', () => ({
  events: {
    sync: {
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/jobs', () => ({
  createJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
}));

const mockGetChanges = vi.fn();
const mockDownloadFullSync = vi.fn();
const mockFromSettings = vi.fn();

vi.mock('../src/lib/server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/server-api')>();
  return {
    ...actual,
    ServerApiClient: {
      fromSettings: (...args: unknown[]) => mockFromSettings(...args),
    },
    ServerApiError: actual.ServerApiError,
  };
});

import { ServerSyncManager } from '../src/lib/server-sync';

function makeServerBookmark(overrides: Partial<ServerBookmark> = {}): ServerBookmark {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Example',
    html: overrides.html !== undefined ? overrides.html : '<html></html>',
    markdown: overrides.markdown ?? null,
    status: overrides.status ?? 'complete',
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2024-01-02T00:00:00.000Z',
    deletedAt: overrides.deletedAt ?? null,
    tags: overrides.tags ?? [],
  };
}

async function clearAllTables(): Promise<void> {
  await db.bookmarks.clear();
  await db.markdown.clear();
  await db.questionsAnswers.clear();
  await db.summaries.clear();
  await db.bookmarkTags.clear();
}

describe('ServerSyncManager - incremental sync deduplication', () => {
  let syncManager: ServerSyncManager;

  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();
    syncManager = new ServerSyncManager();

    mockFromSettings.mockResolvedValue({
      getChanges: mockGetChanges,
      downloadFullSync: mockDownloadFullSync,
    });
  });

  afterEach(async () => {
    await clearAllTables();
  });

  it('should remove local duplicate when server returns same URL with different ID', async () => {
    await db.bookmarks.add({
      id: 'local-mobile-id',
      url: 'https://example.com',
      title: 'Mobile Title',
      html: '<html>mobile</html>',
      status: 'complete',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });

    const serverBookmark = makeServerBookmark({
      id: 'server-desktop-id',
      url: 'https://example.com',
      title: 'Desktop Title',
      tags: ['synced-tag'],
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    const result = await syncManager.incrementalSync();

    expect(result.success).toBe(true);

    const allBookmarks = await db.bookmarks.toArray();
    expect(allBookmarks).toHaveLength(1);
    expect(allBookmarks[0].id).toBe('server-desktop-id');
    expect(allBookmarks[0].title).toBe('Desktop Title');
  });

  it('should preserve markdown when re-keying local duplicate', async () => {
    await db.bookmarks.add({
      id: 'local-id', url: 'https://example.com', title: 'Local',
      html: '<html>local</html>', status: 'complete',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.markdown.add({
      id: 'md-local', bookmarkId: 'local-id', content: 'precious markdown content',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const serverBookmark = makeServerBookmark({
      id: 'server-id', url: 'https://example.com',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    // Markdown should be re-keyed to server ID, not deleted
    const markdown = await db.markdown.where('bookmarkId').equals('server-id').first();
    expect(markdown).toBeDefined();
    expect(markdown!.content).toBe('precious markdown content');

    // Old ID should have no records
    const oldMarkdown = await db.markdown.where('bookmarkId').equals('local-id').toArray();
    expect(oldMarkdown).toHaveLength(0);
  });

  it('should preserve QA pairs when re-keying local duplicate', async () => {
    await db.bookmarks.add({
      id: 'local-id', url: 'https://example.com', title: 'Local',
      html: '<html>local</html>', status: 'complete',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.questionsAnswers.add({
      id: 'qa-local', bookmarkId: 'local-id',
      question: 'What is this?', answer: 'A test page',
      embeddingQuestion: [0.1, 0.2], embeddingAnswer: [0.3, 0.4], embeddingBoth: [0.5, 0.6],
      embeddingModel: 'text-embedding-3-small',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const serverBookmark = makeServerBookmark({
      id: 'server-id', url: 'https://example.com',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const qa = await db.questionsAnswers.where('bookmarkId').equals('server-id').toArray();
    expect(qa).toHaveLength(1);
    expect(qa[0].question).toBe('What is this?');
    expect(qa[0].embeddingModel).toBe('text-embedding-3-small');

    const oldQa = await db.questionsAnswers.where('bookmarkId').equals('local-id').toArray();
    expect(oldQa).toHaveLength(0);
  });

  it('should preserve summaries when re-keying local duplicate', async () => {
    await db.bookmarks.add({
      id: 'local-id', url: 'https://example.com', title: 'Local',
      html: '<html>local</html>', status: 'complete',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.summaries.add({
      id: 'sum-local', bookmarkId: 'local-id',
      content: 'A summary of the page',
      embedding: [0.1, 0.2, 0.3], embeddingModel: 'text-embedding-3-small',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const serverBookmark = makeServerBookmark({
      id: 'server-id', url: 'https://example.com',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const summary = await db.summaries.where('bookmarkId').equals('server-id').first();
    expect(summary).toBeDefined();
    expect(summary!.content).toBe('A summary of the page');

    const oldSummary = await db.summaries.where('bookmarkId').equals('local-id').toArray();
    expect(oldSummary).toHaveLength(0);
  });

  it('should preserve local html when server html is empty', async () => {
    await db.bookmarks.add({
      id: 'local-id', url: 'https://example.com', title: 'Local',
      html: '<html><body>fully processed content</body></html>', status: 'complete',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const serverBookmark = makeServerBookmark({
      id: 'server-id', url: 'https://example.com',
      html: null, // server hasn't processed it yet
      status: 'pending',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const bookmark = await db.bookmarks.get('server-id');
    expect(bookmark!.html).toBe('<html><body>fully processed content</body></html>');
  });

  it('should use server html when server has content', async () => {
    await db.bookmarks.add({
      id: 'local-id', url: 'https://example.com', title: 'Local',
      html: '<html>old local</html>', status: 'complete',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const serverBookmark = makeServerBookmark({
      id: 'server-id', url: 'https://example.com',
      html: '<html>newer server content</html>',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const bookmark = await db.bookmarks.get('server-id');
    expect(bookmark!.html).toBe('<html>newer server content</html>');
  });

  it('should not remove anything when IDs match (normal update)', async () => {
    const sharedId = 'shared-id';

    await db.bookmarks.add({
      id: sharedId, url: 'https://example.com', title: 'Old Title',
      html: '<html>old</html>', status: 'complete',
      createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'),
    });

    const serverBookmark = makeServerBookmark({
      id: sharedId, url: 'https://example.com', title: 'Updated Title',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'updated', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const allBookmarks = await db.bookmarks.toArray();
    expect(allBookmarks).toHaveLength(1);
    expect(allBookmarks[0].id).toBe(sharedId);
    expect(allBookmarks[0].title).toBe('Updated Title');
  });

  it('should handle new bookmark from server when no local version exists', async () => {
    const serverBookmark = makeServerBookmark({
      id: 'new-from-server', url: 'https://new-site.com', title: 'Brand New',
    });

    mockGetChanges.mockResolvedValue({
      changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const allBookmarks = await db.bookmarks.toArray();
    expect(allBookmarks).toHaveLength(1);
    expect(allBookmarks[0].id).toBe('new-from-server');
  });

  it('should deduplicate multiple URLs in a single sync batch', async () => {
    await db.bookmarks.add({
      id: 'local-1', url: 'https://a.com', title: 'A local',
      html: '', status: 'complete', createdAt: new Date(), updatedAt: new Date(),
    });
    await db.bookmarks.add({
      id: 'local-2', url: 'https://b.com', title: 'B local',
      html: '', status: 'complete', createdAt: new Date(), updatedAt: new Date(),
    });

    const serverA = makeServerBookmark({ id: 'server-1', url: 'https://a.com', title: 'A server' });
    const serverB = makeServerBookmark({ id: 'server-2', url: 'https://b.com', title: 'B server' });

    mockGetChanges.mockResolvedValue({
      changes: [
        { type: 'created', bookmark: serverA },
        { type: 'created', bookmark: serverB },
      ] satisfies SyncChange[],
      syncTimestamp: '2024-01-03T00:00:00.000Z',
    });

    await syncManager.incrementalSync();

    const allBookmarks = await db.bookmarks.toArray();
    expect(allBookmarks).toHaveLength(2);

    const ids = allBookmarks.map(b => b.id).sort();
    expect(ids).toEqual(['server-1', 'server-2']);
  });

  describe('edge cases with null/undefined/empty values', () => {
    it('should not deduplicate when server bookmark URL is empty string', async () => {
      // Two unrelated bookmarks with empty URLs should not be merged
      await db.bookmarks.add({
        id: 'empty-url-1', url: '', title: 'Empty 1',
        html: '<html>1</html>', status: 'pending',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const serverBookmark = makeServerBookmark({
        id: 'empty-url-2', url: '', title: 'Empty 2',
      });

      mockGetChanges.mockResolvedValue({
        changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
        syncTimestamp: '2024-01-03T00:00:00.000Z',
      });

      await syncManager.incrementalSync();

      // Both should remain — empty URL bookmarks should not trigger dedup
      const allBookmarks = await db.bookmarks.toArray();
      expect(allBookmarks).toHaveLength(2);
    });

    it('should handle server html as empty string by falling back to local', async () => {
      await db.bookmarks.add({
        id: 'local-id', url: 'https://example.com', title: 'Local',
        html: '<html>local content</html>', status: 'complete',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const serverBookmark = makeServerBookmark({
        id: 'server-id', url: 'https://example.com',
        html: '', // empty string, not null
      });

      mockGetChanges.mockResolvedValue({
        changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
        syncTimestamp: '2024-01-03T00:00:00.000Z',
      });

      await syncManager.incrementalSync();

      const bookmark = await db.bookmarks.get('server-id');
      expect(bookmark!.html).toBe('<html>local content</html>');
    });

    it('should produce empty string html when both server and local are empty', async () => {
      await db.bookmarks.add({
        id: 'local-id', url: 'https://example.com', title: 'Local',
        html: '', status: 'pending',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const serverBookmark = makeServerBookmark({
        id: 'server-id', url: 'https://example.com',
        html: null,
      });

      mockGetChanges.mockResolvedValue({
        changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
        syncTimestamp: '2024-01-03T00:00:00.000Z',
      });

      await syncManager.incrementalSync();

      const bookmark = await db.bookmarks.get('server-id');
      expect(bookmark!.html).toBe('');
    });

    it('should handle local bookmark with no derived records gracefully', async () => {
      // Local bookmark exists but has no markdown, QA, summaries, or tags
      await db.bookmarks.add({
        id: 'local-id', url: 'https://example.com', title: 'Local',
        html: '', status: 'pending',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const serverBookmark = makeServerBookmark({
        id: 'server-id', url: 'https://example.com',
      });

      mockGetChanges.mockResolvedValue({
        changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
        syncTimestamp: '2024-01-03T00:00:00.000Z',
      });

      await syncManager.incrementalSync();

      const allBookmarks = await db.bookmarks.toArray();
      expect(allBookmarks).toHaveLength(1);
      expect(allBookmarks[0].id).toBe('server-id');
    });

    it('should handle deletion followed by upsert of same URL in one batch', async () => {
      await db.bookmarks.add({
        id: 'old-id', url: 'https://example.com', title: 'Old',
        html: '<html>old</html>', status: 'complete',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const serverBookmark = makeServerBookmark({
        id: 'new-server-id', url: 'https://example.com', title: 'Replaced',
      });

      mockGetChanges.mockResolvedValue({
        changes: [
          { type: 'deleted', bookmarkId: 'old-id' },
          { type: 'created', bookmark: serverBookmark },
        ] satisfies SyncChange[],
        syncTimestamp: '2024-01-03T00:00:00.000Z',
      });

      await syncManager.incrementalSync();

      const allBookmarks = await db.bookmarks.toArray();
      expect(allBookmarks).toHaveLength(1);
      expect(allBookmarks[0].id).toBe('new-server-id');
      expect(allBookmarks[0].title).toBe('Replaced');
    });

    it('should handle server html null with no local duplicate', async () => {
      // No local bookmark at all — server sends one with null html
      const serverBookmark = makeServerBookmark({
        id: 'server-id', url: 'https://new.com',
        html: null,
      });

      mockGetChanges.mockResolvedValue({
        changes: [{ type: 'created', bookmark: serverBookmark }] satisfies SyncChange[],
        syncTimestamp: '2024-01-03T00:00:00.000Z',
      });

      await syncManager.incrementalSync();

      const bookmark = await db.bookmarks.get('server-id');
      expect(bookmark).toBeDefined();
      expect(bookmark!.html).toBe('');
    });
  });
});
