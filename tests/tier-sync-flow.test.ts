import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import type { ServerBookmarkFull } from '../src/lib/server-api';

// ─── Mock the network layer ───────────────────────────────────────────────
const mockGetBookmarkFull = vi.fn();
const mockFromSettings = vi.fn();

vi.mock('../src/lib/server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/server-api')>();
  return {
    ...actual,
    ServerApiClient: {
      fromSettings: (...args: unknown[]) => mockFromSettings(...args),
    },
  };
});

// ─── Settings adapter (in-memory, behaves like the real DB-backed adapter) ─
const settingsStore: Record<string, string | boolean | number> = {};

vi.mock('../src/lib/settings', () => ({
  getSettings: vi.fn().mockImplementation(() => Promise.resolve({
    apiBaseUrl: '', apiKey: '', chatModel: '', embeddingModel: '',
    serverUrl: 'https://sync.example.com',
    serverEnabled: true,
    serverSessionToken: 'session-tok-abc',
    serverSessionExpiry: '2099-01-01T00:00:00.000Z',
    serverAuthToken: 'auth-tok-abc',
    serverLastSyncTime: settingsStore.serverLastSyncTime ?? '2026-04-01T00:00:00.000Z',
    serverLastSyncError: '',
    contentTier: settingsStore.contentTier ?? 'full',
    markdownCacheCapMB: settingsStore.markdownCacheCapMB ?? 50,
    markdownCacheBytes: settingsStore.markdownCacheBytes ?? 0,
    contentTierMigrationAt: settingsStore.contentTierMigrationAt ?? '',
  })),
  saveSetting: vi.fn().mockImplementation((key: string, value: string | boolean | number) => {
    settingsStore[key] = value;
    return Promise.resolve();
  }),
}));

vi.mock('../src/lib/events', () => ({
  events: {
    sync:  { started: vi.fn(), completed: vi.fn(), failed: vi.fn() },
    tier:  { changed: vi.fn(), evicted: vi.fn() },
  },
}));

vi.mock('../src/lib/jobs', () => ({
  createJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
}));

import { ServerSyncManager } from '../src/lib/server-sync';

// ─── Realistic content shaped like real article extractions ───────────────
function makeArticleMarkdown(title: string, paragraphs: number, sentencesPerPara = 6): string {
  const lorem = 'Service workers can disconnect for reasons that are not always obvious to the developer reading the logs after the fact. ';
  const para = lorem.repeat(sentencesPerPara);
  return `# ${title}\n\n${Array.from({ length: paragraphs }, () => para).join('\n\n')}`;
}

function makeServerFull(overrides: Partial<ServerBookmarkFull>): ServerBookmarkFull {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    url: overrides.url ?? `https://example.com/${id}`,
    title: overrides.title ?? 'Untitled article',
    html: overrides.html ?? '<html><body>...</body></html>',
    markdown: overrides.markdown ?? null,
    status: 'complete',
    errorMessage: null,
    createdAt: overrides.createdAt ?? '2026-04-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-10T10:00:00.000Z',
    deletedAt: null,
    tags: overrides.tags ?? [],
    qaPairs: overrides.qaPairs ?? [],
  };
}

async function clearAllTables(): Promise<void> {
  await db.bookmarks.clear();
  await db.markdown.clear();
  await db.questionsAnswers.clear();
  await db.summaries.clear();
}

