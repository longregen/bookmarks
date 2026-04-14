import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPlatformAdapter, type PlatformAdapter, type ApiSettings } from '../src/lib/platform';
import { db } from '../src/db/schema';

const mockFullSync = vi.fn().mockResolvedValue({
  success: true, action: 'full_sync', message: '', timestamp: Date.now(), bookmarkCount: 0,
});
const mockGetSyncStatus = vi.fn().mockResolvedValue({
  lastSyncTime: null,
  lastSyncError: null,
  isSyncing: false,
  pendingChanges: 0,
});

vi.mock('../src/lib/server-sync', () => ({
  serverSync: {
    getSyncStatus: (...args: unknown[]) => mockGetSyncStatus(...args),
    fullSync: (...args: unknown[]) => mockFullSync(...args),
  },
}));

import { enterTier, planTierTransition, maybeEvictMarkdownLRU, estimateMarkdownBytes, touchMarkdown } from '../src/lib/content-tier';

const settingsStore: Record<string, string | boolean | number> = {};

function baseSettings(): ApiSettings {
  return {
    apiBaseUrl: '', apiKey: '', chatModel: '', embeddingModel: '',
    serverUrl: '', serverEnabled: false, serverSessionToken: '',
    serverSessionExpiry: '', serverAuthToken: '',
    serverLastSyncTime: (settingsStore.serverLastSyncTime as string | undefined) ?? '',
    serverLastSyncError: '',
    contentTier: (settingsStore.contentTier as 'full' | 'summaries' | 'titles' | undefined) ?? 'full',
    markdownCacheCapMB: (settingsStore.markdownCacheCapMB as number | undefined) ?? 50,
    markdownCacheBytes: (settingsStore.markdownCacheBytes as number | undefined) ?? 0,
    contentTierMigrationAt: (settingsStore.contentTierMigrationAt as string | undefined) ?? '',
  };
}

const adapter: PlatformAdapter = {
  getSettings: vi.fn().mockImplementation(() => Promise.resolve(baseSettings())),
  saveSetting: vi.fn().mockImplementation((key: keyof ApiSettings, value: string | boolean | number) => {
    settingsStore[key] = value;
    return Promise.resolve();
  }),
  getTheme: vi.fn().mockResolvedValue('auto' as const),
  setTheme: vi.fn(),
};
setPlatformAdapter(adapter);

