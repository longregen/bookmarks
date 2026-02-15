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

Deno.test('POST /api/v1/bookmarks - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com', title: 'Example' }),
  });

  assertEquals(res.status, 401);
});

Deno.test('POST /api/v1/bookmarks - creates new bookmark', async () => {
  const { deps, db, queue } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id FROM bookmarks WHERE user_id', () => null);
  db.setQueryHandler('INSERT INTO bookmarks', () => null);
  db.setQueryHandler('INSERT INTO sync_log', () => null);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({
      url: 'https://example.com',
      title: 'Example Page',
      html: '<html><body>Hello</body></html>',
    }),
  });

  assertEquals(res.status, 201);

  const body = await res.json();
  assertEquals(body.url, 'https://example.com');
  assertEquals(body.title, 'Example Page');
  assertEquals(body.status, 'pending');
  assertEquals(body.userId, userId);
  assertEquals(body.tags, []);

  assertEquals(queue.sentMessages.length, 1);
  assertEquals(queue.sentMessages[0].action, 'process');
});

Deno.test('POST /api/v1/bookmarks - rejects missing url', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({ title: 'Example Page' }),
  });

  assertEquals(res.status, 400);
});

Deno.test('POST /api/v1/bookmarks - updates existing bookmark with same URL', async () => {
  const { deps, db, queue } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const existingId = 'existing-bookmark-id';
  db.setQueryHandler('SELECT id FROM bookmarks WHERE user_id', () => ({ id: existingId }));
  db.setQueryHandler('UPDATE bookmarks SET title', () => null);
  db.setQueryHandler('INSERT INTO sync_log', () => null);
  db.setQueryHandler('SELECT tag_name FROM bookmark_tags', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({
      url: 'https://example.com',
      title: 'Updated Title',
      html: '<html><body>Updated</body></html>',
    }),
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.id, existingId);
  assertEquals(queue.sentMessages.length, 1);
});

Deno.test('GET /api/v1/bookmarks - returns paginated bookmarks', async () => {
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
  db.setQueryHandler('SELECT * FROM bookmarks WHERE user_id', () => mockBookmarks);
  db.setQueryHandler('SELECT bookmark_id, tag_name FROM bookmark_tags', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.bookmarks.length, 2);
  assertEquals(body.total, 2);
  assertEquals(body.page, 1);
  assertEquals(body.hasMore, false);
});

Deno.test('GET /api/v1/bookmarks/:id - returns bookmark with Q&A pairs', async () => {
  const { deps, db } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  const bookmarkId = 'test-bookmark-id';
  const mockBookmark = {
    id: bookmarkId,
    user_id: userId,
    url: 'https://example.com',
    title: 'Example',
    html: '<html></html>',
    markdown: '# Example',
    status: 'complete',
    error_message: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    deleted_at: null,
  };

  db.setQueryHandler('SELECT * FROM bookmarks WHERE id', () => mockBookmark);
  db.setQueryHandler('SELECT tag_name FROM bookmark_tags', () => [{ tag_name: 'test' }]);
  db.setQueryHandler('SELECT id, question, answer, created_at', () => [
    { id: 'qa-1', question: 'What is this?', answer: 'An example.', created_at: '2024-01-01T00:00:00.000Z' },
  ]);

  const app = createApp(deps);
  const res = await app.request(`/api/v1/bookmarks/${bookmarkId}`, {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.id, bookmarkId);
  assertEquals(body.tags, ['test']);
  assertEquals(body.qaPairs.length, 1);
  assertEquals(body.qaPairs[0].question, 'What is this?');
});

Deno.test('GET /api/v1/bookmarks/:id - returns 404 for non-existent bookmark', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT * FROM bookmarks WHERE id', () => null);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks/non-existent', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 404);
});

Deno.test('DELETE /api/v1/bookmarks/:id - soft deletes bookmark', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const bookmarkId = 'test-bookmark-id';
  db.setQueryHandler('SELECT id FROM bookmarks WHERE id', () => ({ id: bookmarkId }));
  db.setQueryHandler('UPDATE bookmarks SET deleted_at', () => null);
  db.setQueryHandler('INSERT INTO sync_log', () => null);

  const app = createApp(deps);
  const res = await app.request(`/api/v1/bookmarks/${bookmarkId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 204);

  const updateQuery = db.executedQueries.find(q => q.sql.includes('UPDATE bookmarks SET deleted_at'));
  assertEquals(updateQuery !== undefined, true);
});

Deno.test('POST /api/v1/bookmarks/:id/tags - adds tag to bookmark', async () => {
  const { deps, db } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  const bookmarkId = 'test-bookmark-id';
  const mockBookmark = {
    id: bookmarkId,
    user_id: userId,
    url: 'https://example.com',
    title: 'Example',
    html: '<html></html>',
    markdown: null,
    status: 'complete',
    error_message: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    deleted_at: null,
  };

  db.setQueryHandler('SELECT * FROM bookmarks WHERE id', () => mockBookmark);
  db.setQueryHandler('INSERT OR IGNORE INTO bookmark_tags', () => null);
  db.setQueryHandler('UPDATE bookmarks SET updated_at', () => null);
  db.setQueryHandler('INSERT INTO sync_log', () => null);
  db.setQueryHandler('SELECT tag_name FROM bookmark_tags', () => [{ tag_name: 'newtag' }]);

  const app = createApp(deps);
  const res = await app.request(`/api/v1/bookmarks/${bookmarkId}/tags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({ tag: 'NewTag' }),
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.tags, ['newtag']);
});

Deno.test('POST /api/v1/bookmarks/:id/tags - rejects empty tag', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks/test-id/tags', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({ tag: '' }),
  });

  assertEquals(res.status, 400);
});

Deno.test('POST /api/v1/bookmarks/reprocess - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks/reprocess', {
    method: 'POST',
  });

  assertEquals(res.status, 401);
});

Deno.test('POST /api/v1/bookmarks/reprocess - queues all bookmarks for reprocessing', async () => {
  const { deps, db, queue } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id FROM bookmarks WHERE user_id', () => [
    { id: 'bookmark-1' },
    { id: 'bookmark-2' },
    { id: 'bookmark-3' },
  ]);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks/reprocess', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.queued, 3);

  assertEquals(queue.sentMessages.length, 3);
  assertEquals(queue.sentMessages[0].bookmarkId, 'bookmark-1');
  assertEquals(queue.sentMessages[0].userId, userId);
  assertEquals(queue.sentMessages[0].action, 'reprocess');
  assertEquals(queue.sentMessages[1].bookmarkId, 'bookmark-2');
  assertEquals(queue.sentMessages[2].bookmarkId, 'bookmark-3');
});

Deno.test('POST /api/v1/bookmarks/reprocess - returns zero when no bookmarks', async () => {
  const { deps, db, queue } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT id FROM bookmarks WHERE user_id', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/bookmarks/reprocess', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.queued, 0);
  assertEquals(queue.sentMessages.length, 0);
});
