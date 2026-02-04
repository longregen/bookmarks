import type { Database } from '@db/sqlite';
import { now } from '../db/database.ts';
import type { Bookmark } from '../types/index.ts';

export interface BookmarkMinimal {
  id: string;
  userId: string;
  url: string;
  title: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: string[];
}

export function getBookmarkTags(db: Database, bookmarkId: string): string[] {
  const tags = db.prepare('SELECT tag_name FROM bookmark_tags WHERE bookmark_id = ?').all(bookmarkId) as { tag_name: string }[];
  return tags.map(t => t.tag_name);
}

export function rowToBookmark(row: Record<string, unknown>, tags: string[]): Bookmark {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    url: row.url as string,
    title: row.title as string,
    html: row.html as string | null,
    markdown: row.markdown as string | null,
    status: row.status as 'pending' | 'processing' | 'complete' | 'error',
    errorMessage: row.error_message as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: row.deleted_at as string | null,
    tags,
  };
}

/**
 * Convert row to minimal bookmark (for sync - excludes html/markdown)
 */
export function rowToBookmarkMinimal(row: Record<string, unknown>, tags: string[]): BookmarkMinimal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    url: row.url as string,
    title: row.title as string,
    status: row.status as 'pending' | 'processing' | 'complete' | 'error',
    errorMessage: row.error_message as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: row.deleted_at as string | null,
    tags,
  };
}

export function logSync(db: Database, userId: string, entityType: string, entityId: string, operation: string): void {
  db.prepare('INSERT INTO sync_log (user_id, entity_type, entity_id, operation, timestamp) VALUES (?, ?, ?, ?, ?)').run(userId, entityType, entityId, operation, now());
}