describe('content-tier', () => {
  beforeEach(async () => {
    for (const k of Object.keys(settingsStore)) delete settingsStore[k];
    await db.bookmarks.clear();
    await db.markdown.clear();
    await db.questionsAnswers.clear();
    await db.summaries.clear();
  });

  async function seedContent(id: string, markdownContent = 'hello world'): Promise<void> {
    const now = new Date();
    await db.bookmarks.add({
      id, url: `https://example.com/${id}`, title: id, html: '<p>x</p>',
      status: 'complete', createdAt: now, updatedAt: now,
    });
    await db.markdown.add({
      id: `${id}-md`, bookmarkId: id, content: markdownContent,
      createdAt: now, updatedAt: now,
      lastAccessedAt: now,
      sizeBytes: estimateMarkdownBytes(markdownContent),
    });
    await db.questionsAnswers.add({
      id: `${id}-qa`, bookmarkId: id, question: 'q', answer: 'a',
      embeddingQuestion: [0.1], embeddingAnswer: [0.1], embeddingBoth: [0.1],
      createdAt: now, updatedAt: now,
    });
    await db.summaries.add({
      id: `${id}-sum`, bookmarkId: id, content: 'summary', embedding: [0.1],
      createdAt: now, updatedAt: now,
    });
  }

  describe('planTierTransition', () => {
    it('reports counts for full → summaries', async () => {
      await seedContent('a');
      await seedContent('b');
      const plan = await planTierTransition('summaries');
      expect(plan.markdownRowsToDelete).toBe(2);
      expect(plan.qaRowsToDelete).toBe(2);
      expect(plan.summaryRowsToDelete).toBe(0);
      expect(plan.embeddingsPreserved).toBe(4); // 2 summaries + 2 Q&A rows
      expect(plan.blockedByPendingQueue).toBe(false);
    });

    it('reports counts for full → titles', async () => {
      await seedContent('a');
      const plan = await planTierTransition('titles');
      expect(plan.markdownRowsToDelete).toBe(1);
      expect(plan.qaRowsToDelete).toBe(1);
      expect(plan.summaryRowsToDelete).toBe(1);
      expect(plan.embeddingsPreserved).toBe(0);
    });

    it('same tier = no-op', async () => {
      const plan = await planTierTransition('full');
      expect(plan.from).toBe('full');
      expect(plan.to).toBe('full');
      expect(plan.markdownRowsToDelete).toBe(0);
    });
  });

  describe('enterTier', () => {
    beforeEach(() => {
      // Downgrades require a prior successful sync (see pre-sync safety gate).
      // The legitimate downgrade scenarios in this block assume the user has
      // already synced at least once.
      settingsStore.serverLastSyncTime = '2026-04-01T00:00:00.000Z';
    });

    it('summaries tier drops markdown + Q&A, preserves summaries', async () => {
      await seedContent('a');
      await seedContent('b');

      await enterTier('summaries');

      expect(await db.markdown.count()).toBe(0);
      expect(await db.questionsAnswers.count()).toBe(0);
      expect(await db.summaries.count()).toBe(2);
      expect(settingsStore.contentTier).toBe('summaries');
      expect(settingsStore.markdownCacheBytes).toBe(0);
    });

    it('titles tier also drops summaries', async () => {
      await seedContent('a');
      await enterTier('titles');

      expect(await db.markdown.count()).toBe(0);
      expect(await db.summaries.count()).toBe(0);
      expect(settingsStore.contentTier).toBe('titles');
    });

    it('no-op when target equals current', async () => {
      settingsStore.contentTier = 'summaries';
      await seedContent('a');
      await enterTier('summaries');
      // content not wiped again
      expect(await db.bookmarks.count()).toBe(1);
    });
  });

  describe('maybeEvictMarkdownLRU', () => {
    it('evicts oldest-accessed rows when cap exceeded', async () => {
      // ~500 KB each × 3 = 1.5 MB, cap 1 MB (minimum)
      const content = 'x'.repeat(250_000); // ~500 KB UTF-16
      settingsStore.markdownCacheCapMB = 1;
      settingsStore.markdownCacheBytes = 0;

      const bytesPer = estimateMarkdownBytes(content);
      const t0 = Date.now();
      for (let i = 0; i < 3; i++) {
        await db.markdown.add({
          id: `md-${i}`,
          bookmarkId: `b-${i}`,
          content,
          createdAt: new Date(t0),
          updatedAt: new Date(t0),
          lastAccessedAt: new Date(t0 + i * 1000),
          sizeBytes: bytesPer,
        });
      }
      settingsStore.markdownCacheBytes = bytesPer * 3;

      const result = await maybeEvictMarkdownLRU();
      expect(result.evicted).toBeGreaterThanOrEqual(1);
      // Oldest-accessed (md-0) should be the first to go
      const surviving = await db.markdown.toArray();
      expect(surviving.find(r => r.id === 'md-0')).toBeUndefined();
    });

    it('no eviction when under cap', async () => {
      settingsStore.markdownCacheCapMB = 50;
      settingsStore.markdownCacheBytes = 1000;
      const res = await maybeEvictMarkdownLRU();
      expect(res.evicted).toBe(0);
    });
  });

  describe('touchMarkdown debouncing', () => {
    // Each test uses a unique bookmarkId because the in-module debounce cache
    // is shared across tests (real-world: lifetime of a tab).
    function uniqueId(label: string): string {
      return `dbnc-${label}-${Math.random().toString(36).slice(2, 10)}`;
    }

    async function seedRow(bookmarkId: string, lastAccessedAt: Date): Promise<string> {
      const id = `${bookmarkId}-md`;
      await db.markdown.add({
        id,
        bookmarkId,
        content: 'sample content',
        createdAt: lastAccessedAt,
        updatedAt: lastAccessedAt,
        lastAccessedAt,
        sizeBytes: estimateMarkdownBytes('sample content'),
      });
      return id;
    }

    it('first touch updates lastAccessedAt; rapid follow-up is debounced', async () => {
      // We mock Date.now() directly (rather than vi.useFakeTimers, which
      // blocks Dexie's internal microtasks) because the debounce logic only
      // reads Date.now(); lastAccessedAt is built from that same ms value.
      const bookmarkId = uniqueId('rapid');
      const t0 = Date.parse('2026-04-14T09:00:00.000Z');
      const rowId = await seedRow(bookmarkId, new Date(t0));

      const nowSpy = vi.spyOn(Date, 'now');
      try {
        // First touch at t0 + 1s — must write.
        nowSpy.mockReturnValue(t0 + 1_000);
        await touchMarkdown(bookmarkId);
        const after1s = await db.markdown.get(rowId);
        expect(after1s?.lastAccessedAt?.getTime()).toBe(t0 + 1_000);

        // Within 30s window — debounced, no write.
        nowSpy.mockReturnValue(t0 + 6_000);
        await touchMarkdown(bookmarkId);
        const after6s = await db.markdown.get(rowId);
        expect(after6s?.lastAccessedAt?.getTime()).toBe(t0 + 1_000);

        // Past the 30s window — writes again.
        nowSpy.mockReturnValue(t0 + 45_000);
        await touchMarkdown(bookmarkId);
        const after45s = await db.markdown.get(rowId);
        expect(after45s?.lastAccessedAt?.getTime()).toBe(t0 + 45_000);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('touching a non-existent row is a safe no-op', async () => {
      // Defends the read path — getBookmarkContent fires touchMarkdown without
      // checking the row exists; a deleted bookmark must not throw.
      await expect(touchMarkdown(uniqueId('missing'))).resolves.toBeUndefined();
    });

    // ─── Reviewer finding #4: propagate unexpected errors ────────────────────
    it('FAILING: propagates unexpected Dexie errors instead of swallowing them', async () => {
      // The current implementation wraps the whole body in try/catch{} with a
      // comment "Index may not exist on older schema versions." After the v8
      // migration the index always exists, so catching every error hides
      // transaction aborts, concurrent-write failures, and quota errors.
      const bookmarkId = uniqueId('propagation');
      await db.markdown.add({
        id: `${bookmarkId}-md`, bookmarkId, content: 'hello',
        createdAt: new Date(), updatedAt: new Date(),
        lastAccessedAt: new Date(0), sizeBytes: 10,
      });
      // Force a clean state for the debounce map so the update path runs.
      const spy = vi.spyOn(db.markdown, 'update').mockRejectedValueOnce(
        new Error('QuotaExceededError: disk full'),
      );
      try {
        await expect(touchMarkdown(bookmarkId)).rejects.toThrow(/QuotaExceededError/);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ─── Reviewer finding #1 + #11: pre-sync safety gate ───────────────────────
  describe('pre-sync safety (blocks destructive tier downgrades)', () => {
    it('FAILING: planTierTransition reports requiresSuccessfulSync when user has never synced', async () => {
      // Downgrade is destructive. If the user has never successfully synced,
      // local bookmarks are the only copy — the current plan has no flag for
      // this, so the dashboard's dry-run message is factually wrong.
      settingsStore.contentTier = 'full';
      settingsStore.serverLastSyncTime = ''; // never synced
      await db.bookmarks.add({
        id: 'unsynced-1', url: 'https://example.com/unsynced',
        title: 'Local only', html: '<p>x</p>', status: 'complete',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const plan = await planTierTransition('summaries');
      // New field the fix must add:
      expect((plan as unknown as { requiresSuccessfulSync?: boolean }).requiresSuccessfulSync).toBe(true);
    });

    it('FAILING: enterTier refuses downgrade when user has never synced', async () => {
      settingsStore.contentTier = 'full';
      settingsStore.serverLastSyncTime = '';
      await db.bookmarks.add({
        id: 'unsynced-2', url: 'https://example.com/unsynced-2',
        title: 'Also local only', html: '<p>x</p>', status: 'complete',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await expect(enterTier('summaries')).rejects.toThrow(/sync/i);
    });

    it('FAILING: clearing the offline queue does not bypass the safety gate', async () => {
      // The reviewer's specific attack vector: user queues an offline edit,
      // then the dashboard's "Clear queue" button nukes it, which would let
      // a downgrade proceed under the old `blockedByPendingQueue` check alone.
      settingsStore.contentTier = 'full';
      settingsStore.serverLastSyncTime = ''; // still never synced
      await db.bookmarks.add({
        id: 'orphaned', url: 'https://example.com/orphan',
        title: 'About to be orphaned', html: '<p>x</p>', status: 'complete',
        createdAt: new Date(), updatedAt: new Date(),
      });

      // Offline queue is empty in this mock — exactly the post-clear state.
      const plan = await planTierTransition('summaries');
      expect(plan.blockedByPendingQueue).toBe(false);
      // But the plan MUST still flag the missing-sync state.
      expect((plan as unknown as { requiresSuccessfulSync?: boolean }).requiresSuccessfulSync).toBe(true);
    });
  });

  // ─── Reviewer finding #2: upgrade repopulation ────────────────────────────
  describe('tier upgrade repopulation', () => {
    beforeEach(() => {
      mockFullSync.mockClear();
    });

    it('FAILING: upgrading titles → full triggers a fullSync to repopulate', async () => {
      // Currently enterTier just flips the setting and emits tier:changed.
      // The content that was dropped on the previous downgrade never comes back.
      settingsStore.contentTier = 'titles';
      settingsStore.serverLastSyncTime = '2026-04-01T00:00:00.000Z';

      await enterTier('full');

      expect(mockFullSync).toHaveBeenCalledTimes(1);
    });

    it('FAILING: upgrading titles → summaries also triggers repopulation', async () => {
      settingsStore.contentTier = 'titles';
      settingsStore.serverLastSyncTime = '2026-04-01T00:00:00.000Z';

      await enterTier('summaries');

      expect(mockFullSync).toHaveBeenCalledTimes(1);
    });

    it('downgrading never calls fullSync', async () => {
      settingsStore.contentTier = 'full';
      settingsStore.serverLastSyncTime = '2026-04-01T00:00:00.000Z';
      await enterTier('summaries');
      expect(mockFullSync).not.toHaveBeenCalled();
    });
  });
});
