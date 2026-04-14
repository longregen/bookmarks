import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import { BookmarkDatabase } from '../src/db/schema';

const TEST_DB_NAME = 'BookmarkRAG-MigrationTestV8';

// Realistic prose: the mean web article extracted to markdown is ~25–50 KB.
// We mix sizes so the byte-length backfill is exercised across realistic ranges.
const SHORT_MD = '# Note\n\nA quick capture: a single-line bookmark with no body.';
const MEDIUM_MD = `# How service workers really die\n\n${'Service worker lifecycles are non-obvious. '.repeat(80)}\n\n## Symptoms\n\n${'Disconnect events fire intermittently. '.repeat(40)}`;
const LARGE_MD = `# A long-form essay on caching\n\n${'Caches are the fastest databases nobody admits to running. '.repeat(800)}\n\n## A footnote\n\n${'This footnote could span pages. '.repeat(120)}`;

interface V7MarkdownRow {
  id: string;
  bookmarkId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  // No lastAccessedAt or sizeBytes — that's the whole point.
}

/**
 * Mirror of the pre-v8 schema definition. Used to populate a DB at v7 only,
 * then close it; the production class re-opens at v8 and runs the upgrade.
 */
class LegacyV7Database extends Dexie {
  bookmarks!: Dexie.Table<{ id: string; url: string; title: string; html: string; status: string; createdAt: Date; updatedAt: Date }>;
  markdown!: Dexie.Table<V7MarkdownRow>;
  settings!: Dexie.Table<{ key: string; value: unknown; createdAt: Date; updatedAt: Date }>;

  constructor(name: string) {
    super(name);
    // Mirror v7 store definitions verbatim — the upgrade path is what's under test.
    this.version(1).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
    });
    this.version(2).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, bookmarkId, parentJobId, status, type, createdAt, updatedAt, [parentJobId+status], [bookmarkId+type]',
    });
    this.version(3).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, bookmarkId, parentJobId, status, type, createdAt, updatedAt, [parentJobId+status], [bookmarkId+type]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });
    this.version(4).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });
    this.version(5).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });
    this.version(6).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt, [status+updatedAt]',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });
    this.version(7).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt, [status+updatedAt]',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      summaries: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });
  }
}

