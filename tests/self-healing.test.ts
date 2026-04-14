import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import {
  runDiagnostics,
  findDuplicateBookmarks,
  pickBestBookmark,
  healDuplicateBookmarks,
  healNoContent,
  healNoMarkdown,
  healShortMarkdown,
  healNoSummary,
  healNoQuestions,
  healStaleEmbeddings,
  regenerateFromContent,
  regenerateFromMarkdown,
  regenerateFromSummary,
  regenerateFromQuestions,
  regenerateEmbeddings,
} from '../src/lib/self-healing';
import { setPlatformAdapter, type PlatformAdapter, type ApiSettings } from '../src/lib/platform';
import * as api from '../src/lib/api';
import * as extract from '../src/lib/extract';
import * as processor from '../src/background/processor';

vi.mock('../src/lib/api', () => ({
  generateQAPairs: vi.fn(),
  generateEmbeddings: vi.fn(),
  generateSummary: vi.fn(),
}));

vi.mock('../src/lib/extract', () => ({
  extractMarkdownAsync: vi.fn(),
}));

vi.mock('../src/lib/browser-fetch', () => ({
  browserFetch: vi.fn().mockResolvedValue({ html: '<html>fetched</html>', title: 'Fetched' }),
}));

vi.mock('../src/background/processor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/processor')>();
  return {
    ...actual,
    fetchBookmarkHtml: vi.fn().mockImplementation(async (bookmark: { id: string; url: string; html: string; title: string }) => ({
      ...bookmark,
      html: '<html>fetched</html>',
      title: bookmark.title || 'Fetched',
      status: 'downloaded',
    })),
  };
});

const { mockDeleteBookmark, MockServerApiClient, MockServerApiError, mockQueueOfflineChange, mockGetSettings } = vi.hoisted(() => {
  const mockDeleteBookmark = vi.fn();
  const MockServerApiClient = vi.fn().mockImplementation(function (this: { deleteBookmark: typeof mockDeleteBookmark }) {
    this.deleteBookmark = mockDeleteBookmark;
  });

  class MockServerApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
    isNotFound() { return this.status === 404; }
    isUnauthorized() { return this.status === 401; }
    isConflict() { return this.status === 409; }
    isRateLimited() { return this.status === 429; }
  }

  const mockQueueOfflineChange = vi.fn();
  const mockGetSettings = vi.fn();

  return { mockDeleteBookmark, MockServerApiClient, MockServerApiError, mockQueueOfflineChange, mockGetSettings };
});

vi.mock('../src/lib/server-api', () => ({
  ServerApiClient: MockServerApiClient,
  ServerApiError: MockServerApiError,
}));

vi.mock('../src/lib/server-sync', () => ({
  serverSync: {
    queueOfflineChange: (...args: unknown[]) => mockQueueOfflineChange(...args),
  },
}));

vi.mock('../src/lib/settings', () => ({
  getSettings: mockGetSettings,
  saveSetting: vi.fn(),
}));
const TEST_SETTINGS: ApiSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  serverUrl: '',
  serverEnabled: false,
  serverSessionToken: '',
  serverSessionExpiry: '',
  serverAuthToken: '',
  serverLastSyncTime: '',
  serverLastSyncError: '',
  contentTier: 'full',
  markdownCacheCapMB: 50,
  markdownCacheBytes: 0,
  contentTierMigrationAt: '',
};

const mockAdapter: PlatformAdapter = {
  getSettings: vi.fn().mockResolvedValue(TEST_SETTINGS),
  saveSetting: vi.fn(),
  getTheme: vi.fn().mockResolvedValue('auto' as const),
  setTheme: vi.fn(),
};

setPlatformAdapter(mockAdapter);

async function clearAllTables(): Promise<void> {
  await db.bookmarks.clear();
  await db.markdown.clear();
  await db.questionsAnswers.clear();
  await db.summaries.clear();
  await db.bookmarkTags.clear();
  await db.jobs.clear();
}

