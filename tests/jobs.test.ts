import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobType, JobStatus, JobItemStatus } from '../src/db/schema';
import {
  createJob,
  getRecentJobs,
  deleteJob,
  deleteBookmarkWithData,
  createJobItems,
  getJobItems,
  getJobItemByBookmark,
  updateJobItem,
  updateJobItemByBookmark,
  getJobStats,
  updateJobStatus,
  retryFailedJobItems,
  retryBookmark,
} from '../src/lib/jobs';

describe('Jobs Library', () => {
  beforeEach(async () => {
    await db.jobs.clear();
  });

  afterEach(async () => {
    await db.jobs.clear();
  });

  describe('createJob', () => {
    it('should create a job with required fields', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });

      expect(job.id).toBeDefined();
      expect(job.type).toBe(JobType.FILE_IMPORT);
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.metadata).toEqual({});
      expect(job.createdAt).toBeInstanceOf(Date);
    });

    it('should create a job with parentJobId', async () => {
      const parentJob = await createJob({
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.COMPLETED,
      });

      const childJob = await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: parentJob.id,
      });

      expect(childJob.parentJobId).toBe(parentJob.id);
    });

    it('should create a job with metadata', async () => {
      const metadata = {
        url: 'https://example.com',
        totalUrls: 10,
      };

      const job = await createJob({
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.COMPLETED,
        metadata,
      });

      expect(job.metadata).toEqual(metadata);
    });

    it('should persist job to database', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });

      const retrieved = await db.jobs.get(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(job.id);
    });
  });

  describe('getRecentJobs', () => {
    it('should return recent jobs with default limit', async () => {
      for (let i = 0; i < 5; i++) {
        await createJob({
          type: JobType.FILE_IMPORT,
          status: JobStatus.COMPLETED,
        });
      }

      const jobs = await getRecentJobs();
      expect(jobs.length).toBeLessThanOrEqual(100);
    });

    it('should respect custom limit', async () => {
      for (let i = 0; i < 10; i++) {
        await createJob({
          type: JobType.FILE_IMPORT,
          status: JobStatus.COMPLETED,
        });
      }

      const jobs = await getRecentJobs({ limit: 5 });
      expect(jobs).toHaveLength(5);
    });

    it('should filter by job type', async () => {
      await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED });
      await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.COMPLETED });
      await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED });

      const jobs = await getRecentJobs({ type: JobType.FILE_IMPORT });
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.type === JobType.FILE_IMPORT)).toBe(true);
    });

    it('should filter by job status', async () => {
      await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.PENDING });
      await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED });
      await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.PENDING });

      const jobs = await getRecentJobs({ status: JobStatus.PENDING });
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.status === JobStatus.PENDING)).toBe(true);
    });

    it('should filter by parentJobId', async () => {
      const parentJob = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.COMPLETED });

      await createJob({ type: JobType.URL_FETCH, status: JobStatus.COMPLETED, parentJobId: parentJob.id });
      await createJob({ type: JobType.URL_FETCH, status: JobStatus.COMPLETED, parentJobId: 'other-parent' });

      const jobs = await getRecentJobs({ parentJobId: parentJob.id });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].parentJobId).toBe(parentJob.id);
    });

    it('should return jobs ordered by creation date (newest first)', async () => {
      const job1 = await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED });
      await new Promise(resolve => setTimeout(resolve, 10));
      const job2 = await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED });

      const jobs = await getRecentJobs();
      expect(jobs[0].id).toBe(job2.id);
      expect(jobs[1].id).toBe(job1.id);
    });
  });

  describe('deleteJob', () => {
    it('should delete a job', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });

      await deleteJob(job.id);

      const retrieved = await db.jobs.get(job.id);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('deleteBookmarkWithData', () => {
    beforeEach(async () => {
      await db.bookmarks.clear();
      await db.markdown.clear();
      await db.questionsAnswers.clear();
      await db.bookmarkTags.clear();
      await db.jobItems.clear();
    });

    it('should delete bookmark and all related data', async () => {
      const bookmarkId = 'test-bookmark-1';
      const now = new Date();

      await db.bookmarks.add({
        id: bookmarkId,
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'complete',
        createdAt: now,
        updatedAt: now,
      });

      await db.markdown.add({
        id: 'md-1',
        bookmarkId,
        content: 'Test content',
        createdAt: now,
        updatedAt: now,
      });

      await db.questionsAnswers.add({
        id: 'qa-1',
        bookmarkId,
        question: 'Q?',
        answer: 'A',
        embeddingQuestion: [],
        embeddingAnswer: [],
        embeddingBoth: [],
        createdAt: now,
        updatedAt: now,
      });

      await db.bookmarkTags.add({
        bookmarkId,
        tagName: 'test',
        addedAt: now,
      });

      const job = await createJob({ type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED });
      await createJobItems(job.id, [bookmarkId]);

      await deleteBookmarkWithData(bookmarkId);

      expect(await db.bookmarks.get(bookmarkId)).toBeUndefined();
      expect(await db.markdown.where('bookmarkId').equals(bookmarkId).count()).toBe(0);
      expect(await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).count()).toBe(0);
      expect(await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).count()).toBe(0);
      expect(await db.jobItems.where('bookmarkId').equals(bookmarkId).count()).toBe(0);
    });
  });

  describe('JobItem management', () => {
    beforeEach(async () => {
      await db.jobItems.clear();
      await db.bookmarks.clear();
    });

    afterEach(async () => {
      await db.jobItems.clear();
      await db.bookmarks.clear();
    });

    describe('createJobItems', () => {
      it('should create multiple job items', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        const bookmarkIds = ['b1', 'b2', 'b3'];

        await createJobItems(job.id, bookmarkIds);

        const items = await getJobItems(job.id);
        expect(items).toHaveLength(3);
        expect(items.every(item => item.status === JobItemStatus.PENDING)).toBe(true);
        expect(items.every(item => item.retryCount === 0)).toBe(true);
      });
    });

    describe('getJobItems', () => {
      it('should get all items for a job', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1', 'b2']);

        const items = await getJobItems(job.id);
        expect(items).toHaveLength(2);
        expect(items.map(i => i.bookmarkId).sort()).toEqual(['b1', 'b2']);
      });
    });

    describe('getJobItemByBookmark', () => {
      it('should get job item by bookmark ID', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1', 'b2']);

        const item = await getJobItemByBookmark('b1');
        expect(item).toBeDefined();
        expect(item?.bookmarkId).toBe('b1');
      });

      it('should return undefined for non-existent bookmark', async () => {
        const item = await getJobItemByBookmark('non-existent');
        expect(item).toBeUndefined();
      });
    });

    describe('updateJobItem', () => {
      it('should update job item status', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1']);

        const item = await getJobItemByBookmark('b1');
        expect(item).toBeDefined();

        await updateJobItem(item!.id, { status: JobItemStatus.COMPLETE });

        const updated = await db.jobItems.get(item!.id);
        expect(updated?.status).toBe(JobItemStatus.COMPLETE);
      });
    });

    describe('updateJobItemByBookmark', () => {
      it('should update job item by bookmark ID', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1']);

        await updateJobItemByBookmark('b1', { status: JobItemStatus.ERROR, errorMessage: 'Failed' });

        const item = await getJobItemByBookmark('b1');
        expect(item?.status).toBe(JobItemStatus.ERROR);
        expect(item?.errorMessage).toBe('Failed');
      });

      it('should do nothing if bookmark does not exist', async () => {
        await updateJobItemByBookmark('non-existent', { status: JobItemStatus.COMPLETE });
        // Should not throw
      });
    });

    describe('getJobStats', () => {
      it('should return correct job statistics', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1', 'b2', 'b3', 'b4']);

        const item1 = await getJobItemByBookmark('b1');
        const item2 = await getJobItemByBookmark('b2');
        const item3 = await getJobItemByBookmark('b3');

        await updateJobItem(item1!.id, { status: JobItemStatus.COMPLETE });
        await updateJobItem(item2!.id, { status: JobItemStatus.ERROR });
        await updateJobItem(item3!.id, { status: JobItemStatus.IN_PROGRESS });

        const stats = await getJobStats(job.id);
        expect(stats.total).toBe(4);
        expect(stats.complete).toBe(1);
        expect(stats.error).toBe(1);
        expect(stats.inProgress).toBe(1);
        expect(stats.pending).toBe(1);
      });
    });

    describe('updateJobStatus', () => {
      it('should set job to COMPLETED when all items complete', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1', 'b2']);

        const item1 = await getJobItemByBookmark('b1');
        const item2 = await getJobItemByBookmark('b2');
        await updateJobItem(item1!.id, { status: JobItemStatus.COMPLETE });
        await updateJobItem(item2!.id, { status: JobItemStatus.COMPLETE });

        await updateJobStatus(job.id);

        const updatedJob = await db.jobs.get(job.id);
        expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
      });

      it('should set job to FAILED when all items have errors', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        await createJobItems(job.id, ['b1']);

        const item1 = await getJobItemByBookmark('b1');
        await updateJobItem(item1!.id, { status: JobItemStatus.ERROR });

        await updateJobStatus(job.id);

        const updatedJob = await db.jobs.get(job.id);
        expect(updatedJob?.status).toBe(JobStatus.FAILED);
      });

      it('should set job to IN_PROGRESS when items are pending', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.PENDING });
        await createJobItems(job.id, ['b1', 'b2']);

        await updateJobStatus(job.id);

        const updatedJob = await db.jobs.get(job.id);
        expect(updatedJob?.status).toBe(JobStatus.IN_PROGRESS);
      });

      it('should set job to COMPLETED when no items', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.PENDING });

        await updateJobStatus(job.id);

        const updatedJob = await db.jobs.get(job.id);
        expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
      });
    });

    describe('retryFailedJobItems', () => {
      it('should reset failed job items to pending', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.FAILED });
        const now = new Date();

        await db.bookmarks.add({
          id: 'b1',
          url: 'https://example.com/1',
          title: 'Test 1',
          html: '',
          status: 'error',
          errorMessage: 'Failed',
          createdAt: now,
          updatedAt: now,
        });

        await createJobItems(job.id, ['b1']);
        const item = await getJobItemByBookmark('b1');
        await updateJobItem(item!.id, { status: JobItemStatus.ERROR, errorMessage: 'Failed' });

        const count = await retryFailedJobItems(job.id);

        expect(count).toBe(1);

        const updatedItem = await getJobItemByBookmark('b1');
        expect(updatedItem?.status).toBe(JobItemStatus.PENDING);
        expect(updatedItem?.errorMessage).toBeUndefined();

        const updatedBookmark = await db.bookmarks.get('b1');
        expect(updatedBookmark?.status).toBe('fetching');
        expect(updatedBookmark?.errorMessage).toBeUndefined();
      });
    });

    describe('retryBookmark', () => {
      it('should reset a single bookmark and its job item', async () => {
        const job = await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS });
        const now = new Date();

        await db.bookmarks.add({
          id: 'b1',
          url: 'https://example.com/1',
          title: 'Test 1',
          html: '',
          status: 'error',
          errorMessage: 'Failed',
          retryCount: 3,
          createdAt: now,
          updatedAt: now,
        });

        await createJobItems(job.id, ['b1']);
        const item = await getJobItemByBookmark('b1');
        await updateJobItem(item!.id, { status: JobItemStatus.ERROR, errorMessage: 'Failed' });

        await retryBookmark('b1');

        const updatedBookmark = await db.bookmarks.get('b1');
        expect(updatedBookmark?.status).toBe('fetching');
        expect(updatedBookmark?.errorMessage).toBeUndefined();
        expect(updatedBookmark?.retryCount).toBe(0);

        const updatedItem = await getJobItemByBookmark('b1');
        expect(updatedItem?.status).toBe(JobItemStatus.PENDING);
      });

      it('should work for bookmarks without job items', async () => {
        const now = new Date();

        await db.bookmarks.add({
          id: 'b1',
          url: 'https://example.com/1',
          title: 'Test 1',
          html: '',
          status: 'error',
          errorMessage: 'Failed',
          createdAt: now,
          updatedAt: now,
        });

        await retryBookmark('b1');

        const updatedBookmark = await db.bookmarks.get('b1');
        expect(updatedBookmark?.status).toBe('fetching');
      });
    });
  });
});
