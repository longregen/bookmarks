import { assertEquals } from 'jsr:@std/assert';
import { createApp } from '../app.ts';
import { createMockDeps } from './helpers.ts';

Deno.test('POST /api/v1/auth/token - creates new user with valid token', async () => {
  const { deps, db } = createMockDeps();

  db.setQueryHandler('SELECT id FROM users', () => null);
  db.setQueryHandler('INSERT INTO users', () => null);
  db.setQueryHandler('INSERT INTO sessions', () => null);

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'test-token-12345' }),
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(typeof body.sessionToken, 'string');
  assertEquals(typeof body.sessionExpiry, 'string');
  assertEquals(typeof body.userId, 'string');
  assertEquals(body.created, true);
});

Deno.test('POST /api/v1/auth/token - returns existing user', async () => {
  const { deps, db } = createMockDeps();

  const existingUserId = 'existing-user-id';
  db.setQueryHandler('SELECT id FROM users', () => ({ id: existingUserId }));
  db.setQueryHandler('INSERT INTO sessions', () => null);

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'test-token-12345' }),
  });

  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.userId, existingUserId);
  assertEquals(body.created, false);
});

Deno.test('POST /api/v1/auth/token - rejects missing token', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEquals(res.status, 400);

  const body = await res.json();
  assertEquals(body.code, 'INVALID_REQUEST');
});

Deno.test('POST /api/v1/auth/token - rejects short token', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'short' }),
  });

  assertEquals(res.status, 400);

  const body = await res.json();
  assertEquals(body.code, 'INVALID_REQUEST');
});

Deno.test('POST /api/v1/auth/logout - deletes session', async () => {
  const { deps, db } = createMockDeps();

  db.setQueryHandler('DELETE FROM sessions', () => null);

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-session-id' },
  });

  assertEquals(res.status, 204);

  const deleteQuery = db.executedQueries.find(q => q.sql.includes('DELETE FROM sessions'));
  assertEquals(deleteQuery?.params[0], 'test-session-id');
});

Deno.test('POST /api/v1/auth/logout - succeeds without auth header', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/logout', {
    method: 'POST',
  });

  assertEquals(res.status, 204);
});

Deno.test('DELETE /api/v1/auth/account - requires authentication', async () => {
  const { deps } = createMockDeps();

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/account', {
    method: 'DELETE',
  });

  assertEquals(res.status, 401);
});

Deno.test('DELETE /api/v1/auth/account - deletes user and related data', async () => {
  const { deps, db } = createMockDeps();

  const userId = 'test-user-id';
  const sessionId = 'test-session-id';

  db.setQueryHandler('SELECT s.id, s.user_id, s.expires_at', () => ({
    id: sessionId,
    user_id: userId,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  }));

  const app = createApp(deps);
  const res = await app.request('/api/v1/auth/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  assertEquals(res.status, 204);

  const deleteQueries = db.executedQueries.filter(q => q.sql.includes('DELETE'));
  assertEquals(deleteQueries.length >= 5, true);
});
