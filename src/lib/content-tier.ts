import { db } from '../db/schema';
import { getSettings, saveSetting } from './settings';
import { events } from './events';
import type { ContentTier } from './platform';

export type { ContentTier } from './platform';

const TOUCH_DEBOUNCE_MS = 30_000;
const recentTouches = new Map<string, number>();
let lastEvictionInfo: { at: number; rowsFreed: number } | null = null;

export async function getContentTier(): Promise<ContentTier> {
  const settings = await getSettings();
  return settings.contentTier;
}

export async function getMarkdownCacheCapBytes(): Promise<number> {
  const settings = await getSettings();
  return Math.max(1, settings.markdownCacheCapMB) * 1024 * 1024;
}

export async function getMarkdownCacheStats(): Promise<{
  bytes: number;
  capBytes: number;
  rowCount: number;
  lastEviction: { at: number; rowsFreed: number } | null;
}> {
  const [settings, rowCount] = await Promise.all([
    getSettings(),
    db.markdown.count(),
  ]);
  return {
    bytes: settings.markdownCacheBytes,
    capBytes: Math.max(1, settings.markdownCacheCapMB) * 1024 * 1024,
    rowCount,
    lastEviction: lastEvictionInfo,
  };
}

export async function touchMarkdown(bookmarkId: string): Promise<void> {
  const now = Date.now();
  const prev = recentTouches.get(bookmarkId) ?? 0;
  if (now - prev < TOUCH_DEBOUNCE_MS) return;
  recentTouches.set(bookmarkId, now);

  const row = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
  if (!row) return;
  await db.markdown.update(row.id, { lastAccessedAt: new Date(now) });
}

export function estimateMarkdownBytes(content: string): number {
  return content.length * 2; // UTF-16 code unit approximation
}

export async function recalcMarkdownCacheBytes(): Promise<number> {
  let total = 0;
  await db.markdown.each(row => {
    total += row.sizeBytes ?? estimateMarkdownBytes(row.content);
  });
  await saveSetting('markdownCacheBytes', total);
  return total;
}

// Serializes read-modify-write of `markdownCacheBytes` so concurrent
// `cacheBookmarkContent` + `maybeEvictMarkdownLRU` calls don't clobber each
// other's deltas. A Dexie transaction can't span the settings write cleanly
// (saveSetting goes through the platform adapter which may hit chrome.storage
// on web builds), so we fall back to a module-level promise chain.
let cacheBytesTail: Promise<void> = Promise.resolve();

export function applyCacheBytesDelta(delta: number): Promise<void> {
  const prev = cacheBytesTail;
  const run = (async () => {
    await prev.catch(() => undefined);
    const fresh = await getSettings();
    const newTotal = Math.max(0, fresh.markdownCacheBytes + delta);
    await saveSetting('markdownCacheBytes', newTotal);
  })();
  cacheBytesTail = run.catch(() => undefined);
  return run;
}

export async function maybeEvictMarkdownLRU(): Promise<{ evicted: number; freedBytes: number }> {
  const capBytes = await getMarkdownCacheCapBytes();
  const settings = await getSettings();
  let currentBytes = settings.markdownCacheBytes;

  if (currentBytes <= 0) {
    currentBytes = await recalcMarkdownCacheBytes();
  }
  if (currentBytes <= capBytes) {
    return { evicted: 0, freedBytes: 0 };
  }

  const rows = await db.markdown.orderBy('lastAccessedAt').toArray();
  let freed = 0;
  const toDelete: string[] = [];
  for (const row of rows) {
    if (currentBytes - freed <= capBytes) break;
    const rowBytes = row.sizeBytes ?? estimateMarkdownBytes(row.content);
    toDelete.push(row.id);
    freed += rowBytes;
  }
  if (toDelete.length === 0) return { evicted: 0, freedBytes: 0 };

  await db.markdown.bulkDelete(toDelete);
  await applyCacheBytesDelta(-freed);
  lastEvictionInfo = { at: Date.now(), rowsFreed: toDelete.length };
  await events.tier.evicted(toDelete.length, freed);
  return { evicted: toDelete.length, freedBytes: freed };
}

