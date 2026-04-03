import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import type { ServerBookmark, FullSyncUploadRequest } from '../src/lib/server-api';

// In-memory server that simulates the real sync server behavior.
// Both fullSync and uploadAllBookmarks interact with this.
class FakeServer {
  bookmarks = new Map<string, ServerBookmark & { userId: string }>();
  private clock = 0;

  private now(): string {
    this.clock++;
    return `2024-01-01T00:00:${String(this.clock).padStart(2, '0')}.000Z`;
  }

  uploadFullSync(bookmarks: FullSyncUploadRequest['bookmarks']) {
    const timestamp = this.now();
    let created = 0;
    let updated = 0;

    // Match by URL (like the real server)
    const existingByUrl = new Map<string, ServerBookmark & { userId: string }>();
    for (const b of this.bookmarks.values()) {
      existingByUrl.set(b.url, b);
    }

    for (const clientBookmark of bookmarks) {
      const existing = existingByUrl.get(clientBookmark.url);
      if (existing) {
        const serverTime = new Date(existing.updatedAt).getTime();
        const clientTime = new Date(clientBookmark.updatedAt).getTime();
        if (clientTime >= serverTime) {
          existing.title = clientBookmark.title;
          existing.html = clientBookmark.html;
          existing.updatedAt = timestamp;
          existing.tags = clientBookmark.tags;
          updated++;
        }
      } else {
        const id = clientBookmark.id || crypto.randomUUID();
        this.bookmarks.set(id, {
          id,
          userId: 'user-1',
          url: clientBookmark.url,
          title: clientBookmark.title,
          html: clientBookmark.html,
          markdown: clientBookmark.markdown ?? null,
          status: 'pending',
          errorMessage: null,
          createdAt: clientBookmark.createdAt || timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          tags: clientBookmark.tags,
        });
        created++;
      }
    }

    return { created, updated, conflicts: [], syncToken: timestamp };
  }

  downloadFullSync() {
    const bookmarks = [...this.bookmarks.values()].map(({ userId: _, ...b }) => b as ServerBookmark);
    return {
      bookmarks,
      hasMore: false,
      total: bookmarks.length,
      syncTimestamp: this.now(),
    };
  }

  getChanges(since: string) {
    const sinceTime = new Date(since).getTime();
    const changes = [...this.bookmarks.values()]
      .filter(b => new Date(b.updatedAt).getTime() > sinceTime)
      .map(({ userId: _, ...b }) => ({
        type: 'created' as const,
        bookmark: b as ServerBookmark,
      }));
    return { changes, syncTimestamp: this.now() };
  }
}

let fakeServer: FakeServer;

const mockSaveSetting = vi.fn();
const settingsStore: Record<string, unknown> = {
  serverEnabled: true,
  serverUrl: 'https://server.test',
  serverSessionToken: 'tok',
  serverLastSyncTime: '',
};

const mockGetSettings = vi.fn().mockImplementation(() => Promise.resolve({ ...settingsStore }));

vi.mock('../src/lib/settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  saveSetting: (key: string, value: unknown) => {
    settingsStore[key] = value;
    return mockSaveSetting(key, value);
  },
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

vi.mock('../src/lib/server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/server-api')>();
  return {
    ...actual,
    ServerApiClient: {
      fromSettings: () => ({
        uploadFullSync: (req: FullSyncUploadRequest) => Promise.resolve(fakeServer.uploadFullSync(req.bookmarks)),
        downloadFullSync: () => Promise.resolve(fakeServer.downloadFullSync()),
        getChanges: (since: string) => Promise.resolve(fakeServer.getChanges(since)),
      }),
    },
    ServerApiError: actual.ServerApiError,
  };
});

import { ServerSyncManager } from '../src/lib/server-sync';

async function clearAllTables(): Promise<void> {
  await db.bookmarks.clear();
  await db.markdown.clear();
  await db.questionsAnswers.clear();
  await db.summaries.clear();
  await db.bookmarkTags.clear();
}

async function addLocalBookmarks(count: number, prefix: string) {
  for (let i = 0; i < count; i++) {
    await db.bookmarks.add({
      id: `${prefix}-${i}`,
      url: `https://${prefix}-${i}.example.com`,
      title: `${prefix} bookmark ${i}`,
      html: `<html>${prefix} ${i}</html>`,
      status: 'complete',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });
  }
}

