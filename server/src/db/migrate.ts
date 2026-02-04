import { initializeDatabase, closeDatabase } from './database.ts';

console.log('Running database migrations...');

try {
  await initializeDatabase();
  console.log('Migrations complete!');
} catch (error) {
  console.error('Migration failed:', error);
  Deno.exit(1);
} finally {
  closeDatabase();
}
