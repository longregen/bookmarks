import { Database } from '@db/sqlite';
import { createApp } from './app.ts';
import { DenoDatabase } from './adapters/database/deno.ts';
import { DenoQueue } from './adapters/queue/deno.ts';
import { DenoEnv } from './adapters/env/deno.ts';
import { createQueueConsumer } from './services/processor.app.ts';

// Initialize environment adapter
const env = new DenoEnv();

// Initialize database
const dbPath = env.get('DATABASE_PATH') || './data/bookmarks.db';
const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
if (dir) {
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore - directory already exists
  }
}

const sqliteDb = new Database(dbPath);
sqliteDb.exec('PRAGMA foreign_keys = ON');
sqliteDb.exec('PRAGMA journal_mode = WAL');

// Initialize schema
async function initializeSchema(): Promise<void> {
  const schemaPath = new URL('./db/schema.sql', import.meta.url);
  const schema = await Deno.readTextFile(schemaPath);
  sqliteDb.exec(schema);
  console.log('Database initialized');
}

// Create adapters
const db = new DenoDatabase(sqliteDb);
const queue = new DenoQueue();

// Set up queue consumer for processing bookmarks
const consumer = createQueueConsumer({ db, queue, env });
queue.setConsumer(consumer);

// Create app with dependencies
const app = createApp({ db, queue, env });

// Initialize and start server
const port = parseInt(env.get('PORT') || '3000', 10);

console.log('Initializing database...');
await initializeSchema();

console.log(`Starting server on port ${port}...`);

Deno.serve({
  port,
  onListen: ({ hostname, port }) => {
    console.log(`Server running at http://${hostname}:${port}`);
    console.log('\nConfiguration:');
    console.log(`  DATABASE_PATH: ${dbPath}`);
    console.log(`  OPENAI_API_KEY: ${env.get('OPENAI_API_KEY') ? '(set)' : '(not set)'}`);
  },
}, app.fetch);

// Graceful shutdown
Deno.addSignalListener('SIGINT', () => {
  console.log('\nShutting down...');
  sqliteDb.close();
  Deno.exit(0);
});
