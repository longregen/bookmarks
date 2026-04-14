import { db } from './schema';

export interface TableBreakdown {
  name: string;
  rows: number;
  estBytes: number;
}

export interface StorageBreakdown {
  perTable: TableBreakdown[];
  browserQuota: { usage: number; quota: number } | null;
  legacy: {
    totalBookmarks: number;
    withMarkdown: number;
    withQa: number;
    withSummary: number;
    totalQaPairs: number;
  };
}

const SAMPLE_SIZE = 20;
const CACHE_TTL_MS = 30_000;

let cached: { at: number; data: StorageBreakdown } | null = null;

async function estimateTableBytes<T>(table: { count: () => Promise<number>; limit: (n: number) => { toArray: () => Promise<T[]> } }): Promise<{ rows: number; estBytes: number }> {
  const rows = await table.count();
  if (rows === 0) return { rows, estBytes: 0 };
  const sample = await table.limit(Math.min(SAMPLE_SIZE, rows)).toArray();
  if (sample.length === 0) return { rows, estBytes: 0 };
  let total = 0;
  for (const row of sample) {
    try {
      total += JSON.stringify(row).length * 2;
    } catch {
      // ignore cycles
    }
  }
  const mean = total / sample.length;
  return { rows, estBytes: Math.round(mean * rows) };
}

export async function getStorageBreakdown(opts?: { force?: boolean }): Promise<StorageBreakdown> {
  if (opts?.force !== true && cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const tables: { name: string; ref: typeof db.bookmarks }[] = [
    { name: 'bookmarks', ref: db.bookmarks as unknown as typeof db.bookmarks },
    { name: 'markdown', ref: db.markdown as unknown as typeof db.bookmarks },
    { name: 'questionsAnswers', ref: db.questionsAnswers as unknown as typeof db.bookmarks },
    { name: 'summaries', ref: db.summaries as unknown as typeof db.bookmarks },
    { name: 'bookmarkTags', ref: db.bookmarkTags as unknown as typeof db.bookmarks },
    { name: 'jobs', ref: db.jobs as unknown as typeof db.bookmarks },
    { name: 'jobItems', ref: db.jobItems as unknown as typeof db.bookmarks },
    { name: 'searchHistory', ref: db.searchHistory as unknown as typeof db.bookmarks },
  ];

  const perTable = await Promise.all(tables.map(async ({ name, ref }) => ({
    name,
    ...(await estimateTableBytes(ref)),
  })));

  let browserQuota: { usage: number; quota: number } | null = null;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.storage !== 'undefined' && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && typeof est.quota === 'number') {
        browserQuota = { usage: est.usage, quota: est.quota };
      }
    }
  } catch {
    // ignore
  }

  const [
    totalBookmarks,
    markdownKeys,
    qaKeys,
    totalQaPairs,
    summaryKeys,
  ] = await Promise.all([
    db.bookmarks.count(),
    db.markdown.orderBy('bookmarkId').uniqueKeys(),
    db.questionsAnswers.orderBy('bookmarkId').uniqueKeys(),
    db.questionsAnswers.count(),
    db.summaries.orderBy('bookmarkId').uniqueKeys(),
  ]);

  const data: StorageBreakdown = {
    perTable,
    browserQuota,
    legacy: {
      totalBookmarks,
      withMarkdown: markdownKeys.length,
      withQa: qaKeys.length,
      withSummary: summaryKeys.length,
      totalQaPairs,
    },
  };

  cached = { at: Date.now(), data };
  return data;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