function createBookmark(overrides: Partial<{ id: string; html: string; url: string; title: string; status: string }> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Test Page',
    html: overrides.html ?? '<html><body>Test content</body></html>',
    status: (overrides.status ?? 'complete') as 'complete',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Self-Healing Diagnostics', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('runDiagnostics', () => {
    it('should return empty array when all bookmarks are healthy', async () => {
      const bookmark = createBookmark({ id: 'b1' });
      await db.bookmarks.add(bookmark);
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary text',
        embedding: [0.1, 0.2], embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.1], embeddingAnswer: [0.2], embeddingBoth: [0.3],
        embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      expect(results).toHaveLength(0);
    });

    it('should detect no_content bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));

      const results = await runDiagnostics();
      const noContent = results.find(r => r.type === 'no_content');
      expect(noContent).toBeDefined();
      expect(noContent!.bookmarkIds).toContain('b1');
      expect(noContent!.count).toBe(1);
    });

    it('should detect no_markdown bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));

      const results = await runDiagnostics();
      const noMarkdown = results.find(r => r.type === 'no_markdown');
      expect(noMarkdown).toBeDefined();
      expect(noMarkdown!.bookmarkIds).toContain('b1');
    });

    it('should detect short_markdown bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const shortMd = results.find(r => r.type === 'short_markdown');
      expect(shortMd).toBeDefined();
      expect(shortMd!.bookmarkIds).toContain('b1');
    });

    it('should detect no_summary bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const noSummary = results.find(r => r.type === 'no_summary');
      expect(noSummary).toBeDefined();
      expect(noSummary!.bookmarkIds).toContain('b1');
    });

    it('should detect no_questions bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.1], embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const noQ = results.find(r => r.type === 'no_questions');
      expect(noQ).toBeDefined();
      expect(noQ!.bookmarkIds).toContain('b1');
    });

    it('should detect stale_embeddings when model differs', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.1], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.1], embeddingAnswer: [0.2], embeddingBoth: [0.3],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const stale = results.find(r => r.type === 'stale_embeddings');
      expect(stale).toBeDefined();
      expect(stale!.bookmarkIds).toContain('b1');
    });

    it('should detect stale_embeddings when model is undefined', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.1], embeddingAnswer: [0.2], embeddingBoth: [0.3],
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const stale = results.find(r => r.type === 'stale_embeddings');
      expect(stale).toBeDefined();
      expect(stale!.bookmarkIds).toContain('b1');
    });

    it('should handle multiple issues for the same bookmark', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const types = results.map(r => r.type);
      expect(types).toContain('short_markdown');
      expect(types).toContain('no_summary');
      expect(types).toContain('no_questions');
    });
  });

});

