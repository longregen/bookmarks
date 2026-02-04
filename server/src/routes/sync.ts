import { Hono } from '@hono/hono';
import { getDatabase, generateId, now } from '../db/database.ts';
import { authMiddleware, getAuth } from '../middleware/auth.ts';
import { getBookmarkTags, rowToBookmark, rowToBookmarkMinimal, logSync, type BookmarkMinimal } from '../utils/bookmark-helpers.ts';
import type { Bookmark, FullSyncRequest, FullSyncResponse } from '../types/index.ts';
import { queueBookmarkProcessing } from '../services/processor.ts';

const sync = new Hono();

sync.use('/*', authMiddleware);

// GET /api/v1/sync/changes - Get incremental changes since a timestamp
sync.get('/changes', (c) => {
  const auth = getAuth(c);
  const since = c.req.query('since');
  const db = getDatabase();

  const sinceTime = since || '1970-01-01T00:00:00.000Z';

  const logEntries = db.prepare(`
    SELECT id, entity_type, entity_id, operation, timestamp
    FROM sync_log
    WHERE user_id = ? AND timestamp > ?
    ORDER BY timestamp ASC
    LIMIT 1000
  `).all(auth.userId, sinceTime) as {
    id: number;
    entity_type: string;
    entity_id: string;
    operation: string;
    timestamp: string;
  }[];

  interface Change {
    type: 'created' | 'updated' | 'deleted';
    bookmark?: Bookmark;
    bookmarkId?: string;
  }

  const changes: Change[] = [];
  const processedBookmarks = new Set<string>();

  for (const entry of logEntries) {
    if (entry.entity_type !== 'bookmark') continue;
    if (processedBookmarks.has(entry.entity_id)) continue;
    processedBookmarks.add(entry.entity_id);

    if (entry.operation === 'delete') {
      changes.push({ type: 'deleted', bookmarkId: entry.entity_id });
    } else {
      const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(entry.entity_id) as Record<string, unknown> | undefined;
      if (row) {
        const tags = getBookmarkTags(db, entry.entity_id);
        changes.push({
          type: entry.operation === 'create' ? 'created' : 'updated',
          bookmark: rowToBookmark(row, tags),
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
sync.get('/full', (c) => {
  const auth = getAuth(c);
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM bookmarks
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `).all(auth.userId) as Record<string, unknown>[];

  const bookmarks: Bookmark[] = rows.map(row => {
    const tags = getBookmarkTags(db, row.id as string);
    return rowToBookmark(row, tags);
  });

  return c.json({ bookmarks, syncTimestamp: now() });
});

// POST /api/v1/sync/full - Upload bookmarks from client (initial sync with local data)
sync.post('/full', async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json() as FullSyncRequest;

  if (!Array.isArray(body.bookmarks)) {
    return c.json({ error: 'bookmarks array is required' }, 400);
  }

  const db = getDatabase();
  const timestamp = now();

  let created = 0;
  let updated = 0;
  const conflicts: { localId: string; serverId: string; resolution: 'local' | 'server' }[] = [];

  for (const clientBookmark of body.bookmarks) {
    const existing = db.prepare(`
      SELECT id, updated_at FROM bookmarks WHERE user_id = ? AND url = ?
    `).get(auth.userId, clientBookmark.url) as { id: string; updated_at: string } | undefined;

    if (existing) {
      const serverTime = new Date(existing.updated_at).getTime();
      const clientTime = new Date(clientBookmark.updatedAt).getTime();

      if (serverTime > clientTime) {
        conflicts.push({ localId: clientBookmark.id, serverId: existing.id, resolution: 'server' });
      } else {
        db.prepare(`
          UPDATE bookmarks SET title = ?, html = ?, markdown = ?, status = 'pending', updated_at = ? WHERE id = ?
        `).run(clientBookmark.title, clientBookmark.html, clientBookmark.markdown || null, timestamp, existing.id);

        db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(existing.id);
        for (const tag of clientBookmark.tags) {
          db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').run(existing.id, tag.toLowerCase(), timestamp);
        }

        logSync(db, auth.userId, 'bookmark', existing.id, 'update');
        queueBookmarkProcessing(existing.id);
        conflicts.push({ localId: clientBookmark.id, serverId: existing.id, resolution: 'local' });
        updated++;
      }
    } else {
      const id = clientBookmark.id || generateId();

      db.prepare(`
        INSERT INTO bookmarks (id, user_id, url, title, html, markdown, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, auth.userId, clientBookmark.url, clientBookmark.title, clientBookmark.html, clientBookmark.markdown || null, clientBookmark.createdAt || timestamp, timestamp);

      for (const tag of clientBookmark.tags) {
        db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').run(id, tag.toLowerCase(), timestamp);
      }

      logSync(db, auth.userId, 'bookmark', id, 'create');
      queueBookmarkProcessing(id);
      created++;
    }
  }

  const response: FullSyncResponse = { created, updated, conflicts, syncToken: timestamp };
  return c.json(response);
});

export default sync;
