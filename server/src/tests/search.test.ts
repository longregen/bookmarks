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

Deno.test('GET /api/v1/search - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/search?q=test');

  assertEquals(res.status, 401);
});

Deno.test('GET /api/v1/search - requires query parameter', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const app = createApp(deps);
  const res = await app.request('/api/v1/search', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 400);

  const body = await res.json();
  assertEquals(body.error, 'Query parameter "q" is required');
});

Deno.test('GET /api/v1/search - returns search results', async () => {
  const { deps, db } = createMockDeps();
  const { userId, sessionId } = setupAuthenticatedMock(db);

  const mockBookmarks = [
    {
      id: 'bookmark-1',
      user_id: userId,
      url: 'https://example.com',
      title: 'Test Result',
      html: '<html></html>',
      markdown: null,
      status: 'complete',
      error_message: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      deleted_at: null,
    },
  ];

  db.setQueryHandler('SELECT b.id FROM bookmarks_fts', () => [{ id: 'bookmark-1' }]);
  db.setQueryHandler('SELECT COUNT(*) as count FROM bookmarks_fts', () => ({ count: 1 }));
  db.setQueryHandler('SELECT * FROM bookmarks WHERE id IN', () => mockBookmarks);
  db.setQueryHandler('SELECT bookmark_id, tag_name FROM bookmark_tags', () => []);

  const app = createApp(deps);
  const res = await app.request('/api/v1/search?q=test', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.results.length, 1);
  assertEquals(body.results[0].title, 'Test Result');
  assertEquals(body.total, 1);
  assertEquals(body.page, 1);
});

Deno.test('GET /api/v1/search - handles empty results', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT b.id FROM bookmarks_fts', () => []);
  db.setQueryHandler('SELECT COUNT(*) as count FROM bookmarks_fts', () => ({ count: 0 }));

  const app = createApp(deps);
  const res = await app.request('/api/v1/search?q=nonexistent', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.results.length, 0);
  assertEquals(body.total, 0);
});

Deno.test('GET /api/v1/search - supports pagination', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  db.setQueryHandler('SELECT b.id FROM bookmarks_fts', () => []);
  db.setQueryHandler('SELECT COUNT(*) as count FROM bookmarks_fts', () => ({ count: 100 }));

  const app = createApp(deps);
  const res = await app.request('/api/v1/search?q=test&page=2&pageSize=10', {
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.page, 2);
  assertEquals(body.pageSize, 10);
  assertEquals(body.hasMore, true);
});

Deno.test('POST /api/v1/search/semantic - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/search/semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test' }),
  });

  assertEquals(res.status, 401);
});

Deno.test('POST /api/v1/search/semantic - requires query in body', async () => {
  const { deps, db } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  const app = createApp(deps);
  const res = await app.request('/api/v1/search/semantic', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({}),
  });

  assertEquals(res.status, 400);

  const body = await res.json();
  assertEquals(body.error, 'Query is required');
});

Deno.test('POST /api/v1/search/semantic - returns empty results when no embeddings', async () => {
  const { deps, db, env } = createMockDeps();
  const { sessionId } = setupAuthenticatedMock(db);

  env.set('OPENAI_API_KEY', 'test-key');

  db.setQueryHandler('SELECT qa.id, qa.bookmark_id', () => []);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ embedding: Array(1536).fill(0) }],
  }));

  try {
    const app = createApp(deps);
    const res = await app.request('/api/v1/search/semantic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ query: 'test query' }),
    });

    assertEquals(res.status, 200);

    const body = await res.json();
    assertEquals(body.results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