describe('Duplicate Bookmark Detection', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();
    vi.mocked(mockAdapter.getSettings).mockResolvedValue(TEST_SETTINGS);
    mockGetSettings.mockResolvedValue(TEST_SETTINGS);
    MockServerApiClient.mockImplementation(function (this: { deleteBookmark: typeof mockDeleteBookmark }) {
      this.deleteBookmark = mockDeleteBookmark;
    });
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('findDuplicateBookmarks', () => {
    it('should return empty map when no duplicates exist', () => {
      const bookmarks = [
        createBookmark({ id: 'b1', url: 'https://example.com' }),
        createBookmark({ id: 'b2', url: 'https://other.com' }),
      ];
      const result = findDuplicateBookmarks(bookmarks);
      expect(result.size).toBe(0);
    });

    it('should detect bookmarks with the same URL', () => {
      const bookmarks = [
        createBookmark({ id: 'b1', url: 'https://example.com' }),
        createBookmark({ id: 'b2', url: 'https://example.com' }),
        createBookmark({ id: 'b3', url: 'https://other.com' }),
      ];
      const result = findDuplicateBookmarks(bookmarks);
      expect(result.size).toBe(1);
      expect(result.get('https://example.com')).toHaveLength(2);
    });

    it('should detect multiple duplicate groups', () => {
      const bookmarks = [
        createBookmark({ id: 'b1', url: 'https://a.com' }),
        createBookmark({ id: 'b2', url: 'https://a.com' }),
        createBookmark({ id: 'b3', url: 'https://b.com' }),
        createBookmark({ id: 'b4', url: 'https://b.com' }),
        createBookmark({ id: 'b5', url: 'https://b.com' }),
      ];
      const result = findDuplicateBookmarks(bookmarks);
      expect(result.size).toBe(2);
      expect(result.get('https://a.com')).toHaveLength(2);
      expect(result.get('https://b.com')).toHaveLength(3);
    });
  });

  describe('pickBestBookmark', () => {
    it('should prefer complete status over others', () => {
      const bookmarks = [
        createBookmark({ id: 'b1', status: 'error' }),
        createBookmark({ id: 'b2', status: 'complete' }),
      ];
      expect(pickBestBookmark(bookmarks).id).toBe('b2');
    });

    it('should prefer non-error status when none are complete', () => {
      const bookmarks = [
        createBookmark({ id: 'b1', status: 'error' }),
        createBookmark({ id: 'b2', status: 'pending' }),
      ];
      expect(pickBestBookmark(bookmarks).id).toBe('b2');
    });

    it('should prefer more HTML content when statuses match', () => {
      const bookmarks = [
        createBookmark({ id: 'b1', html: '<p>short</p>' }),
        createBookmark({ id: 'b2', html: '<html><body><p>much longer content here</p></body></html>' }),
      ];
      expect(pickBestBookmark(bookmarks).id).toBe('b2');
    });

    it('should prefer newer updatedAt when all else is equal', () => {
      const older = createBookmark({ id: 'b1' });
      older.updatedAt = new Date('2024-01-01');
      const newer = createBookmark({ id: 'b2' });
      newer.updatedAt = new Date('2025-01-01');
      expect(pickBestBookmark([older, newer]).id).toBe('b2');
    });
  });

  describe('runDiagnostics with duplicates', () => {
    it('should detect duplicate_bookmarks issue', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));

      const results = await runDiagnostics();
      const dupes = results.find(r => r.type === 'duplicate_bookmarks');
      expect(dupes).toBeDefined();
      expect(dupes!.count).toBe(2);
      expect(dupes!.bookmarkIds).toContain('b1');
      expect(dupes!.bookmarkIds).toContain('b2');
    });

    it('should not report duplicate_bookmarks when none exist', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://a.com' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://b.com' }));

      const results = await runDiagnostics();
      const dupes = results.find(r => r.type === 'duplicate_bookmarks');
      expect(dupes).toBeUndefined();
    });
  });

  describe('healDuplicateBookmarks', () => {
    it('should merge duplicates keeping the best bookmark', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com', html: '<html>full content</html>' }));

      await healDuplicateBookmarks(['b1', 'b2']);

      const remaining = await db.bookmarks.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('b2');
      expect(remaining[0].html).toBe('<html>full content</html>');
    });

    it('should delete related records of loser bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Old markdown',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.1], embeddingModel: 'test',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await healDuplicateBookmarks(['b1', 'b2']);

      const markdown = await db.markdown.where('bookmarkId').equals('b1').toArray();
      expect(markdown).toHaveLength(0);
      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(0);
    });

    it('should migrate tags from loser to keeper', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));
      await db.bookmarkTags.add({ bookmarkId: 'b1', tagName: 'unique-tag', addedAt: new Date() });
      await db.bookmarkTags.add({ bookmarkId: 'b2', tagName: 'existing-tag', addedAt: new Date() });

      await healDuplicateBookmarks(['b1', 'b2']);

      const keeperTags = await db.bookmarkTags.where('bookmarkId').equals('b2').toArray();
      const tagNames = keeperTags.map(t => t.tagName);
      expect(tagNames).toContain('unique-tag');
      expect(tagNames).toContain('existing-tag');
    });

    it('should not duplicate shared tags during migration', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));
      await db.bookmarkTags.add({ bookmarkId: 'b1', tagName: 'shared-tag', addedAt: new Date() });
      await db.bookmarkTags.add({ bookmarkId: 'b2', tagName: 'shared-tag', addedAt: new Date() });

      await healDuplicateBookmarks(['b1', 'b2']);

      const keeperTags = await db.bookmarkTags.where('bookmarkId').equals('b2').toArray();
      expect(keeperTags).toHaveLength(1);
      expect(keeperTags[0].tagName).toBe('shared-tag');
    });

    it('should handle three-way duplicates', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com', html: '<p>some</p>' }));
      await db.bookmarks.add(createBookmark({ id: 'b3', url: 'https://example.com', html: '<html><body>longest</body></html>' }));

      await healDuplicateBookmarks(['b1', 'b2', 'b3']);

      const remaining = await db.bookmarks.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('b3');
    });

    it('should fire progress callbacks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://a.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://a.com' }));
      await db.bookmarks.add(createBookmark({ id: 'b3', url: 'https://b.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b4', url: 'https://b.com' }));

      const progressCalls: [number, number][] = [];
      await healDuplicateBookmarks(
        ['b1', 'b2', 'b3', 'b4'],
        (done, total) => progressCalls.push([done, total]),
      );

      expect(progressCalls).toEqual([[1, 2], [2, 2]]);
    });

    it('should respect abort signal', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://a.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://a.com' }));
      await db.bookmarks.add(createBookmark({ id: 'b3', url: 'https://b.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b4', url: 'https://b.com' }));

      const controller = new AbortController();
      controller.abort();

      await healDuplicateBookmarks(['b1', 'b2', 'b3', 'b4'], undefined, controller.signal);

      // Nothing should have been deleted since signal was pre-aborted
      const remaining = await db.bookmarks.toArray();
      expect(remaining).toHaveLength(4);
    });

    it('should not call server when sync is disabled', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));

      await healDuplicateBookmarks(['b1', 'b2']);

      expect(mockDeleteBookmark).not.toHaveBeenCalled();
      expect(mockQueueOfflineChange).not.toHaveBeenCalled();
    });

    it('should delete losers from server when sync is enabled', async () => {
      const serverSettings = { ...TEST_SETTINGS, serverEnabled: true, serverUrl: 'https://server.test', serverSessionToken: 'tok' };
      mockGetSettings.mockResolvedValue(serverSettings);
      mockDeleteBookmark.mockResolvedValue(undefined);

      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));

      await healDuplicateBookmarks(['b1', 'b2']);

      // b1 is the loser (no html), should be deleted from server
      expect(mockDeleteBookmark).toHaveBeenCalledWith('b1');
      expect(mockDeleteBookmark).toHaveBeenCalledTimes(1);
    });

    it('should ignore 404 when loser does not exist on server', async () => {
      const serverSettings = { ...TEST_SETTINGS, serverEnabled: true, serverUrl: 'https://server.test', serverSessionToken: 'tok' };
      mockGetSettings.mockResolvedValue(serverSettings);
      mockDeleteBookmark.mockRejectedValue(new MockServerApiError('Not found', 404));

      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));

      await healDuplicateBookmarks(['b1', 'b2']);

      expect(mockDeleteBookmark).toHaveBeenCalledWith('b1');
      // Should NOT queue offline change for 404
      expect(mockQueueOfflineChange).not.toHaveBeenCalled();
    });

    it('should queue offline change when server delete fails with network error', async () => {
      const serverSettings = { ...TEST_SETTINGS, serverEnabled: true, serverUrl: 'https://server.test', serverSessionToken: 'tok' };
      mockGetSettings.mockResolvedValue(serverSettings);
      mockDeleteBookmark.mockRejectedValue(new MockServerApiError('Network error', 0, 'NETWORK_ERROR'));

      await db.bookmarks.add(createBookmark({ id: 'b1', url: 'https://example.com', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example.com' }));

      await healDuplicateBookmarks(['b1', 'b2']);

      expect(mockQueueOfflineChange).toHaveBeenCalledWith({
        type: 'delete',
        bookmarkId: 'b1',
        timestamp: expect.any(Number),
      });
    });
  });
});

