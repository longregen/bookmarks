import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobItemStatus } from '../src/db/schema';
import { resumeIncompleteJobs } from '../src/background/job-resumption';

describe('resumeIncompleteJobs', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobItems.clear();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobItems.clear();
  });

  it('should reset processing bookmarks to downloaded', async () => {
    await db.bookmarks.bulkAdd([
      {
        id: 'stuck-1',
        url: 'https://example.com/1',
        title: 'Stuck 1',
        html: '<html></html>',
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'stuck-2',
        url: 'https://example.com/2',
        title: 'Stuck 2',
        html: '<html></html>',
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await resumeIncompleteJobs();

    const b1 = await db.bookmarks.get('stuck-1');
    const b2 = await db.bookmarks.get('stuck-2');
    expect(b1?.status).toBe('downloaded');
    expect(b2?.status).toBe('downloaded');
  });

  it('should not modify bookmarks in other states', async () => {
    await db.bookmarks.bulkAdd([
      {
        id: 'pending-1',
        url: 'https://example.com/1',
        title: 'Pending',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'complete-1',
        url: 'https://example.com/2',
        title: 'Complete',
        html: '<html></html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await resumeIncompleteJobs();

    const pending = await db.bookmarks.get('pending-1');
    const complete = await db.bookmarks.get('complete-1');
    expect(pending?.status).toBe('pending');
    expect(complete?.status).toBe('complete');
  });

  it('should reset IN_PROGRESS job items to PENDING', async () => {
    await db.jobItems.bulkAdd([
      {
        id: 'item-1',
        jobId: 'job-1',
        bookmarkId: 'bm-1',
        status: JobItemStatus.IN_PROGRESS,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'item-2',
        jobId: 'job-1',
        bookmarkId: 'bm-2',
        status: JobItemStatus.IN_PROGRESS,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await resumeIncompleteJobs();

    const item1 = await db.jobItems.get('item-1');
    const item2 = await db.jobItems.get('item-2');
    expect(item1?.status).toBe(JobItemStatus.PENDING);
    expect(item2?.status).toBe(JobItemStatus.PENDING);
  });

  it('should not modify job items in other states', async () => {
    await db.jobItems.add({
      id: 'item-done',
      jobId: 'job-1',
      bookmarkId: 'bm-1',
      status: JobItemStatus.COMPLETE,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await resumeIncompleteJobs();

    const item = await db.jobItems.get('item-done');
    expect(item?.status).toBe(JobItemStatus.COMPLETE);
  });

  it('should handle empty database gracefully', async () => {
    await expect(resumeIncompleteJobs()).resolves.toBeUndefined();
  });
});
