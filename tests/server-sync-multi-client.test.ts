import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { db } from '../src/db/schema';
import type { FullSyncUploadRequest } from '../src/lib/server-api';
import type { Database, PreparedStatement, BindValue } from '../server/src/adapters/database/interface.ts';
import type { Queue, QueueMessage } from '../server/src/adapters/queue/interface.ts';
import type { Env } from '../server/src/adapters/env/interface.ts';
import type { AppDependencies } from '../server/src/app.ts';
import { createApp } from '../server/src/app.ts';

import schemaSQL from '../server/src/db/schema.sql?raw';

// Implement the Database interface using better-sqlite3 (synchronous API wrapped as async)
class NodeSqliteDatabase implements Database {
  constructor(private sqlite: BetterSqlite3.Database) {}

  prepare<T extends object = Record<string, unknown>>(sql: string): PreparedStatement<T> {
    const sqlite = this.sqlite;
    let boundParams: BindValue[] = [];

    const stmt: PreparedStatement<T> = {
      bind(...params: BindValue[]): PreparedStatement<T> {
        boundParams = params;
        return stmt;
      },
      async first(): Promise<T | null> {
        const prepared = sqlite.prepare(sql);
        const row = prepared.get(...boundParams.map(normalizeParam)) as T | undefined;
        return row ?? null;
      },
      async all(): Promise<T[]> {
        const prepared = sqlite.prepare(sql);
        return prepared.all(...boundParams.map(normalizeParam)) as T[];
      },
      async run(): Promise<{ changes: number }> {
        const prepared = sqlite.prepare(sql);
        const info = prepared.run(...boundParams.map(normalizeParam));
        return { changes: info.changes };
      },
    };
    return stmt;
  }

  async exec(sql: string): Promise<void> {
    this.sqlite.exec(sql);
  }

  async batch(statements: PreparedStatement[]): Promise<void> {
    for (const stmt of statements) {
      await stmt.run();
    }
  }
}