describe('Self-Healing Heal Operations', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();

    vi.spyOn(api, 'generateSummary').mockResolvedValue('Generated summary');
    vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
      { question: 'Q?', answer: 'A' },
    ]);
    vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
      title: 'Test', content: 'Extracted markdown content that is long enough',
      excerpt: 'Test', byline: null,
    });
    vi.spyOn(processor, 'processBookmarkContent');
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('healNoContent', () => {
    it('should fetch HTML and process bookmark', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));

      await healNoContent(['b1']);

      expect(processor.fetchBookmarkHtml).toHaveBeenCalled();
      expect(processor.processBookmarkContent).toHaveBeenCalled();
    });

    it('should skip nonexistent bookmarks', async () => {
      await healNoContent(['nonexistent-id']);

      expect(processor.fetchBookmarkHtml).not.toHaveBeenCalled();
      expect(processor.processBookmarkContent).not.toHaveBeenCalled();
    });

    it('should continue on error', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', html: '', url: 'https://example2.com' }));

      vi.mocked(processor.fetchBookmarkHtml)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          id: 'b2', url: 'https://example2.com', html: '<html>ok</html>',
          title: 'OK', status: 'downloaded', createdAt: new Date(), updatedAt: new Date(),
        });

      await healNoContent(['b1', 'b2']);

      expect(processor.processBookmarkContent).toHaveBeenCalledTimes(1);
    });

    it('should report progress', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', html: '', url: 'https://example2.com' }));

      const progressCalls: [number, number][] = [];
      await healNoContent(['b1', 'b2'], (done, total) => progressCalls.push([done, total]));

      expect(progressCalls).toEqual([[1, 2], [2, 2]]);
    });

    it('should respect abort signal', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', html: '', url: 'https://example2.com' }));

      const controller = new AbortController();
      controller.abort();

      await healNoContent(['b1', 'b2'], undefined, controller.signal);

      expect(processor.fetchBookmarkHtml).not.toHaveBeenCalled();
    });
  });

  describe('healNoSummary', () => {
    it('should generate summary for bookmarks missing summaries', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Some markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await healNoSummary(['b1']);

      const summary = await db.summaries.where('bookmarkId').equals('b1').first();
      expect(summary).toBeDefined();
      expect(summary!.content).toBe('Generated summary');
      expect(summary!.embeddingModel).toBe('text-embedding-3-small');
    });

    it('should not overwrite existing summaries', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Some markdown',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Existing summary',
        embedding: [0.1], embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await healNoSummary(['b1']);

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
    });

    it('should skip bookmarks without markdown', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));

      await healNoSummary(['b1']);

      const summary = await db.summaries.where('bookmarkId').equals('b1').first();
      expect(summary).toBeUndefined();
    });

    it('should fire progress callbacks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Content',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const progressCalls: [number, number][] = [];
      await healNoSummary(['b1'], (done, total) => progressCalls.push([done, total]));

      expect(progressCalls).toEqual([[1, 1]]);
    });
  });

  describe('healNoQuestions', () => {
    it('should generate Q&A pairs for bookmarks missing them', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Some markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await healNoQuestions(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').toArray();
      expect(qa).toHaveLength(1);
      expect(qa[0].question).toBe('Q?');
      expect(qa[0].embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('healNoMarkdown', () => {
    it('should extract markdown and trigger downstream generation', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await healNoMarkdown(['b1']);

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md).toBeDefined();
      expect(md!.content).toBe('Extracted markdown content that is long enough');
    });
  });

  describe('healShortMarkdown', () => {
    it('should re-fetch and regenerate markdown', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await healShortMarkdown(['b1']);

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md).toBeDefined();
      expect(md!.content).toBe('Extracted markdown content that is long enough');
    });

    it('should delete old summary and QA before regenerating', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Old summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Old Q?', answer: 'Old A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await healShortMarkdown(['b1']);

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toBe('Generated summary');

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').toArray();
      expect(qa).toHaveLength(1);
      expect(qa[0].question).toBe('Q?');
    });

    it('should skip nonexistent bookmarks', async () => {
      await healShortMarkdown(['nonexistent-id']);

      expect(processor.fetchBookmarkHtml).not.toHaveBeenCalled();
    });

    it('should report progress', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const progressCalls: [number, number][] = [];
      await healShortMarkdown(['b1'], (done, total) => progressCalls.push([done, total]));

      expect(progressCalls).toEqual([[1, 1]]);
    });

    it('should respect abort signal', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const controller = new AbortController();
      controller.abort();

      await healShortMarkdown(['b1'], undefined, controller.signal);

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md!.content).toBe('Short');
    });
  });

  describe('healStaleEmbeddings', () => {
    it('should regenerate embeddings for QA records with stale model', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.9]])
        .mockResolvedValueOnce([[0.8]])
        .mockResolvedValueOnce([[0.7]]);

      await healStaleEmbeddings(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').first();
      expect(qa!.embeddingQuestion).toEqual([0.9]);
      expect(qa!.embeddingModel).toBe('text-embedding-3-small');
    });

    it('should regenerate embeddings for summary records', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings').mockResolvedValueOnce([[0.9]]);

      await healStaleEmbeddings(['b1']);

      const summary = await db.summaries.where('bookmarkId').equals('b1').first();
      expect(summary!.embedding).toEqual([0.9]);
      expect(summary!.embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('abort signal cancellation', () => {
    it('should stop processing when signal is aborted', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example2.com' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Content 1',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.markdown.add({
        id: 'md2', bookmarkId: 'b2', content: 'Content 2',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const controller = new AbortController();
      let callCount = 0;

      vi.spyOn(api, 'generateSummary').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          controller.abort();
        }
        return 'summary';
      });

      await healNoSummary(['b1', 'b2'], undefined, controller.signal);

      const summaries = await db.summaries.toArray();
      expect(summaries).toHaveLength(1);
    });
  });
});

