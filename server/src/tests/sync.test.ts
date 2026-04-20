import { assertEquals } from 'jsr:@std/assert';
import { createApp } from '../app.ts';
import { createMockDeps } from './helpers.ts';

function setupAuthenticatedMock(db: ReturnType<typeof createMockDeps>['db'], userId = 'test-user-id', sessionId = 'test-session-id') {
  db.setQueryHandler('SELECT s.id, s.user_id, s.expires_at', () => ({
    id: sessionId,
    user_id: userId,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  }));
  return { userId, sessionId };
}

Deno.test('GET /api/v1/sync/changes - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/changes');

  assertEquals(res.status, 401);
});

Deno.test('GET /api/v1/sync/changes - returns empty changes for new user', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id, entity_type, entity_id, operation, timestamp', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/changes', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.changes.length, 0);
  assertEquals(typeof body.syncTimestamp, 'string');
});

Deno.test('GET /api/v1/sync/changes - returns changes since timestamp', async () => {
  const { deps, db } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  const mockBookmark = {
    id: 'bookmark-1',
    user_id: userId,
    url: 'https://example.com',
    title: 'Example',
    html: '<html></html>',
    markdown: null,
    status: 'complete',
    error_message: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
    deleted_at: null,
  };

  db.setQueryHandler('SELECT id, entity_type, entity_id, operation, timestamp', () => [
    { id: 1, entity_type: 'bookmark', entity_id: 'bookmark-1', operation: 'create', timestamp: '2024-01-01T00:00:00.000Z' },
  ]);
  db.setQueryHandler('SELECT * FROM bookmarks WHERE id IN', () => [mockBookmark]);
  db.setQueryHandler('SELECT bookmark_id, tag_name FROM bookmark_tags', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/changes?since=2023-12-31T00:00:00.000Z', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.changes.length, 1);
  assertEquals(body.changes[0].type, 'created');
  assertEquals(body.changes[0].bookmark.id, 'bookmark-1');
});

Deno.test('GET /api/v1/sync/changes - includes deleted bookmarks', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id, entity_type, entity_id, operation, timestamp', () => [
    { id: 1, entity_type: 'bookmark', entity_id: 'deleted-bookmark', operation: 'delete', timestamp: '2024-01-01T00:00:00.000Z' },
  ]);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/changes', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.changes.length, 1);
  assertEquals(body.changes[0].type, 'deleted');
  assertEquals(body.changes[0].bookmarkId, 'deleted-bookmark');
});

Deno.test('GET /api/v1/sync/full - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full');

  assertEquals(res.status, 401);
});

Deno.test('GET /api/v1/sync/full - returns all bookmarks', async () => {
  const { deps, db } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  const mockBookmarks = [
    {
      id: 'bookmark-1',
      user_id: userId,
      url: 'https://example1.com',
      title: 'Example 1',
      html: '<html></html>',
      markdown: null,
      status: 'complete',
      error_message: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      deleted_at: null,
    },
    {
      id: 'bookmark-2',
      user_id: userId,
      url: 'https://example2.com',
      title: 'Example 2',
      html: '<html></html>',
      markdown: null,
      status: 'complete',
      error_message: null,
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      deleted_at: null,
    },
  ];

  db.setQueryHandler('SELECT COUNT(*) as count FROM bookmarks', () => ({ count: 2 }));
  db.setQueryHandler('SELECT * FROM bookmarks', () => mockBookmarks);
  db.setQueryHandler('SELECT bookmark_id, tag_name FROM bookmark_tags', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.bookmarks.length, 2);
  assertEquals(body.total, 2);
  assertEquals(body.hasMore, false);
  assertEquals(typeof body.syncTimestamp, 'string');
});

Deno.test('GET /api/v1/sync/full - supports pagination', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT COUNT(*) as count FROM bookmarks', () => ({ count: 100 }));
  db.setQueryHandler('SELECT * FROM bookmarks', () => []);
  db.setQueryHandler('SELECT bookmark_id, tag_name FROM bookmark_tags', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full?limit=10&offset=0', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.total, 100);
  assertEquals(body.hasMore, true);
});

Deno.test('POST /api/v1/sync/full - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarks: [] }),
  });

  assertEquals(res.status, 401);
});

Deno.test('POST /api/v1/sync/full - requires bookmarks array', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({}),
  });

  assertEquals(res.status, 400);

  const body = await res.json();
  assertEquals(body.error, 'bookmarks array is required');
});

Deno.test('POST /api/v1/sync/full - validates bookmark format', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({
      bookmarks: [
        { id: 'test', title: 'Missing URL' },
      ],
    }),
  });

  assertEquals(res.status, 400);

  const body = await res.json();
  assertEquals(body.error.includes('Invalid bookmarks'), true);
});

Deno.test('POST /api/v1/sync/full - creates new bookmarks', async () => {
  const { deps, db, queue } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id, url, updated_at, html, status FROM bookmarks WHERE user_id', () => []);
  db.setQueryHandler('INSERT INTO bookmarks', () => null);
  db.setQueryHandler('INSERT INTO bookmark_tags', () => null);
  db.setQueryHandler('INSERT INTO sync_log', () => null);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({
      bookmarks: [
        {
          id: 'new-bookmark-1',
          url: 'https://example.com',
          title: 'New Bookmark',
          html: '<html></html>',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: ['test'],
        },
      ],
    }),
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.created, 1);
  assertEquals(body.updated, 0);
  assertEquals(body.conflicts.length, 0);
  assertEquals(typeof body.syncToken, 'string');

  assertEquals(queue.sentMessages.length, 1);
});

Deno.test('POST /api/v1/sync/full - handles URL conflicts', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id, url, updated_at, html, status FROM bookmarks WHERE user_id', () => [
    { id: 'server-bookmark', url: 'https://example.com', updated_at: '2024-01-02T00:00:00.000Z', html: '', status: 'pending' },
  ]);

  const app = createApp(deps);
  const res = await app.request('/api/v1/sync/full', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({
      bookmarks: [
        {
          id: 'client-bookmark',
          url: 'https://example.com',
          title: 'Client Version',
          html: '<html></html>',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: [],
        },
      ],
    }),
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.conflicts.length, 1);
  assertEquals(body.conflicts[0].resolution, 'server');
  assertEquals(body.conflicts[0].localId, 'client-bookmark');
  assertEquals(body.conflicts[0].serverId, 'server-bookmark');
});
