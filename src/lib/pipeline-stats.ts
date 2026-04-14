import { db, type Bookmark } from '../db/schema';
import { getHostname } from './url-validator';

export type PipelineStageKey = 'fetching' | 'downloaded' | 'processing' | 'complete' | 'error';

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  statuses: Bookmark['status'][];
  count: number;
  recent: Pick<Bookmark, 'id' | 'url' | 'title' | 'updatedAt'>[];
}

export interface FailureRow {
  id: string;
  url: string;
  title: string;
  hostname: string;
  errorMessage: string;
  retryCount: number;
  updatedAt: Date;
}

const STAGE_DEFS: { key: PipelineStageKey; label: string; statuses: Bookmark['status'][] }[] = [
  { key: 'fetching', label: 'Fetching', statuses: ['fetching'] },
  { key: 'downloaded', label: 'Downloaded', statuses: ['downloaded'] },
  { key: 'processing', label: 'Processing', statuses: ['pending', 'processing'] },
  { key: 'complete', label: 'Complete', statuses: ['complete'] },
  { key: 'error', label: 'Error', statuses: ['error'] },
];

export async function getPipelineStages(opts?: { recentLimit?: number }): Promise<PipelineStage[]> {
  const recentLimit = opts?.recentLimit ?? 5;

  const results = await Promise.all(STAGE_DEFS.map(async (def) => {
    const count = await db.bookmarks.where('status').anyOf(def.statuses).count();
    let recent: Pick<Bookmark, 'id' | 'url' | 'title' | 'updatedAt'>[] = [];
    if (recentLimit > 0 && count > 0 && def.key !== 'complete') {
      const rows = await db.bookmarks
        .where('status').anyOf(def.statuses)
        .reverse().sortBy('updatedAt');
      recent = rows.slice(0, recentLimit).map(b => ({
        id: b.id, url: b.url, title: b.title, updatedAt: b.updatedAt,
      }));
    }
    return { ...def, count, recent };
  }));

  return results;
}

export async function getFailureList(limit = 100): Promise<FailureRow[]> {
  const rows = await db.bookmarks.where('status').equals('error')
    .reverse().sortBy('updatedAt');
  return rows.slice(0, limit).map(b => ({
    id: b.id,
    url: b.url,
    title: b.title || b.url,
    hostname: getHostname(b.url),
    errorMessage: b.errorMessage ?? '',
    retryCount: b.retryCount ?? 0,
    updatedAt: b.updatedAt,
  }));
}

export async function getPipelineTotals(): Promise<{
  inflight: number;
  complete: number;
  error: number;
  total: number;
}> {
  const [fetching, downloaded, pending, processing, complete, error] = await Promise.all([
    db.bookmarks.where('status').equals('fetching').count(),
    db.bookmarks.where('status').equals('downloaded').count(),
    db.bookmarks.where('status').equals('pending').count(),
    db.bookmarks.where('status').equals('processing').count(),
    db.bookmarks.where('status').equals('complete').count(),
    db.bookmarks.where('status').equals('error').count(),
  ]);
  const inflight = fetching + downloaded + pending + processing;
  return { inflight, complete, error, total: inflight + complete + error };
}
