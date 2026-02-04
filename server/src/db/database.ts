import { Database } from '@db/sqlite';

let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    const dbPath = Deno.env.get('DATABASE_PATH') || './data/bookmarks.db';

    // Ensure data directory exists
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    if (dir) {
      try {
        Deno.mkdirSync(dir, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }

    db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export async function initializeDatabase(): Promise<void> {
  const database = getDatabase();

  // Read and execute schema
  const schemaPath = new URL('./schema.sql', import.meta.url);
  const schema = await Deno.readTextFile(schemaPath);

  // Execute entire schema at once - SQLite handles multiple statements
  database.exec(schema);

  console.log('Database initialized');
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
