import { Hono } from '@hono/hono';
import { getDatabase } from '../db/database.ts';
import { authMiddleware, getAuth } from '../middleware/auth.ts';
import { getBookmarkTags, rowToBookmark } from '../utils/bookmark-helpers.ts';
import { getEmbedding } from '../services/embeddings.ts';
import type { Bookmark, SearchResponse, SemanticSearchRequest, SemanticSearchResponse } from '../types/index.ts';

const search = new Hono();

search.use('/*', authMiddleware);

// GET /api/v1/search - Full-text search
search.get('/', (c) => {
  const auth = getAuth(c);
  const query = c.req.query('q');
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '50', 10), 100);
  const offset = (page - 1) * pageSize;

  if (!query?.trim()) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const db = getDatabase();
  const ftsQuery = query.trim().split(/\s+/).map(term => `"${term}"*`).join(' ');

  const matchingIds = db.prepare(`
    SELECT b.id FROM bookmarks_fts fts
    JOIN bookmarks b ON fts.rowid = b.rowid
    WHERE bookmarks_fts MATCH ? AND b.user_id = ? AND b.deleted_at IS NULL
    ORDER BY rank LIMIT ? OFFSET ?
  `).all(ftsQuery, auth.userId, pageSize, offset) as { id: string }[];

  const countResult = db.prepare(`
    SELECT COUNT(*) as count FROM bookmarks_fts fts
    JOIN bookmarks b ON fts.rowid = b.rowid
    WHERE bookmarks_fts MATCH ? AND b.user_id = ? AND b.deleted_at IS NULL
  `).get(ftsQuery, auth.userId) as { count: number };

  const results: Bookmark[] = matchingIds.map(({ id }) => {
    const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as Record<string, unknown>;
    return rowToBookmark(row, getBookmarkTags(db, id));
  });

  const response: SearchResponse = {
    results,
    total: countResult.count,
    page,
    pageSize,
    hasMore: offset + results.length < countResult.count,
  };

  return c.json(response);
});

// POST /api/v1/search/semantic - Vector search
search.post('/semantic', async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json() as SemanticSearchRequest;

  if (!body.query?.trim()) {
    return c.json({ error: 'Query is required' }, 400);
  }

  const limit = Math.min(body.limit || 10, 50);
  const db = getDatabase();

  let queryEmbedding: Float32Array;
  try {
    queryEmbedding = await getEmbedding(body.query);
  } catch (error) {
    console.error('Failed to get embedding:', error);
    return c.json({ error: 'Failed to process query' }, 500);
  }

  const qaRows = db.prepare(`
    SELECT qa.id, qa.bookmark_id, qa.embedding_both, qa.embedding_question
    FROM questions_answers qa
    JOIN bookmarks b ON qa.bookmark_id = b.id
    WHERE b.user_id = ? AND b.deleted_at IS NULL
      AND (qa.embedding_both IS NOT NULL OR qa.embedding_question IS NOT NULL)
  `).all(auth.userId) as { id: string; bookmark_id: string; embedding_both: Uint8Array | null; embedding_question: Uint8Array | null }[];

  const scoredResults: { bookmarkId: string; score: number }[] = [];
  const seenBookmarks = new Set<string>();

  for (const row of qaRows) {
    const embedding = row.embedding_both || row.embedding_question;
    if (!embedding) continue;

    const embeddingArray = new Float32Array(embedding.buffer);
    const score = cosineSimilarity(queryEmbedding, embeddingArray);

    if (!seenBookmarks.has(row.bookmark_id)) {
      seenBookmarks.add(row.bookmark_id);
      scoredResults.push({ bookmarkId: row.bookmark_id, score });
    } else {
      const existing = scoredResults.find(r => r.bookmarkId === row.bookmark_id);
      if (existing && score > existing.score) {
        existing.score = score;
      }
    }
  }

  scoredResults.sort((a, b) => b.score - a.score);
  const topResults = scoredResults.slice(0, limit);

  const results = topResults.map(({ bookmarkId, score }) => {
    const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmarkId) as Record<string, unknown>;
    return { bookmark: rowToBookmark(row, getBookmarkTags(db, bookmarkId)), score };
  });

  const response: SemanticSearchResponse = { results };
  return c.json(response);
});

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export default search;