describe('Schema v7 → v8 migration', () => {
  beforeEach(async () => {
    await Dexie.delete(TEST_DB_NAME).catch(() => { /* ignore */ });
  });

  afterEach(async () => {
    await Dexie.delete(TEST_DB_NAME).catch(() => { /* ignore */ });
  });

  it('backfills lastAccessedAt and sizeBytes on existing markdown rows', async () => {
    // ─── Phase 1: simulate an existing user on v7 with realistic content ───
    const legacy = new LegacyV7Database(TEST_DB_NAME);
    await legacy.open();
    expect(legacy.verno).toBe(7);

    const updatedShort = new Date('2024-03-01T08:30:00.000Z');
    const updatedMedium = new Date('2024-06-12T14:15:00.000Z');
    const updatedLarge = new Date('2025-01-04T22:42:00.000Z');

    await legacy.bookmarks.bulkAdd([
      { id: 'bm-short',  url: 'https://example.com/note',          title: 'Quick note',           html: '<p>x</p>', status: 'complete', createdAt: updatedShort,  updatedAt: updatedShort  },
      { id: 'bm-medium', url: 'https://example.com/sw-deaths',     title: 'How service workers really die', html: '<p>x</p>', status: 'complete', createdAt: updatedMedium, updatedAt: updatedMedium },
      { id: 'bm-large',  url: 'https://example.com/caching-essay', title: 'A long-form essay on caching',   html: '<p>x</p>', status: 'complete', createdAt: updatedLarge,  updatedAt: updatedLarge  },
    ]);

    await legacy.markdown.bulkAdd([
      { id: 'bm-short-md',  bookmarkId: 'bm-short',  content: SHORT_MD,  createdAt: updatedShort,  updatedAt: updatedShort  },
      { id: 'bm-medium-md', bookmarkId: 'bm-medium', content: MEDIUM_MD, createdAt: updatedMedium, updatedAt: updatedMedium },
      { id: 'bm-large-md',  bookmarkId: 'bm-large',  content: LARGE_MD,  createdAt: updatedLarge,  updatedAt: updatedLarge  },
    ]);

    // Sanity: legacy rows lack the new fields entirely.
    const legacyRows = await legacy.markdown.toArray();
    expect(legacyRows).toHaveLength(3);
    for (const row of legacyRows) {
      expect((row as { lastAccessedAt?: Date }).lastAccessedAt).toBeUndefined();
      expect((row as { sizeBytes?: number }).sizeBytes).toBeUndefined();
    }
    legacy.close();

    // ─── Phase 2: open the SAME DB with the production v8 schema ───
    const upgraded = new BookmarkDatabase(TEST_DB_NAME);
    await upgraded.open();
    expect(upgraded.verno).toBe(8);

    // ─── Phase 3: verify the upgrade callback ran correctly ───
    const upgradedRows = await upgraded.markdown.orderBy('bookmarkId').toArray();
    expect(upgradedRows).toHaveLength(3);

    const byId = new Map(upgradedRows.map(r => [r.bookmarkId, r]));

    const short = byId.get('bm-short');
    expect(short?.lastAccessedAt?.getTime()).toBe(updatedShort.getTime());
    expect(short?.sizeBytes).toBe(SHORT_MD.length * 2);

    const medium = byId.get('bm-medium');
    expect(medium?.lastAccessedAt?.getTime()).toBe(updatedMedium.getTime());
    expect(medium?.sizeBytes).toBe(MEDIUM_MD.length * 2);

    const large = byId.get('bm-large');
    expect(large?.lastAccessedAt?.getTime()).toBe(updatedLarge.getTime());
    expect(large?.sizeBytes).toBe(LARGE_MD.length * 2);

    // The original content must remain byte-identical — the migration must not corrupt data.
    expect(short?.content).toBe(SHORT_MD);
    expect(medium?.content).toBe(MEDIUM_MD);
    expect(large?.content).toBe(LARGE_MD);

    // The new lastAccessedAt index must work for the LRU eviction code.
    const oldestFirst = await upgraded.markdown.orderBy('lastAccessedAt').toArray();
    expect(oldestFirst.map(r => r.bookmarkId)).toEqual(['bm-short', 'bm-medium', 'bm-large']);

    upgraded.close();
  });

  it('is idempotent: opening an already-migrated DB does not duplicate work', async () => {
    // First open performs migration.
    const first = new BookmarkDatabase(TEST_DB_NAME);
    await first.open();
    const fixed = new Date('2024-08-15T10:00:00.000Z');
    await first.bookmarks.add({
      id: 'bm-1', url: 'https://example.com/p',
      title: 'Idempotency check', html: '<p>x</p>',
      status: 'complete', createdAt: fixed, updatedAt: fixed,
    });
    await first.markdown.add({
      id: 'bm-1-md', bookmarkId: 'bm-1', content: MEDIUM_MD,
      createdAt: fixed, updatedAt: fixed,
      lastAccessedAt: fixed, sizeBytes: MEDIUM_MD.length * 2,
    });
    first.close();

    // Reopen — upgrade should be a no-op for already-correct rows.
    const second = new BookmarkDatabase(TEST_DB_NAME);
    await second.open();
    const row = await second.markdown.get('bm-1-md');
    expect(row?.lastAccessedAt?.getTime()).toBe(fixed.getTime());
    expect(row?.sizeBytes).toBe(MEDIUM_MD.length * 2);
    second.close();
  });

  // ─── Reviewer finding #5: malformed pre-v8 row ───────────────────────────
  it('FAILING: coerces a string updatedAt into a Date on backfill', async () => {
    // v1-era JSON-import paths occasionally stored Date fields as ISO strings
    // after a round-trip. The v8 upgrade currently copies updatedAt through
    // unchanged (`md.lastAccessedAt ??= md.updatedAt`), so the new index ends
    // up with a mix of strings and Dates and orderBy('lastAccessedAt') falls
    // over on real users.
    const legacy = new LegacyV7Database(TEST_DB_NAME);
    await legacy.open();
    await legacy.table('markdown').add({
      id: 'bm-malformed-md',
      bookmarkId: 'bm-malformed',
      content: 'short content',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      // Intentionally wrong: string instead of Date
      updatedAt: '2024-06-01T00:00:00.000Z' as unknown as Date,
    } as unknown as Record<string, unknown>);
    legacy.close();

    const upgraded = new BookmarkDatabase(TEST_DB_NAME);
    await upgraded.open();

    const row = await upgraded.markdown.get('bm-malformed-md');
    expect(row?.lastAccessedAt).toBeInstanceOf(Date);
    expect(row?.sizeBytes).toBe('short content'.length * 2);

    // The index must be populated with a real Date so orderBy works.
    const sorted = await upgraded.markdown.orderBy('lastAccessedAt').toArray();
    expect(sorted).toHaveLength(1);

    upgraded.close();
  });

  it('handles a partially-migrated row (only one new field present)', async () => {
    // Edge case: a row that already has lastAccessedAt but is missing sizeBytes,
    // or vice versa. The upgrade callback's nullish/typeof guards must handle either.
    const legacy = new LegacyV7Database(TEST_DB_NAME);
    await legacy.open();
    const updatedAt = new Date('2024-05-01T00:00:00.000Z');

    // Bypass the typed table to slip in mixed-shape rows.
    await legacy.table('markdown').bulkAdd([
      // sizeBytes already set, lastAccessedAt missing
      { id: 'bm-a-md', bookmarkId: 'bm-a', content: SHORT_MD,  createdAt: updatedAt, updatedAt, sizeBytes: 999 },
      // lastAccessedAt already set, sizeBytes missing
      { id: 'bm-b-md', bookmarkId: 'bm-b', content: MEDIUM_MD, createdAt: updatedAt, updatedAt, lastAccessedAt: new Date('2025-01-01T00:00:00.000Z') },
    ] as unknown[]);
    legacy.close();

    const upgraded = new BookmarkDatabase(TEST_DB_NAME);
    await upgraded.open();

    const a = await upgraded.markdown.get('bm-a-md');
    const b = await upgraded.markdown.get('bm-b-md');

    // Pre-existing sizeBytes must NOT be overwritten.
    expect(a?.sizeBytes).toBe(999);
    expect(a?.lastAccessedAt?.getTime()).toBe(updatedAt.getTime());

    // Pre-existing lastAccessedAt must NOT be overwritten.
    expect(b?.lastAccessedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(b?.sizeBytes).toBe(MEDIUM_MD.length * 2);

    upgraded.close();
  });
});
