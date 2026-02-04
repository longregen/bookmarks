import type { Context, Next } from '@hono/hono';
import { getDatabase, now } from '../db/database.ts';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  if (!token) {
    return c.json({ error: 'Missing session token' }, 401);
  }

  const db = getDatabase();
  const currentTime = now();

  // Verify session
  const session = db.prepare(`
    SELECT s.id, s.user_id, s.expires_at, u.username
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(token, currentTime) as { id: string; user_id: string; expires_at: string; username: string } | undefined;

  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  // Set auth context
  c.set('auth', {
    userId: session.user_id,
    sessionId: session.id,
  } as AuthContext);

  await next();
}

export function getAuth(c: Context): AuthContext {
  return c.get('auth') as AuthContext;
}
