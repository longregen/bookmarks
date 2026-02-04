import { Hono } from '@hono/hono';
import { cors } from '@hono/hono/cors';
import { logger } from '@hono/hono/logger';
import type { Database } from './adapters/database/interface.ts';
import type { Queue } from './adapters/queue/interface.ts';
import type { Env } from './adapters/env/interface.ts';
import { createAuthRoutes } from './routes/auth.app.ts';
import { createBookmarkRoutes } from './routes/bookmarks.app.ts';
import { createSearchRoutes } from './routes/search.app.ts';
import { createSyncRoutes } from './routes/sync.app.ts';

export interface AppDependencies {
  db: Database;
  queue: Queue;
  env: Env;
}

export interface AppVariables {
  deps: AppDependencies;
  auth?: {
    userId: string;
    sessionId: string;
  };
}

export type AppHono = Hono<{ Variables: AppVariables }>;

export function createApp(deps: AppDependencies): AppHono {
  const app = new Hono<{ Variables: AppVariables }>();

  // Inject dependencies into context
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  // Middleware
  app.use('*', logger());
  app.use('*', cors({
    origin: deps.env.get('CORS_ORIGIN') || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 3600,
  }));

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // API routes
  app.route('/api/v1/auth', createAuthRoutes(deps));
  app.route('/api/v1/bookmarks', createBookmarkRoutes(deps));
  app.route('/api/v1/search', createSearchRoutes(deps));
  app.route('/api/v1/sync', createSyncRoutes(deps));

  // 404 handler
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