describe('Multi-client sync integration', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();
    fakeServer = new FakeServer();
    settingsStore.serverLastSyncTime = '';
    settingsStore.serverLastSyncError = '';
  });

  afterEach(async () => {
    await clearAllTables();
  });

  it('fullSync should upload local bookmarks to server before downloading', async () => {
    // Client A has 5 local bookmarks, server is empty
    await addLocalBookmarks(5, 'clientA');

    const syncManager = new ServerSyncManager();
    const result = await syncManager.fullSync();

    expect(result.success).toBe(true);

    // Server should now have all 5 bookmarks
    expect(fakeServer.bookmarks.size).toBe(5);

    // Local DB should still have all 5
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);
  });

  it('fullSync should merge server bookmarks with local ones', async () => {
    // Simulate: server already has 3 bookmarks from another client
    fakeServer.uploadFullSync([
      { id: 'server-1', url: 'https://server-1.com', title: 'Server 1', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'server-2', url: 'https://server-2.com', title: 'Server 2', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'server-3', url: 'https://server-3.com', title: 'Server 3', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    ]);

    // Client has 2 local bookmarks
    await addLocalBookmarks(2, 'local');

    const syncManager = new ServerSyncManager();
    await syncManager.fullSync();

    // Local DB should have all 5 (3 from server + 2 local)
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);

    // Server should also have all 5
    expect(fakeServer.bookmarks.size).toBe(5);
  });

  it('two clients should converge to the same bookmark set', async () => {
    // Simulate two clients connecting to the same server sequentially
    // Client A: 3 bookmarks
    await addLocalBookmarks(3, 'clientA');

    const clientA = new ServerSyncManager();
    await clientA.fullSync();

    // Verify server has client A's bookmarks
    expect(fakeServer.bookmarks.size).toBe(3);

    // Clear local DB to simulate switching to Client B
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    // Client B: 2 bookmarks (completely different URLs)
    await addLocalBookmarks(2, 'clientB');

    const clientB = new ServerSyncManager();
    await clientB.fullSync();

    // Server should have all 5 bookmarks (3 from A + 2 from B)
    expect(fakeServer.bookmarks.size).toBe(5);

    // Client B's local DB should have all 5
    const clientBBookmarks = await db.bookmarks.toArray();
    expect(clientBBookmarks.length).toBe(5);

    // Now simulate Client A doing a sync again
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    // Re-populate client A's bookmarks (simulating its local state)
    await addLocalBookmarks(3, 'clientA');

    const clientAAgain = new ServerSyncManager();
    await clientAAgain.fullSync();

    // Client A should now also have all 5
    const clientABookmarks = await db.bookmarks.toArray();
    expect(clientABookmarks.length).toBe(5);
  });

  it('uploadAllBookmarks should pull server data after uploading', async () => {
    // Server already has 3 bookmarks from another client
    fakeServer.uploadFullSync([
      { id: 'other-1', url: 'https://other-1.com', title: 'Other 1', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'other-2', url: 'https://other-2.com', title: 'Other 2', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'other-3', url: 'https://other-3.com', title: 'Other 3', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    ]);

    // This client has 2 local bookmarks
    await addLocalBookmarks(2, 'mine');

    const syncManager = new ServerSyncManager();
    const result = await syncManager.uploadAllBookmarks();
    expect(result.success).toBe(true);

    // After upload, local DB should have all 5 (pulled other client's data)
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);
  });

  it('incremental sync should pick up changes from other clients after uploadAllBookmarks', async () => {
    // Client A uploads 3 bookmarks
    await addLocalBookmarks(3, 'clientA');
    const clientA = new ServerSyncManager();
    await clientA.uploadAllBookmarks();

    // Clear and switch to client B
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    // Client B uploads 2 bookmarks via fullSync
    await addLocalBookmarks(2, 'clientB');
    const clientB = new ServerSyncManager();
    await clientB.fullSync();

    // Client B should have all 5
    expect((await db.bookmarks.toArray()).length).toBe(5);

    // Now Client B does an incremental sync — should get no new changes
    const incrementalResult = await clientB.incrementalSync();
    expect(incrementalResult.success).toBe(true);

    // Still 5
    const finalCount = await db.bookmarks.count();
    expect(finalCount).toBe(5);
  });

  it('fullSync should not lose local bookmarks when server is empty', async () => {
    // This was the original bug: fullSync on empty server would wipe local data
    await addLocalBookmarks(5, 'local');

    const syncManager = new ServerSyncManager();
    await syncManager.fullSync();

    // Local bookmarks should still exist (uploaded to server, then downloaded back)
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);

    // Server should have them too
    expect(fakeServer.bookmarks.size).toBe(5);
  });

  it('should handle duplicate URLs between clients by merging', async () => {
    // Both clients saved the same URL
    await db.bookmarks.add({
      id: 'clientA-shared',
      url: 'https://shared.com',
      title: 'Saved on A',
      html: '<html>A</html>',
      status: 'complete',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });
    await addLocalBookmarks(2, 'clientA');

    const clientA = new ServerSyncManager();
    await clientA.fullSync();

    // Server has 3 bookmarks
    expect(fakeServer.bookmarks.size).toBe(3);

    // Switch to client B
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    await db.bookmarks.add({
      id: 'clientB-shared',
      url: 'https://shared.com',
      title: 'Saved on B',
      html: '<html>B</html>',
      status: 'complete',
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
    });
    await addLocalBookmarks(1, 'clientB');

    const clientB = new ServerSyncManager();
    await clientB.fullSync();

    // Should have 4 unique URLs total (shared.com + 2 from A + 1 from B)
    const localBookmarks = await db.bookmarks.toArray();
    const uniqueUrls = new Set(localBookmarks.map(b => b.url));
    expect(uniqueUrls.size).toBe(4);
  });

  it('should preserve local processed content during fullSync merge', async () => {
    // Client A has a fully processed bookmark with markdown
    await db.bookmarks.add({
      id: 'local-processed',
      url: 'https://processed.com',
      title: 'Processed',
      html: '<html>full content</html>',
      status: 'complete',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });
    await db.markdown.add({
      id: 'md-1',
      bookmarkId: 'local-processed',
      content: 'Important markdown content',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const syncManager = new ServerSyncManager();
    await syncManager.fullSync();

    // Markdown should still exist (possibly re-keyed to server ID)
    const allMarkdown = await db.markdown.toArray();
    expect(allMarkdown.length).toBe(1);
    expect(allMarkdown[0].content).toBe('Important markdown content');
  });
});
