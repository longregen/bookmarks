import { Hono } from '@hono/hono';
import { getDatabase, generateId, now } from '../db/database.ts';
import { authMiddleware, getAuth } from '../middleware/auth.ts';
import { getBookmarkTags, rowToBookmark, logSync } from '../utils/bookmark-helpers.ts';
import type { CreateBookmarkRequest, BookmarkListResponse } from '../types/index.ts';
import { queueBookmarkProcessing } from '../services/processor.ts';

const bookmarks = new Hono();

bookmarks.use('/*', authMiddleware);

// POST /api/v1/bookmarks - Create bookmark
bookmarks.post('/', async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json() as CreateBookmarkRequest;

  if (!body.url || !body.title) {
    return c.json({ error: 'URL and title are required' }, 400);
  }

  const db = getDatabase();
  const id = generateId();
  const timestamp = now();

  const existing = db.prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL').get(auth.userId, body.url) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE bookmarks SET title = ?, html = ?, status = \'pending\', updated_at = ? WHERE id = ?').run(body.title, body.html, timestamp, existing.id);
    logSync(db, auth.userId, 'bookmark', existing.id, 'update');
    queueBookmarkProcessing(existing.id);

    const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(existing.id) as Record<string, unknown>;
    return c.json(rowToBookmark(row, getBookmarkTags(db, existing.id)));
  }

  db.prepare('INSERT INTO bookmarks (id, user_id, url, title, html, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'pending\', ?, ?)').run(id, auth.userId, body.url, body.title, body.html, timestamp, timestamp);
  logSync(db, auth.userId, 'bookmark', id, 'create');
  queueBookmarkProcessing(id);

  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as Record<string, unknown>;
  return c.json(rowToBookmark(row, []), 201);
});

// GET /api/v1/bookmarks - List bookmarks
bookmarks.get('/', (c) => {
  const auth = getAuth(c);
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '50', 10), 100);
  const offset = (page - 1) * pageSize;

  const db = getDatabase();

  const countResult = db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL').get(auth.userId) as { count: number };
  const total = countResult.count;

  const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?').all(auth.userId, pageSize, offset) as Record<string, unknown>[];

  const bookmarkList = rows.map(row => rowToBookmark(row, getBookmarkTags(db, row.id as string)));

  const response: BookmarkListResponse = {
    bookmarks: bookmarkList,
    total,
    page,
    pageSize,
    hasMore: offset + bookmarkList.length < total,
  };

  return c.json(response);
});

// GET /api/v1/bookmarks/:id - Get single bookmark with full content
bookmarks.get('/:id', (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(id, auth.userId) as Record<string, unknown> | undefined;

  if (!row) {
    return c.json({ error: 'Bookmark not found' }, 404);
  }

  const bookmark = rowToBookmark(row, getBookmarkTags(db, id));

  // Fetch Q&A pairs for this bookmark
  const qaPairs = db.prepare(`
    SELECT id, question, answer, created_at
    FROM questions_answers
    WHERE bookmark_id = ?
    ORDER BY created_at ASC
  `).all(id) as { id: string; question: string; answer: string; created_at: string }[];

  return c.json({
    ...bookmark,
    qaPairs: qaPairs.map(qa => ({
      id: qa.id,
      question: qa.question,
      answer: qa.answer,
      createdAt: qa.created_at,
    })),
  });
});

// PUT /api/v1/bookmarks/:id - Update bookmark
bookmarks.put('/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  const body = await c.req.json() as Partial<CreateBookmarkRequest & { markdown?: string; tags?: string[] }>;
  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(id, auth.userId) as Record<string, unknown> | undefined;

  if (!existing) {
    return c.json({ error: 'Bookmark not found' }, 404);
  }

  const timestamp = now();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.html !== undefined) { updates.push('html = ?'); values.push(body.html); updates.push('status = \'pending\''); }
  if (body.markdown !== undefined) { updates.push('markdown = ?'); values.push(body.markdown); }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(timestamp);
    values.push(id);
    db.prepare(`UPDATE bookmarks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  if (body.tags !== undefined) {
    db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(id);
    for (const tag of body.tags) {
      db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').run(id, tag.toLowerCase(), timestamp);
    }
  }

  logSync(db, auth.userId, 'bookmark', id, 'update');

  if (body.html !== undefined) {
    queueBookmarkProcessing(id);
  }

  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as Record<string, unknown>;
  return c.json(rowToBookmark(row, getBookmarkTags(db, id)));
});

// DELETE /api/v1/bookmarks/:id - Delete bookmark
bookmarks.delete('/:id', (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM bookmarks WHERE id = ? AND user_id = ?').get(id, auth.userId) as { id: string } | undefined;

  if (!existing) {
    return c.json({ error: 'Bookmark not found' }, 404);
  }

  db.prepare('UPDATE bookmarks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  logSync(db, auth.userId, 'bookmark', id, 'delete');

  return c.body(null, 204);
});

// POST /api/v1/bookmarks/:id/tags - Add tag
bookmarks.post('/:id/tags', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  const body = await c.req.json() as { tag: string };

  if (!body.tag?.trim()) {
    return c.json({ error: 'Tag is required' }, 400);
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, auth.userId) as Record<string, unknown> | undefined;

  if (!existing) {
    return c.json({ error: 'Bookmark not found' }, 404);
  }

  const tagName = body.tag.trim().toLowerCase();

  try {
    db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').run(id, tagName, now());
    db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').run(now(), id);
    logSync(db, auth.userId, 'bookmark', id, 'update');
  } catch {
    // Tag already exists
  }

  return c.json(rowToBookmark(existing, getBookmarkTags(db, id)));
});

// DELETE /api/v1/bookmarks/:id/tags/:tag - Remove tag
bookmarks.delete('/:id/tags/:tag', (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  const tagName = decodeURIComponent(c.req.param('tag'));
  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, auth.userId) as Record<string, unknown> | undefined;

  if (!existing) {
    return c.json({ error: 'Bookmark not found' }, 404);
  }

  db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_name = ?').run(id, tagName.toLowerCase());
  db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').run(now(), id);
  logSync(db, auth.userId, 'bookmark', id, 'update');

  return c.json(rowToBookmark(existing, getBookmarkTags(db, id)));
});

export default bookmarks;