describe('Tier + sync + eviction end-to-end', () => {
  let syncManager: ServerSyncManager;

  beforeEach(async () => {
    await clearAllTables();
    for (const k of Object.keys(settingsStore)) delete settingsStore[k];
    vi.clearAllMocks();
    syncManager = new ServerSyncManager();
    mockFromSettings.mockResolvedValue({
      getBookmarkFull: mockGetBookmarkFull,
    });
  });

  describe('full tier (default)', () => {
    it('caches markdown + Q&A on fetch and tracks bytes', async () => {
      settingsStore.contentTier = 'full';
      const md = makeArticleMarkdown('Service worker deaths', 8);
      const bookmark = makeServerFull({
        id: 'bm-full-1',
        title: 'Service worker deaths',
        markdown: md,
        qaPairs: [
          { id: 'qa-1', question: 'Why do service workers die?', answer: 'Many reasons.', createdAt: '2026-04-10T10:00:00.000Z' },
        ],
      });
      mockGetBookmarkFull.mockResolvedValue(bookmark);

      // Pre-existing local stub (the bookmark row from incremental sync).
      await db.bookmarks.add({
        id: 'bm-full-1', url: bookmark.url, title: bookmark.title,
        html: '', status: 'complete',
        createdAt: new Date(bookmark.createdAt), updatedAt: new Date(bookmark.updatedAt),
      });

      const result = await syncManager.fetchBookmarkContent('bm-full-1');
      expect(result).toBeTruthy();

      const stored = await db.markdown.where('bookmarkId').equals('bm-full-1').first();
      expect(stored).toBeDefined();
      expect(stored?.content).toBe(md);
      expect(stored?.sizeBytes).toBe(md.length * 2);
      expect(stored?.lastAccessedAt).toBeInstanceOf(Date);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('bm-full-1').toArray();
      expect(qa).toHaveLength(1);
      expect(qa[0].question).toBe('Why do service workers die?');

      // markdownCacheBytes setting should match the inserted size.
      expect(settingsStore.markdownCacheBytes).toBe(md.length * 2);
    });

    it('updating an existing markdown row computes a delta, not double-counts', async () => {
      settingsStore.contentTier = 'full';
      const initial = makeArticleMarkdown('First version', 4);
      const updated = makeArticleMarkdown('Second version - longer', 12);

      await db.bookmarks.add({
        id: 'bm-update', url: 'https://example.com/update', title: 'Update test',
        html: '', status: 'complete',
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-10T10:00:00.000Z'),
      });

      mockGetBookmarkFull.mockResolvedValueOnce(makeServerFull({ id: 'bm-update', markdown: initial }));
      await syncManager.fetchBookmarkContent('bm-update');
      expect(settingsStore.markdownCacheBytes).toBe(initial.length * 2);

      mockGetBookmarkFull.mockResolvedValueOnce(makeServerFull({ id: 'bm-update', markdown: updated }));
      await syncManager.fetchBookmarkContent('bm-update');
      // After replace, the running total should equal the new size, not initial+updated.
      expect(settingsStore.markdownCacheBytes).toBe(updated.length * 2);
    });
  });

  describe('summaries tier', () => {
    it('drops Q&A text on fetch but keeps markdown for the LRU', async () => {
      settingsStore.contentTier = 'summaries';
      const md = makeArticleMarkdown('Caching essay', 6);
      const bookmark = makeServerFull({
        id: 'bm-sum-1',
        markdown: md,
        qaPairs: [
          { id: 'qa-1', question: 'What is a cache?', answer: 'A fast lookup.', createdAt: '2026-04-10T10:00:00.000Z' },
          { id: 'qa-2', question: 'Why cache?',       answer: 'Because slow.',  createdAt: '2026-04-10T10:00:00.000Z' },
        ],
      });
      mockGetBookmarkFull.mockResolvedValue(bookmark);

      await db.bookmarks.add({
        id: 'bm-sum-1', url: bookmark.url, title: bookmark.title,
        html: '', status: 'complete',
        createdAt: new Date(bookmark.createdAt), updatedAt: new Date(bookmark.updatedAt),
      });

      await syncManager.fetchBookmarkContent('bm-sum-1');

      const stored = await db.markdown.where('bookmarkId').equals('bm-sum-1').first();
      expect(stored?.content).toBe(md);

      // Q&A text must NOT be cached locally in summaries tier.
      const qa = await db.questionsAnswers.where('bookmarkId').equals('bm-sum-1').toArray();
      expect(qa).toHaveLength(0);
    });

    it('chains fetch → cache → byte tracking → eviction across many fetches', async () => {
      // Realistic scenario: user is in summaries mode with the minimum 1 MB
      // markdown cap (the floor enforced by getMarkdownCacheCapBytes). They
      // open five long-form essays (~430 KB each) — total ~2.1 MB — and the
      // LRU must evict oldest-accessed entries to stay under budget.
      settingsStore.contentTier = 'summaries';
      settingsStore.markdownCacheCapMB = 1;
      settingsStore.markdownCacheBytes = 0;

      // 150 paragraphs × 12-sentence lorem ≈ 215 K chars = ~430 KB UTF-16.
      // Realistic upper end of an extracted long-form article.
      const longArticle = (i: number): string => makeArticleMarkdown(`Essay ${i}`, 150, 12);
      const articles = Array.from({ length: 5 }, (_, i) => ({
        id: `art-${i + 1}`,
        md: longArticle(i + 1),
      }));

      // Per-article size sanity: each must be > 200 KB so 5 of them blow past 1 MB.
      for (const a of articles) {
        expect(a.md.length * 2).toBeGreaterThan(200 * 1024);
      }

      // Seed local bookmark stubs (simulates incremental sync metadata).
      for (const a of articles) {
        await db.bookmarks.add({
          id: a.id, url: `https://example.com/${a.id}`, title: a.id,
          html: '', status: 'complete',
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          updatedAt: new Date('2026-04-10T10:00:00.000Z'),
        });
      }

      // Open each in order with a real wall-clock gap between fetches so
      // lastAccessedAt is monotonically increasing.
      for (const a of articles) {
        mockGetBookmarkFull.mockResolvedValueOnce(makeServerFull({ id: a.id, markdown: a.md }));
        await syncManager.fetchBookmarkContent(a.id);
        await new Promise(r => setTimeout(r, 5));
      }

      // Final cache size must respect the 1 MB cap.
      const capBytes = 1 * 1024 * 1024;
      const finalBytes = settingsStore.markdownCacheBytes as number;
      expect(finalBytes).toBeLessThanOrEqual(capBytes);

      // Eviction must have happened — at least one article gone.
      const survivors = await db.markdown.toCollection().primaryKeys() as string[];
      expect(survivors.length).toBeLessThan(articles.length);

      // The OLDEST-accessed article (art-1) must be the first to go.
      expect(survivors).not.toContain('art-1-md');

      // The MOST-RECENTLY-accessed article (art-5) must still be present —
      // LRU correctness check.
      expect(survivors).toContain('art-5-md');
    });
  });

  describe('titles tier', () => {
    it('drops both markdown AND Q&A text on fetch', async () => {
      settingsStore.contentTier = 'titles';
      const bookmark = makeServerFull({
        id: 'bm-titles-1',
        markdown: makeArticleMarkdown('Should not be stored', 5),
        qaPairs: [
          { id: 'qa-1', question: 'q', answer: 'a', createdAt: '2026-04-10T10:00:00.000Z' },
        ],
      });
      mockGetBookmarkFull.mockResolvedValue(bookmark);

      await db.bookmarks.add({
        id: 'bm-titles-1', url: bookmark.url, title: bookmark.title,
        html: '', status: 'complete',
        createdAt: new Date(bookmark.createdAt), updatedAt: new Date(bookmark.updatedAt),
      });

      await syncManager.fetchBookmarkContent('bm-titles-1');

      const md = await db.markdown.where('bookmarkId').equals('bm-titles-1').first();
      const qa = await db.questionsAnswers.where('bookmarkId').equals('bm-titles-1').toArray();
      expect(md).toBeUndefined();
      expect(qa).toHaveLength(0);

      // markdownCacheBytes must not be incremented when nothing was stored.
      expect(settingsStore.markdownCacheBytes ?? 0).toBe(0);
    });

    it('uploadAllBookmarks refuses outside full tier when already synced', async () => {
      // The guard exists to prevent regressing server state with an incomplete
      // local copy. Once the user has synced at least once, the server is the
      // source of truth and non-full-tier uploads must be blocked.
      settingsStore.contentTier = 'titles';
      settingsStore.serverLastSyncTime = '2026-04-01T00:00:00.000Z';
      const result = await syncManager.uploadAllBookmarks();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Full content tier/i);
    });
  });

  // ─── Reviewer finding #8: first-time upload must work in any tier ─────────
  describe('first-time upload (never-synced user)', () => {
    it('FAILING: uploadAllBookmarks accepts a never-synced summaries-tier user', async () => {
      // Scenario: user installs fresh, turns on tier=summaries in settings
      // before completing their first sync, then tries to push local
      // bookmarks. Current code refuses → bookmarks are orphaned forever.
      settingsStore.contentTier = 'summaries';
      settingsStore.serverLastSyncTime = ''; // never synced before

      await db.bookmarks.add({
        id: 'bm-first', url: 'https://example.com/first',
        title: 'First upload ever', html: '<p>x</p>', status: 'complete',
        createdAt: new Date('2026-04-10T10:00:00.000Z'),
        updatedAt: new Date('2026-04-10T10:00:00.000Z'),
      });

      mockFromSettings.mockResolvedValue({
        uploadFullSync: vi.fn().mockResolvedValue({
          created: 1, updated: 0, conflicts: [], syncToken: '2026-04-14T09:00:00.000Z',
        }),
      });

      const result = await syncManager.uploadAllBookmarks();
      expect(result.success).toBe(true);
    });

    it('FAILING: uploadAllBookmarks accepts a never-synced titles-tier user', async () => {
      settingsStore.contentTier = 'titles';
      settingsStore.serverLastSyncTime = '';

      await db.bookmarks.add({
        id: 'bm-titles-first', url: 'https://example.com/titles-first',
        title: 'Titles first upload', html: '<p>x</p>', status: 'complete',
        createdAt: new Date(), updatedAt: new Date(),
      });

      mockFromSettings.mockResolvedValue({
        uploadFullSync: vi.fn().mockResolvedValue({
          created: 1, updated: 0, conflicts: [], syncToken: '2026-04-14T09:00:00.000Z',
        }),
      });

      const result = await syncManager.uploadAllBookmarks();
      expect(result.success).toBe(true);
    });
  });

  // ─── Reviewer finding #3: concurrent byte-accounting race ─────────────────
  describe('cache-byte accounting under concurrency', () => {
    it('FAILING: five parallel fetches settle markdownCacheBytes to the correct sum', async () => {
      // Current code reads `settings.markdownCacheBytes` outside the Dexie
      // transaction and then writes `current + delta`. Concurrent calls all
      // read the same baseline and overwrite each other → total silently
      // drifts downward relative to real cache usage.
      settingsStore.contentTier = 'summaries';
      settingsStore.markdownCacheCapMB = 100; // big enough to prevent eviction
      settingsStore.markdownCacheBytes = 0;

      const articles = Array.from({ length: 5 }, (_, i) => ({
        id: `par-${i + 1}`,
        md: makeArticleMarkdown(`Parallel article ${i + 1}`, 5, 6),
      }));

      for (const a of articles) {
        await db.bookmarks.add({
          id: a.id, url: `https://example.com/${a.id}`, title: a.id,
          html: '', status: 'complete',
          createdAt: new Date(), updatedAt: new Date(),
        });
      }
      for (const a of articles) {
        mockGetBookmarkFull.mockResolvedValueOnce(makeServerFull({ id: a.id, markdown: a.md }));
      }

      // Fire all five concurrently (this is the race window).
      await Promise.all(articles.map(a => syncManager.fetchBookmarkContent(a.id)));

      const expectedTotal = articles.reduce((sum, a) => sum + a.md.length * 2, 0);
      const actualTotal = settingsStore.markdownCacheBytes as number;
      expect(actualTotal).toBe(expectedTotal);

      // Sanity cross-check: the running total should equal the real sum of
      // sizeBytes on disk.
      const rows = await db.markdown.toArray();
      const realSum = rows.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);
      expect(actualTotal).toBe(realSum);
    });
  });
});
