import type { AppDependencies } from '../app.ts';

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export async function logSync(deps: AppDependencies, userId: string, entityType: string, entityId: string, operation: string): Promise<void> {
  await deps.db.prepare('INSERT INTO sync_log (user_id, entity_type, entity_id, operation, timestamp) VALUES (?, ?, ?, ?, ?)').bind(userId, entityType, entityId, operation, now()).run();
}