describe('Self-Healing Upstream Regeneration', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();

    vi.spyOn(api, 'generateSummary').mockResolvedValue('New summary');
    vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.5]]);
    vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
      { question: 'New Q?', answer: 'New A' },
    ]);
    vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
      title: 'Test', content: 'New markdown content',
      excerpt: 'Test', byline: null,
    });
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('regenerateFromContent', () => {
    it('should clear all data, re-fetch HTML, and reprocess end-to-end', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Old markdown',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Old summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Old Q?', answer: 'Old A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await regenerateFromContent(['b1']);

      expect(processor.fetchBookmarkHtml).toHaveBeenCalled();
      expect(processor.processBookmarkContent).toHaveBeenCalled();

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md).toBeDefined();
      expect(md!.content).toBe('New markdown content');

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toBe('New summary');
    });
  });

  describe('regenerateFromSummary', () => {
    it('should delete existing summary and regenerate', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Old summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await regenerateFromSummary(['b1']);

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toBe('New summary');
      expect(summaries[0].embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('regenerateFromQuestions', () => {
    it('should delete existing Q&A and regenerate', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Old Q?', answer: 'Old A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await regenerateFromQuestions(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').toArray();
      expect(qa).toHaveLength(1);
      expect(qa[0].question).toBe('New Q?');
    });
  });

  describe('regenerateFromMarkdown', () => {
    it('should delete markdown, summary, and questions then regenerate', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Old markdown',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Old summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Old Q?', answer: 'Old A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        createdAt: new Date(), updatedAt: new Date(),
      });

      await regenerateFromMarkdown(['b1']);

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md!.content).toBe('New markdown content');

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toBe('New summary');
    });
  });

  describe('regenerateEmbeddings', () => {
    it('should regenerate embeddings without changing text content', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.9]])
        .mockResolvedValueOnce([[0.8]])
        .mockResolvedValueOnce([[0.7]]);

      await regenerateEmbeddings(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').first();
      expect(qa!.question).toBe('Q?');
      expect(qa!.answer).toBe('A');
      expect(qa!.embeddingQuestion).toEqual([0.9]);
      expect(qa!.embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('progress callbacks for regeneration', () => {
    it('should fire progress callbacks during regeneration', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example2.com' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Content',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.markdown.add({
        id: 'md2', bookmarkId: 'b2', content: 'Content 2',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const progressCalls: [number, number][] = [];
      await regenerateFromSummary(['b1', 'b2'], (done, total) => progressCalls.push([done, total]));

      expect(progressCalls).toEqual([[1, 2], [2, 2]]);
    });
  });
});

describe('generateSummary API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be called with markdown content during heal', async () => {
    await clearAllTables();

    await db.bookmarks.add(createBookmark({ id: 'b1' }));
    await db.markdown.add({
      id: 'md1', bookmarkId: 'b1', content: 'Test markdown for summary',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const summaryMock = vi.spyOn(api, 'generateSummary').mockResolvedValue('Generated summary');
    vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1]]);

    await healNoSummary(['b1']);

    expect(summaryMock).toHaveBeenCalledWith('Test markdown for summary');

    await clearAllTables();
  });
});
