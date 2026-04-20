import { Hono } from '@hono/hono';
import type { AppDependencies, AppVariables } from '../app.ts';
import { createAuthMiddleware, getAuth } from '../middleware/auth.app.ts';
import type { CreateBookmarkRequest, BookmarkListResponse, Bookmark } from '../types/index.ts';
import { getBookmarkTags, getBookmarkTagsBatch, rowToBookmark } from '../utils/bookmark-helpers.ts';
import { generateId, now, logSync, preserveHtml } from '../utils/common.ts';

export function createBookmarkRoutes(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const bookmarks = new Hono<{ Variables: AppVariables }>();

  bookmarks.use('/*', createAuthMiddleware(deps));

  // POST /api/v1/bookmarks - Create bookmark
  bookmarks.post('/', async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json() as CreateBookmarkRequest;

    if (!body.url) {
      return c.json({ error: 'URL is required' }, 400);
    }

    const title = body.title || body.url;
    const incomingHtml = body.html ?? '';
    const id = generateId();
    const timestamp = now();

    const existing = await deps.db.prepare<{ id: string; html: string | null; status: string }>('SELECT id, html, status FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL').bind(auth.userId, body.url).first();

    if (existing) {
      const { value: html, changed: htmlChanged } = preserveHtml(incomingHtml, existing.html);
      const nextStatus = htmlChanged ? 'pending' : existing.status;
      await deps.db.prepare('UPDATE bookmarks SET title = ?, html = ?, status = ?, updated_at = ? WHERE id = ?').bind(title, html, nextStatus, timestamp, existing.id).run();
      await logSync(deps, auth.userId, 'bookmark', existing.id, 'update');
      if (htmlChanged) {
        await deps.queue.send({ bookmarkId: existing.id, userId: auth.userId, action: 'process' });
      }

      const bookmark: Bookmark = {
        id: existing.id,
        userId: auth.userId,
        url: body.url,
        title,
        html,
        markdown: null,
        status: nextStatus as Bookmark['status'],
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        tags: await getBookmarkTags(deps, existing.id),
      };
      return c.json(bookmark);
    }

    const html = incomingHtml;

    await deps.db.prepare('INSERT INTO bookmarks (id, user_id, url, title, html, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'pending\', ?, ?)').bind(id, auth.userId, body.url, title, html, timestamp, timestamp).run();
    await logSync(deps, auth.userId, 'bookmark', id, 'create');
    await deps.queue.send({ bookmarkId: id, userId: auth.userId, action: 'process' });

    const bookmark: Bookmark = {
      id,
      userId: auth.userId,
      url: body.url,
      title,
      html,
      markdown: null,
      status: 'pending',
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      tags: [],
    };
    return c.json(bookmark, 201);
  });

  // GET /api/v1/bookmarks - List bookmarks
  bookmarks.get('/', async (c) => {
    const auth = getAuth(c);
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = Math.min(parseInt(c.req.query('pageSize') || '50', 10), 100);
    const offset = (page - 1) * pageSize;

    const countResult = await deps.db.prepare<{ count: number }>('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL').bind(auth.userId).first();
    const total = countResult?.count ?? 0;

    const rows = await deps.db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(auth.userId, pageSize, offset).all() as Record<string, unknown>[];

    const bookmarkIds = rows.map(row => row.id as string);
    const tagsByBookmarkId = await getBookmarkTagsBatch(deps, bookmarkIds);

    const bookmarkList: Bookmark[] = rows.map(row =>
      rowToBookmark(row, tagsByBookmarkId.get(row.id as string) ?? [])
    );

    const response: BookmarkListResponse = {
      bookmarks: bookmarkList,
      total,
      page,
      pageSize,
      hasMore: offset + bookmarkList.length < total,
    };

    return c.json(response);
  });

  // POST /api/v1/bookmarks/reprocess - Queue all bookmarks for reprocessing
  bookmarks.post('/reprocess', async (c) => {
    const auth = getAuth(c);

    const rows = await deps.db.prepare<{ id: string }>('SELECT id FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL').bind(auth.userId).all();

    const messages = rows.map(row => ({ bookmarkId: row.id, userId: auth.userId, action: 'reprocess' as const }));
    await deps.queue.sendBatch(messages);

    return c.json({ queued: rows.length });
  });

  // GET /api/v1/bookmarks/:id - Get single bookmark with full content
  bookmarks.get('/:id', async (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');

    const row = await deps.db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').bind(id, auth.userId).first() as Record<string, unknown> | null;

    if (!row) {
      return c.json({ error: 'Bookmark not found' }, 404);
    }

    const bookmark = rowToBookmark(row, await getBookmarkTags(deps, id));

    const qaPairs = await deps.db.prepare<{ id: string; question: string; answer: string; created_at: string }>(`
      SELECT id, question, answer, created_at
      FROM questions_answers
      WHERE bookmark_id = ?
      ORDER BY created_at ASC
    `).bind(id).all();

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

    const existing = await deps.db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').bind(id, auth.userId).first() as Record<string, unknown> | null;

    if (!existing) {
      return c.json({ error: 'Bookmark not found' }, 404);
    }

    const timestamp = now();
    const updates: string[] = [];
    const values: (string | number | null | Uint8Array)[] = [];
    let htmlChanged = false;

    if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
    if (body.html !== undefined) {
      const { value, changed } = preserveHtml(body.html, existing.html as string | null);
      htmlChanged = changed;
      if (changed) {
        updates.push('html = ?'); values.push(value);
        updates.push('status = \'pending\'');
      }
    }
    if (body.markdown !== undefined) { updates.push('markdown = ?'); values.push(body.markdown); }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(timestamp);
      values.push(id);
      await deps.db.prepare(`UPDATE bookmarks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    }

    if (body.tags !== undefined) {
      await deps.db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').bind(id).run();
      if (body.tags.length > 0) {
        const tagInserts = body.tags.map(tag =>
          deps.db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').bind(id, tag.toLowerCase(), timestamp)
        );
        await deps.db.batch(tagInserts);
      }
    }

    await logSync(deps, auth.userId, 'bookmark', id, 'update');

    if (htmlChanged) {
      await deps.queue.send({ bookmarkId: id, userId: auth.userId, action: 'process' });
    }

    const row = await deps.db.prepare('SELECT * FROM bookmarks WHERE id = ?').bind(id).first() as Record<string, unknown>;
    return c.json(rowToBookmark(row, await getBookmarkTags(deps, id)));
  });

  // DELETE /api/v1/bookmarks/:id - Delete bookmark
  bookmarks.delete('/:id', async (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');

    const existing = await deps.db.prepare<{ id: string }>('SELECT id FROM bookmarks WHERE id = ? AND user_id = ?').bind(id, auth.userId).first();

    if (!existing) {
      return c.json({ error: 'Bookmark not found' }, 404);
    }

    const timestamp = now();
    await deps.db.prepare('UPDATE bookmarks SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(timestamp, timestamp, id).run();
    await logSync(deps, auth.userId, 'bookmark', id, 'delete');

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

    const existing = await deps.db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, auth.userId).first() as Record<string, unknown> | null;

    if (!existing) {
      return c.json({ error: 'Bookmark not found' }, 404);
    }

    const tagName = body.tag.trim().toLowerCase();
    const timestamp = now();

    const result = await deps.db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_name, added_at) VALUES (?, ?, ?)').bind(id, tagName, timestamp).run();
    if (result.changes > 0) {
      await deps.db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').bind(timestamp, id).run();
      await logSync(deps, auth.userId, 'bookmark', id, 'update');
    }

    return c.json(rowToBookmark(existing, await getBookmarkTags(deps, id)));
  });

  // DELETE /api/v1/bookmarks/:id/tags/:tag - Remove tag
  bookmarks.delete('/:id/tags/:tag', async (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');
    const tagName = decodeURIComponent(c.req.param('tag'));

    const existing = await deps.db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, auth.userId).first() as Record<string, unknown> | null;

    if (!existing) {
      return c.json({ error: 'Bookmark not found' }, 404);
    }

    const timestamp = now();
    await deps.db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_name = ?').bind(id, tagName.toLowerCase()).run();
    await deps.db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').bind(timestamp, id).run();
    await logSync(deps, auth.userId, 'bookmark', id, 'update');

    const row = await deps.db.prepare('SELECT * FROM bookmarks WHERE id = ?').bind(id).first() as Record<string, unknown>;
    return c.json(rowToBookmark(row, await getBookmarkTags(deps, id)));
  });

  return bookmarks;
}