function normalizeParam(v: BindValue): unknown {
  if (v === null) return null;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

class NoopQueue implements Queue {
  async send(_message: QueueMessage): Promise<void> {}
  async sendBatch(_messages: QueueMessage[]): Promise<void> {}
}

class StaticEnv implements Env {
  get(_key: string): string | undefined { return undefined; }
  getRequired(key: string): string { throw new Error(`Missing env: ${key}`); }
}

// Create a real Hono server backed by in-memory SQLite
function createTestServer() {
  const sqlite = new BetterSqlite3(':memory:');
  sqlite.exec(schemaSQL);

  const database = new NodeSqliteDatabase(sqlite);
  const deps: AppDependencies = { db: database, queue: new NoopQueue(), env: new StaticEnv() };
  const app = createApp(deps);

  // Seed a user and session for auth
  const userId = 'test-user-id';
  const sessionId = 'test-session-token';
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const now = new Date().toISOString();
  sqlite.exec(`INSERT INTO users (id, token_hash, created_at) VALUES ('${userId}', 'hash', '${now}')`);
  sqlite.exec(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('${sessionId}', '${userId}', '${expiresAt}', '${now}')`);

  return { app, sqlite, sessionId };
}

// Create a mock ServerApiClient that routes through the Hono app instead of fetch()
function createClientForApp(app: ReturnType<typeof createApp>, sessionId: string) {
  const headers = {
    'Authorization': `Bearer ${sessionId}`,
    'Content-Type': 'application/json',
  };

  return {
    async uploadFullSync(request: FullSyncUploadRequest) {
      const res = await app.request('/api/v1/sync/full', {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async downloadFullSync(params: { offset?: number; limit?: number } = {}) {
      const url = new URL('http://localhost/api/v1/sync/full');
      if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
      if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
      const res = await app.request(url.pathname + url.search, { headers });
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async getChanges(since?: string) {
      const url = new URL('http://localhost/api/v1/sync/changes');
      if (since) url.searchParams.set('since', since);
      const res = await app.request(url.pathname + url.search, { headers });
      if (!res.ok) throw new Error(`Changes failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}

// Mock settings and deps for the client-side ServerSyncManager
const mockSaveSetting = vi.fn();
const settingsStore: Record<string, unknown> = {
  serverEnabled: true,
  serverUrl: 'https://server.test',
  serverSessionToken: 'test-session-token',
  serverLastSyncTime: '',
};

vi.mock('../src/lib/settings', () => ({
  getSettings: () => Promise.resolve({ ...settingsStore }),
  saveSetting: (key: string, value: unknown) => {
    settingsStore[key] = value;
    return mockSaveSetting(key, value);
  },
}));

vi.mock('../src/lib/events', () => ({
  events: { sync: { started: vi.fn(), completed: vi.fn(), failed: vi.fn() } },
}));

vi.mock('../src/lib/jobs', () => ({
  createJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
}));

// This will be set per test to point at the real Hono app
let mockClient: ReturnType<typeof createClientForApp>;

vi.mock('../src/lib/server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/server-api')>();
  return {
    ...actual,
    ServerApiClient: {
      fromSettings: () => mockClient,
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

describe('Multi-client sync with real server', () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();
    server = createTestServer();
    mockClient = createClientForApp(server.app, server.sessionId);
    settingsStore.serverLastSyncTime = '';
    settingsStore.serverLastSyncError = '';
  });

  afterEach(async () => {
    await clearAllTables();
  });

  it('fullSync should upload local bookmarks to server before downloading', async () => {
    await addLocalBookmarks(5, 'clientA');

    const syncManager = new ServerSyncManager();
    const result = await syncManager.fullSync();

    expect(result.success).toBe(true);

    // Server should have all 5 bookmarks
    const serverRows = server.sqlite.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number };
    expect(serverRows.cnt).toBe(5);

    // Local DB should still have all 5
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);
  });

  it('fullSync should merge server bookmarks with local ones', async () => {
    // Pre-populate server with 3 bookmarks from "another client"
    const otherClient = createClientForApp(server.app, server.sessionId);
    await otherClient.uploadFullSync({
      bookmarks: [
        { id: 'srv-1', url: 'https://server-1.com', title: 'Server 1', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'srv-2', url: 'https://server-2.com', title: 'Server 2', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'srv-3', url: 'https://server-3.com', title: 'Server 3', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ],
    });

    // This client has 2 local bookmarks
    await addLocalBookmarks(2, 'local');

    const syncManager = new ServerSyncManager();
    await syncManager.fullSync();

    // Local DB should have all 5 (3 from server + 2 local)
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);

    // Server should also have all 5
    const serverRows = server.sqlite.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number };
    expect(serverRows.cnt).toBe(5);
  });

  it('two clients should converge to the same bookmark set', async () => {
    // Client A: 3 bookmarks
    await addLocalBookmarks(3, 'clientA');
    const clientA = new ServerSyncManager();
    await clientA.fullSync();

    const serverAfterA = server.sqlite.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number };
    expect(serverAfterA.cnt).toBe(3);

    // Switch to Client B: clear local DB, reset sync cursor
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    await addLocalBookmarks(2, 'clientB');
    const clientB = new ServerSyncManager();
    await clientB.fullSync();

    // Server should have all 5
    const serverAfterB = server.sqlite.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number };
    expect(serverAfterB.cnt).toBe(5);

    // Client B local should have all 5
    expect((await db.bookmarks.toArray()).length).toBe(5);

    // Switch back to Client A
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';
    await addLocalBookmarks(3, 'clientA');

    const clientAAgain = new ServerSyncManager();
    await clientAAgain.fullSync();

    // Client A should now also have all 5
    expect((await db.bookmarks.toArray()).length).toBe(5);
  });

  it('uploadAllBookmarks should pull server data after uploading', async () => {
    // Server has 3 bookmarks from another client
    const otherClient = createClientForApp(server.app, server.sessionId);
    await otherClient.uploadFullSync({
      bookmarks: [
        { id: 'other-1', url: 'https://other-1.com', title: 'Other 1', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'other-2', url: 'https://other-2.com', title: 'Other 2', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'other-3', url: 'https://other-3.com', title: 'Other 3', html: '', tags: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ],
    });

    // This client has 2 local bookmarks
    await addLocalBookmarks(2, 'mine');

    const syncManager = new ServerSyncManager();
    const result = await syncManager.uploadAllBookmarks();
    expect(result.success).toBe(true);

    // After upload, local DB should have all 5
    const localBookmarks = await db.bookmarks.toArray();
    expect(localBookmarks.length).toBe(5);
  });

  it('incremental sync should pick up changes after fullSync', async () => {
    // Client A uploads 3 bookmarks
    await addLocalBookmarks(3, 'clientA');
    const clientA = new ServerSyncManager();
    await clientA.fullSync();

    // Switch to client B
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    await addLocalBookmarks(2, 'clientB');
    const clientB = new ServerSyncManager();
    await clientB.fullSync();

    // Client B should have all 5
    expect((await db.bookmarks.toArray()).length).toBe(5);

    // Incremental sync should return no new changes
    const incrementalResult = await clientB.incrementalSync();
    expect(incrementalResult.success).toBe(true);
    expect((await db.bookmarks.count())).toBe(5);
  });

  it('fullSync should not lose local bookmarks when server is empty', async () => {
    await addLocalBookmarks(5, 'local');

    const syncManager = new ServerSyncManager();
    await syncManager.fullSync();

    // Local bookmarks should still exist
    expect((await db.bookmarks.toArray()).length).toBe(5);

    // Server should have them
    const serverRows = server.sqlite.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number };
    expect(serverRows.cnt).toBe(5);
  });

  it('should handle duplicate URLs between clients', async () => {
    // Client A saves a URL
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

    // Switch to client B
    await clearAllTables();
    settingsStore.serverLastSyncTime = '';

    // Client B also saved the same URL
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

    // Should have 4 unique URLs (shared.com + 2 from A + 1 from B)
    const localBookmarks = await db.bookmarks.toArray();
    const uniqueUrls = new Set(localBookmarks.map(b => b.url));
    expect(uniqueUrls.size).toBe(4);
  });

  it('should preserve local markdown during fullSync merge', async () => {
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

    const allMarkdown = await db.markdown.toArray();
    expect(allMarkdown.length).toBe(1);
    expect(allMarkdown[0].content).toBe('Important markdown content');
  });
});
