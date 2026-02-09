import { Hono } from '@hono/hono';
import type { AppDependencies, AppVariables } from '../app.ts';
import type { AuthResponse } from '../types/index.ts';
import { generateId, now } from '../utils/common.ts';
import { createAuthMiddleware, getAuth } from '../middleware/auth.app.ts';

const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_MIN_LENGTH = 8;
const TOKEN_MAX_LENGTH = 256;

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createAuthRoutes(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const auth = new Hono<{ Variables: AppVariables }>();

  const SESSION_DURATION_MS = parseInt(deps.env.get('SESSION_DURATION_MS') || '', 10) || DEFAULT_SESSION_DURATION_MS;

  auth.post('/token', async (c) => {
    const body = await c.req.json() as { token?: string };
    const token = body.token;

    if (!token || typeof token !== 'string') {
      return c.json({ error: 'Token is required', code: 'INVALID_REQUEST' }, 400);
    }

    if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH) {
      return c.json({ error: `Token must be between ${TOKEN_MIN_LENGTH} and ${TOKEN_MAX_LENGTH} characters`, code: 'INVALID_REQUEST' }, 400);
    }

    const tokenHash = await hashToken(token);

    const existingUser = await deps.db.prepare<{ id: string }>(
      'SELECT id FROM users WHERE token_hash = ?'
    ).bind(tokenHash).first();

    let userId: string;
    let created = false;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      userId = generateId();
      await deps.db.prepare(
        'INSERT INTO users (id, token_hash, created_at) VALUES (?, ?, ?)'
      ).bind(userId, tokenHash, now()).run();
      created = true;
    }

    const sessionId = generateId();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    await deps.db.prepare(
      'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, userId, expiresAt, now()).run();

    const response: AuthResponse = {
      sessionToken: sessionId,
      sessionExpiry: expiresAt,
      userId,
      created,
    };

    return c.json(response);
  });

  auth.post('/logout', async (c) => {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      await deps.db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
    }

    return c.body(null, 204);
  });

  auth.delete('/account', createAuthMiddleware(deps), async (c) => {
    const { userId } = getAuth(c);

    await deps.db.batch([
      deps.db.prepare('DELETE FROM sync_log WHERE user_id = ?').bind(userId),
      deps.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      deps.db.prepare('DELETE FROM questions_answers WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE user_id = ?)').bind(userId),
      deps.db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE user_id = ?)').bind(userId),
      deps.db.prepare('DELETE FROM bookmarks WHERE user_id = ?').bind(userId),
      deps.db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);

    return c.body(null, 204);
  });

  return auth;
}
