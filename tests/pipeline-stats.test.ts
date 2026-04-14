import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/schema';
import { getPipelineStages, getFailureList, getPipelineTotals } from '../src/lib/pipeline-stats';

describe('pipeline-stats', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
  });

  async function seed(id: string, status: 'fetching' | 'downloaded' | 'pending' | 'processing' | 'complete' | 'error', errorMessage?: string): Promise<void> {
    const now = new Date();
    await db.bookmarks.add({
      id,
      url: `https://example.com/${id}`,
      title: `T-${id}`,
      html: '',
      status,
      errorMessage,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  it('groups status counts into stage buckets (pending+processing collapse)', async () => {
    await seed('a', 'fetching');
    await seed('b', 'downloaded');
    await seed('c', 'pending');
    await seed('d', 'processing');
    await seed('e', 'complete');
    await seed('f', 'error', 'boom');

    const stages = await getPipelineStages({ recentLimit: 5 });
    const byKey = Object.fromEntries(stages.map(s => [s.key, s.count]));
    expect(byKey.fetching).toBe(1);
    expect(byKey.downloaded).toBe(1);
    expect(byKey.processing).toBe(2);
    expect(byKey.complete).toBe(1);
    expect(byKey.error).toBe(1);
  });

  it('returns failures enriched with hostname and error', async () => {
    await seed('x', 'error', 'kaboom');
    const failures = await getFailureList(10);
    expect(failures).toHaveLength(1);
    expect(failures[0].hostname).toBe('example.com');
    expect(failures[0].errorMessage).toBe('kaboom');
  });

  it('pipeline totals report inflight excluding complete/error', async () => {
    await seed('a', 'fetching');
    await seed('b', 'complete');
    await seed('c', 'error', 'e');
    const totals = await getPipelineTotals();
    expect(totals.inflight).toBe(1);
    expect(totals.complete).toBe(1);
    expect(totals.error).toBe(1);
    expect(totals.total).toBe(3);
  });
});
