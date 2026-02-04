import { Hono } from '@hono/hono';
import { cors } from '@hono/hono/cors';
import { logger } from '@hono/hono/logger';
import { initializeDatabase, closeDatabase } from './db/database.ts';
import auth from './routes/auth.ts';
import bookmarks from './routes/bookmarks.ts';
import search from './routes/search.ts';
import sync from './routes/sync.ts';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: Deno.env.get('CORS_ORIGIN') || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 3600,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.route('/api/v1/auth', auth);
app.route('/api/v1/bookmarks', bookmarks);
app.route('/api/v1/search', search);
app.route('/api/v1/sync', sync);

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Initialize database and start server
const port = parseInt(Deno.env.get('PORT') || '3000', 10);

console.log('Initializing database...');
await initializeDatabase();

console.log(`Starting server on port ${port}...`);

Deno.serve({
  port,
  onListen: ({ hostname, port }) => {
    console.log(`Server running at http://${hostname}:${port}`);
    console.log('\nConfiguration:');
    console.log(`  RP_ID: ${Deno.env.get('RP_ID') || 'localhost'}`);
    console.log(`  RP_NAME: ${Deno.env.get('RP_NAME') || 'Bookmark RAG'}`);
    console.log(`  ORIGIN: ${Deno.env.get('ORIGIN') || 'http://localhost:3000'}`);
    console.log(`  DATABASE_PATH: ${Deno.env.get('DATABASE_PATH') || './data/bookmarks.db'}`);
    console.log(`  OPENAI_API_KEY: ${Deno.env.get('OPENAI_API_KEY') ? '(set)' : '(not set)'}`);
  },
}, app.fetch);

// Graceful shutdown
Deno.addSignalListener('SIGINT', () => {
  console.log('\nShutting down...');
  closeDatabase();
  Deno.exit(0);
});