export interface TierTransitionPlan {
  from: ContentTier;
  to: ContentTier;
  markdownRowsToDelete: number;
  markdownBytesToDelete: number;
  qaRowsToDelete: number;
  summaryRowsToDelete: number;
  embeddingsPreserved: number;
  blockedByPendingQueue: boolean;
  /**
   * True when the requested transition is a downgrade and the user has
   * never completed a successful sync. Downgrading in that state would
   * orphan local-only bookmarks — the caller must refuse or force a sync
   * first. Supersedes the narrower `blockedByPendingQueue` check when
   * both would apply.
   */
  requiresSuccessfulSync: boolean;
}

export async function planTierTransition(to: ContentTier): Promise<TierTransitionPlan> {
  const settings = await getSettings();
  const from = settings.contentTier;
  const isDowngrade = tierRank(to) > tierRank(from);

  let markdownRowsToDelete = 0;
  let markdownBytesToDelete = 0;
  let qaRowsToDelete = 0;
  let summaryRowsToDelete = 0;
  let embeddingsPreserved = 0;

  if (isDowngrade) {
    if (tierRank(to) >= tierRank('summaries')) {
      const markdownRows = await db.markdown.toArray();
      markdownRowsToDelete = markdownRows.length;
      markdownBytesToDelete = markdownRows.reduce(
        (sum, r) => sum + (r.sizeBytes ?? estimateMarkdownBytes(r.content)),
        0,
      );
      qaRowsToDelete = await db.questionsAnswers.count();
    }
    if (tierRank(to) >= tierRank('titles')) {
      summaryRowsToDelete = await db.summaries.count();
    } else {
      embeddingsPreserved = (await db.summaries.count())
        + (await db.questionsAnswers.count());
    }
  }

  const blockedByPendingQueue = isDowngrade && (await countPendingQueueChanges()) > 0;
  const requiresSuccessfulSync = isDowngrade && settings.serverLastSyncTime === '';

  return {
    from,
    to,
    markdownRowsToDelete,
    markdownBytesToDelete,
    qaRowsToDelete,
    summaryRowsToDelete,
    embeddingsPreserved,
    blockedByPendingQueue,
    requiresSuccessfulSync,
  };
}

export async function enterTier(
  to: ContentTier,
  opts?: { onProgress?: (pct: number) => void },
): Promise<void> {
  const plan = await planTierTransition(to);
  if (plan.requiresSuccessfulSync) {
    throw new Error(
      'Cannot downgrade content tier before a successful sync — your local bookmarks would be the only copy.',
    );
  }
  if (plan.blockedByPendingQueue) {
    throw new Error('Cannot change tier while offline sync queue has pending changes.');
  }
  if (plan.from === to) return;

  const isDowngrade = tierRank(to) > tierRank(plan.from);
  const isUpgrade = tierRank(to) < tierRank(plan.from);

  opts?.onProgress?.(0);

  if (isDowngrade) {
    if (tierRank(to) >= tierRank('summaries')) {
      await db.transaction('rw', [db.markdown, db.questionsAnswers], async () => {
        await db.markdown.clear();
        await db.questionsAnswers.clear();
      });
    }
    opts?.onProgress?.(50);
    if (tierRank(to) >= tierRank('titles')) {
      await db.summaries.clear();
    }
    await saveSetting('markdownCacheBytes', 0);
  }

  await saveSetting('contentTier', to);
  await saveSetting('contentTierMigrationAt', new Date().toISOString());
  opts?.onProgress?.(75);

  if (isUpgrade) {
    // Pull back what the previous downgrade discarded. Best-effort: if the
    // sync fails the user still ends up on the new tier; content will
    // lazy-load on next view.
    try {
      const { serverSync } = await import('./server-sync');
      await serverSync.fullSync();
    } catch (error) {
      console.warn('Tier upgrade repopulation failed:', error);
    }
  }

  opts?.onProgress?.(100);
  await events.tier.changed(plan.from, to);
}

function tierRank(t: ContentTier): number {
  if (t === 'full') return 0;
  if (t === 'summaries') return 1;
  return 2;
}

async function countPendingQueueChanges(): Promise<number> {
  try {
    const { serverSync } = await import('./server-sync');
    const status = await serverSync.getSyncStatus();
    return status.pendingChanges;
  } catch {
    // server-sync may be unavailable in some contexts (e.g. web)
  }
  return 0;
}
