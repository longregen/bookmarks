import type { AppDependencies } from '../app.ts';
import type { Bookmark } from '../types/index.ts';

export async function getBookmarkTags(deps: AppDependencies, bookmarkId: string): Promise<string[]> {
  const tags = await deps.db.prepare<{ tag_name: string }>('SELECT tag_name FROM bookmark_tags WHERE bookmark_id = ?').bind(bookmarkId).all();
  return tags.map(t => t.tag_name);
}

export async function getBookmarkTagsBatch(deps: AppDependencies, bookmarkIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (bookmarkIds.length === 0) {
    return result;
  }

  const placeholders = bookmarkIds.map(() => '?').join(', ');
  const tags = await deps.db.prepare<{ bookmark_id: string; tag_name: string }>(
    `SELECT bookmark_id, tag_name FROM bookmark_tags WHERE bookmark_id IN (${placeholders})`
  ).bind(...bookmarkIds).all();

  for (const id of bookmarkIds) {
    result.set(id, []);
  }
  for (const tag of tags) {
    result.get(tag.bookmark_id)?.push(tag.tag_name);
  }

  return result;
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
