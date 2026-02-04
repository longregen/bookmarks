import type { Context, Next } from '@hono/hono';
import type { AppDependencies, AppVariables } from '../app.ts';
import { generateId, now } from '../utils/common.ts';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createAuthMiddleware(deps: AppDependencies) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next): Promise<Response | void> => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid authorization header' }, 401);
    }

    const token = authHeader.slice(7);

    if (!token) {
      return c.json({ error: 'Missing session token' }, 401);
    }

    const currentTime = now();

    const session = await deps.db.prepare<{
      id: string;
      user_id: string;
      expires_at: string;
      username: string;
    }>(`
      SELECT s.id, s.user_id, s.expires_at, u.username
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.expires_at > ?
    `).bind(token, currentTime).first();

    if (!session) {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }

    let activeSessionId = session.id;

    // Check if session needs refresh (less than 7 days remaining)
    const expiresAt = new Date(session.expires_at).getTime();
    const timeUntilExpiry = expiresAt - Date.now();

    if (timeUntilExpiry < SESSION_REFRESH_THRESHOLD_MS) {
      // Check if a newer session already exists to avoid race condition duplicates
      const newerSession = await deps.db.prepare<{ id: string; expires_at: string }>(`
        SELECT id, expires_at FROM sessions
        WHERE user_id = ? AND expires_at > ?
        ORDER BY expires_at DESC
        LIMIT 1
      `).bind(session.user_id, session.expires_at).first();

      if (newerSession) {
        activeSessionId = newerSession.id;
        c.header('X-New-Session-Token', newerSession.id);
        c.header('X-New-Session-Expiry', newerSession.expires_at);
      } else {
        const newSessionId = generateId();
        const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

        await deps.db.prepare(`
          INSERT INTO sessions (id, user_id, expires_at, created_at)
          VALUES (?, ?, ?, ?)
        `).bind(newSessionId, session.user_id, newExpiresAt, now()).run();

        // Keep old session valid for graceful degradation if response fails
        activeSessionId = newSessionId;
        c.header('X-New-Session-Token', newSessionId);
        c.header('X-New-Session-Expiry', newExpiresAt);
      }
    }

    c.set('auth', {
      userId: session.user_id,
      sessionId: activeSessionId,
    });

    await next();
  };
}

export function getAuth(c: Context<{ Variables: AppVariables }>): AuthContext {
  return c.get('auth') as AuthContext;
}
