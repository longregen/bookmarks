import { Hono } from '@hono/hono';
import type { AppDependencies, AppVariables } from '../app.ts';
import { createAuthMiddleware, getAuth } from '../middleware/auth.app.ts';
import type { Bookmark, SearchResponse, SemanticSearchRequest, SemanticSearchResponse } from '../types/index.ts';
import { getBookmarkTagsBatch, rowToBookmark } from '../utils/bookmark-helpers.ts';

async function getEmbedding(deps: AppDependencies, text: string): Promise<Float32Array> {
  const OPENAI_API_BASE = deps.env.get('OPENAI_API_BASE') || 'https://api.openai.com/v1';
  const OPENAI_API_KEY = deps.env.get('OPENAI_API_KEY');
  const EMBEDDING_MODEL = deps.env.get('EMBEDDING_MODEL') || 'text-embedding-3-small';

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  interface EmbeddingResponse {
    data: { embedding: number[] }[];
  }
  const data = await response.json() as EmbeddingResponse;

  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid embedding response');
  }

  return new Float32Array(data.data[0].embedding);
}

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

export function createSearchRoutes(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const search = new Hono<{ Variables: AppVariables }>();

  search.use('/*', createAuthMiddleware(deps));

  // GET /api/v1/search - Full-text search
  search.get('/', async (c) => {
    const auth = getAuth(c);
    const query = c.req.query('q');
    const pageParam = c.req.query('page');
    const pageSizeParam = c.req.query('pageSize');
    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(pageSizeParam || '50', 10) || 50), 100);
    const offset = (page - 1) * pageSize;

    if (!query?.trim()) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    const ftsQuery = query.trim().split(/\s+/).map(term => `"${term.replace(/"/g, '""')}"*`).join(' ');

    const matchingIds = await deps.db.prepare<{ id: string }>(`
      SELECT b.id FROM bookmarks_fts fts
      JOIN bookmarks b ON fts.rowid = b.rowid
      WHERE bookmarks_fts MATCH ? AND b.user_id = ? AND b.deleted_at IS NULL
      ORDER BY rank LIMIT ? OFFSET ?
    `).bind(ftsQuery, auth.userId, pageSize, offset).all();

    const countResult = await deps.db.prepare<{ count: number }>(`
      SELECT COUNT(*) as count FROM bookmarks_fts fts
      JOIN bookmarks b ON fts.rowid = b.rowid
      WHERE bookmarks_fts MATCH ? AND b.user_id = ? AND b.deleted_at IS NULL
    `).bind(ftsQuery, auth.userId).first();

    const bookmarkIds = matchingIds.map(r => r.id);
    let results: Bookmark[] = [];

    if (bookmarkIds.length > 0) {
      const placeholders = bookmarkIds.map(() => '?').join(', ');
      const rows = await deps.db.prepare(
        `SELECT * FROM bookmarks WHERE id IN (${placeholders})`
      ).bind(...bookmarkIds).all() as Record<string, unknown>[];

      const rowsById = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        rowsById.set(row.id as string, row);
      }

      const tagsByBookmarkId = await getBookmarkTagsBatch(deps, bookmarkIds);

      results = bookmarkIds
        .map(id => {
          const row = rowsById.get(id);
          if (!row) return null;
          return rowToBookmark(row, tagsByBookmarkId.get(id) ?? []);
        })
        .filter((b): b is Bookmark => b !== null);
    }

    const response: SearchResponse = {
      results,
      total: countResult?.count ?? 0,
      page,
      pageSize,
      hasMore: offset + results.length < (countResult?.count ?? 0),
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

    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await getEmbedding(deps, body.query);
    } catch (error) {
      console.error('Failed to get embedding:', error);
      return c.json({ error: 'Failed to process query' }, 500);
    }

    const qaRows = await deps.db.prepare<{
      id: string;
      bookmark_id: string;
      embedding_both: Uint8Array | null;
      embedding_question: Uint8Array | null;
    }>(`
      SELECT qa.id, qa.bookmark_id, qa.embedding_both, qa.embedding_question
      FROM questions_answers qa
      JOIN bookmarks b ON qa.bookmark_id = b.id
      WHERE b.user_id = ? AND b.deleted_at IS NULL
        AND (qa.embedding_both IS NOT NULL OR qa.embedding_question IS NOT NULL)
    `).bind(auth.userId).all();

    const scoresByBookmark = new Map<string, number>();

    for (const row of qaRows) {
      const embedding = row.embedding_both || row.embedding_question;
      if (!embedding) continue;

      const embeddingArray = new Float32Array(
        embedding.buffer,
        embedding.byteOffset,
        embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      const score = cosineSimilarity(queryEmbedding, embeddingArray);

      const existingScore = scoresByBookmark.get(row.bookmark_id);
      if (existingScore === undefined || score > existingScore) {
        scoresByBookmark.set(row.bookmark_id, score);
      }
    }

    const scoredResults = Array.from(scoresByBookmark.entries()).map(
      ([bookmarkId, score]) => ({ bookmarkId, score })
    );

    scoredResults.sort((a, b) => b.score - a.score);
    const topResults = scoredResults.slice(0, limit);

    const topBookmarkIds = topResults.map(r => r.bookmarkId);
    let results: { bookmark: Bookmark; score: number }[] = [];

    if (topBookmarkIds.length > 0) {
      const placeholders = topBookmarkIds.map(() => '?').join(', ');
      const rows = await deps.db.prepare(
        `SELECT * FROM bookmarks WHERE id IN (${placeholders})`
      ).bind(...topBookmarkIds).all() as Record<string, unknown>[];

      const rowsById = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        rowsById.set(row.id as string, row);
      }

      const tagsByBookmarkId = await getBookmarkTagsBatch(deps, topBookmarkIds);

      results = topResults
        .map(({ bookmarkId, score }) => {
          const row = rowsById.get(bookmarkId);
          if (!row) return null;
          return { bookmark: rowToBookmark(row, tagsByBookmarkId.get(bookmarkId) ?? []), score };
        })
        .filter((r): r is { bookmark: Bookmark; score: number } => r !== null);
    }

    const response: SemanticSearchResponse = { results };
    return c.json(response);
  });

  return search;
}
