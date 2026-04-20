import { Hono } from '@hono/hono';
import type { AppDependencies, AppVariables } from '../app.ts';
import { createAuthMiddleware, getAuth } from '../middleware/auth.app.ts';
import type { Bookmark, FullSyncBookmark, FullSyncRequest, FullSyncResponse, FullSyncDownloadResponse } from '../types/index.ts';
import { getBookmarkTagsBatch, rowToBookmark } from '../utils/bookmark-helpers.ts';
import { generateId, now, logSync, preserveHtml } from '../utils/common.ts';

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidTagsArray(tags: unknown): tags is string[] {
  return Array.isArray(tags) && tags.every(tag => typeof tag === 'string');
}

function validateBookmark(bookmark: unknown): bookmark is FullSyncBookmark {
  if (typeof bookmark !== 'object' || bookmark === null) return false;
  const b = bookmark as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.url === 'string' &&
    isValidUrl(b.url) &&
    typeof b.title === 'string' &&
    typeof b.html === 'string' &&
    (b.markdown === undefined || typeof b.markdown === 'string') &&
    typeof b.createdAt === 'string' &&
    typeof b.updatedAt === 'string' &&
    isValidTagsArray(b.tags)
  );
}

export function createSyncRoutes(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const sync = new Hono<{ Variables: AppVariables }>();

  sync.use('/*', createAuthMiddleware(deps));

  // GET /api/v1/sync/changes - Get incremental changes since a timestamp
  sync.get('/changes', async (c) => {
    const auth = getAuth(c);
    const since = c.req.query('since');

    const sinceTime = since || '1970-01-01T00:00:00.000Z';

    const logEntries = await deps.db.prepare<{
      id: number;
      entity_type: string;
      entity_id: string;
      operation: string;
      timestamp: string;
    }>(`
      SELECT id, entity_type, entity_id, operation, timestamp
      FROM sync_log
      WHERE user_id = ? AND timestamp > ?
      ORDER BY timestamp ASC
      LIMIT 1000
    `).bind(auth.userId, sinceTime).all();

    interface Change {
      type: 'created' | 'updated' | 'deleted';
      bookmark?: Bookmark;
      bookmarkId?: string;
    }

    const changes: Change[] = [];
    const processedBookmarks = new Set<string>();

    const bookmarkIdsToFetch: string[] = [];
    const operationByBookmarkId = new Map<string, string>();

    for (const entry of logEntries) {
      if (entry.entity_type !== 'bookmark') continue;
      if (processedBookmarks.has(entry.entity_id)) continue;
      processedBookmarks.add(entry.entity_id);

      if (entry.operation === 'delete') {
        changes.push({ type: 'deleted', bookmarkId: entry.entity_id });
      } else {
        bookmarkIdsToFetch.push(entry.entity_id);
        operationByBookmarkId.set(entry.entity_id, entry.operation);
      }
    }

    if (bookmarkIdsToFetch.length > 0) {
      const placeholders = bookmarkIdsToFetch.map(() => '?').join(', ');
      const rows = await deps.db.prepare(
        `SELECT * FROM bookmarks WHERE id IN (${placeholders})`
      ).bind(...bookmarkIdsToFetch).all() as Record<string, unknown>[];

      const rowsById = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        rowsById.set(row.id as string, row);
      }

      const tagsByBookmarkId = await getBookmarkTagsBatch(deps, bookmarkIdsToFetch);

      for (const bookmarkId of bookmarkIdsToFetch) {
        const row = rowsById.get(bookmarkId);
        if (row) {
          const operation = operationByBookmarkId.get(bookmarkId);
          changes.push({
            type: operation === 'create' ? 'created' : 'updated',
            bookmark: rowToBookmark(row, tagsByBookmarkId.get(bookmarkId) ?? []),
          });
        }
      }
    }

    const syncTimestamp = changes.length > 0
      ? logEntries[logEntries.length - 1].timestamp
      : now();

    return c.json({ changes, syncTimestamp });
  });

  // GET /api/v1/sync/full - Download all bookmarks from server
  sync.get('/full', async (c) => {
    const auth = getAuth(c);

    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');

    const limit = Math.min(Math.max(1, parseInt(limitParam || '100', 10) || 100), 500);
    const offset = Math.max(0, parseInt(offsetParam || '0', 10) || 0);

    const countResult = await deps.db.prepare(`
      SELECT COUNT(*) as count FROM bookmarks
      WHERE user_id = ? AND deleted_at IS NULL
    `).bind(auth.userId).first() as { count: number } | null;
    const total = countResult?.count ?? 0;

    const rows = await deps.db.prepare(`
      SELECT * FROM bookmarks
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(auth.userId, limit, offset).all() as Record<string, unknown>[];

    const bookmarkIds = rows.map(row => row.id as string);
    const tagsByBookmarkId = await getBookmarkTagsBatch(deps, bookmarkIds);

    const bookmarks: Bookmark[] = rows.map(row =>
      rowToBookmark(row, tagsByBookmarkId.get(row.id as string) ?? [])
    );

    const hasMore = offset + bookmarks.length < total;

    const response: FullSyncDownloadResponse = {
      bookmarks,
      hasMore,
      total,
      syncTimestamp: now(),
    };

    return c.json(response);
  });

  // POST /api/v1/sync/full - Upload bookmarks from client (initial sync with local data)
  sync.post('/full', async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json() as FullSyncRequest;

    if (!Array.isArray(body.bookmarks)) {
      return c.json({ error: 'bookmarks array is required' }, 400);
    }

    // Validate all bookmarks before processing
    const validBookmarks: FullSyncBookmark[] = [];
    const invalidIndices: number[] = [];
    for (let i = 0; i < body.bookmarks.length; i++) {
      if (validateBookmark(body.bookmarks[i])) {
        validBookmarks.push(body.bookmarks[i]);
      } else {
        invalidIndices.push(i);
      }
    }

    if (invalidIndices.length > 0) {
      return c.json({ error: `Invalid bookmarks at indices: ${invalidIndices.join(', ')}` }, 400);
    }

    const timestamp = now();

    let created = 0;
    let updated = 0;
    const conflicts: { localId: string; serverId: string; resolution: 'local' | 'server' }[] = [];

    // Batch fetch existing bookmarks by URL
    const urls = validBookmarks.map(b => b.url);
    const existingByUrl = new Map<string, { id: string; updated_at: string; html: string | null; status: string }>();

    if (urls.length > 0) {
      const placeholders = urls.map(() => '?').join(', ');
      const existingRows = await deps.db.prepare<{ id: string; url: string; updated_at: string; html: string | null; status: string }>(
        `SELECT id, url, updated_at, html, status FROM bookmarks WHERE user_id = ? AND url IN (${placeholders})`
      ).bind(auth.userId, ...urls).all();

      for (const row of existingRows) {
        existingByUrl.set(row.url, { id: row.id, updated_at: row.updated_at, html: row.html, status: row.status });
      }
    }

    for (const clientBookmark of validBookmarks) {
      const existing = existingByUrl.get(clientBookmark.url);

      if (existing) {
        const serverTime = new Date(existing.updated_at).getTime();
        const clientTime = new Date(clientBookmark.updatedAt).getTime();

        if (serverTime > clientTime) {
          conflicts.push({ localId: clientBookmark.id, serverId: existing.id, resolution: 'server' });
        } else {
          const { value: html, changed: htmlChanged } = preserveHtml(clientBookmark.html, existing.html);
          const nextStatus = htmlChanged ? 'pending' : existing.status;
          await deps.db.prepare(`
            UPDATE bookmarks SET title = ?, html = ?, markdown = ?, status = ?, updated_at = ? WHERE id = ?
          `).bind(clientBookmark.title, html, clientBookmark.markdown || null, nextStatus, timestamp, existing.id).run();

          await deps.db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').bind(existing.id).run();
          for (const tag of clientBookmark.tags) {
            if (typeof tag === 'string' && tag.trim()) {
              await deps.db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').bind(existing.id, tag.toLowerCase(), timestamp).run();
            }
          }

          await logSync(deps, auth.userId, 'bookmark', existing.id, 'update');
          if (htmlChanged) {
            await deps.queue.send({ bookmarkId: existing.id, userId: auth.userId, action: 'process' });
          }
          conflicts.push({ localId: clientBookmark.id, serverId: existing.id, resolution: 'local' });
          updated++;
        }
      } else {
        const id = clientBookmark.id || generateId();

        await deps.db.prepare(`
          INSERT INTO bookmarks (id, user_id, url, title, html, markdown, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).bind(id, auth.userId, clientBookmark.url, clientBookmark.title, clientBookmark.html, clientBookmark.markdown || null, clientBookmark.createdAt || timestamp, timestamp).run();

        for (const tag of clientBookmark.tags) {
          if (typeof tag === 'string' && tag.trim()) {
            await deps.db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').bind(id, tag.toLowerCase(), timestamp).run();
          }
        }

        await logSync(deps, auth.userId, 'bookmark', id, 'create');
        await deps.queue.send({ bookmarkId: id, userId: auth.userId, action: 'process' });
        created++;
      }
    }

    const response: FullSyncResponse = { created, updated, conflicts, syncToken: timestamp };
    return c.json(response);
  });

  return sync;
}
