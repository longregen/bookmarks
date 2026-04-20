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

// Monotonic html: never replace a non-empty capture with an empty/shorter one.
// Derivatives (markdown, summary, questions, embeddings) can be rebuilt from html;
// html itself cannot be recovered once a client overwrites it with an empty payload.
export function preserveHtml(incoming: string | null | undefined, existing: string | null | undefined): { value: string; changed: boolean } {
  const inc = incoming ?? '';
  const ex = existing ?? '';
  if (inc.length >= ex.length) return { value: inc, changed: inc !== ex };
  return { value: ex, changed: false };
}
