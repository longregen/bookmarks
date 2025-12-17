import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import {
  createJob,
  updateJob,
  completeJob,
  failJob,
  cancelJob,
  getJobsByBookmark,
  getJobsByParent,
  getActiveJobs,
  getRecentJobs,
  cleanupOldJobs,
  getJobStats,
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
        type: JobType.MANUAL_ADD,
      });

      expect(job.id).toBeDefined();
      expect(job.type).toBe(JobType.MANUAL_ADD);
      expect(job.status).toBe(JobStatus.PENDING);
      expect(job.progress).toBe(0);
      expect(job.metadata).toEqual({});
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
      expect(job.completedAt).toBeUndefined();
    });

    it('should create a job with custom status', async () => {
      const job = await createJob({
        type: JobType.MARKDOWN_GENERATION,
        status: JobStatus.IN_PROGRESS,
      });

      expect(job.status).toBe(JobStatus.IN_PROGRESS);
    });

    it('should create a job with bookmarkId', async () => {
      const bookmarkId = 'bookmark-123';
      const job = await createJob({
        type: JobType.QA_GENERATION,
        bookmarkId,
      });

      expect(job.bookmarkId).toBe(bookmarkId);
    });

    it('should create a job with parentJobId', async () => {
      const parentJob = await createJob({
        type: JobType.BULK_URL_IMPORT,
      });

      const childJob = await createJob({
        type: JobType.URL_FETCH,
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
        metadata,
      });

      expect(job.metadata).toEqual(metadata);
    });

    it('should create a job with progress and steps', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
        progress: 50,
        currentStep: 'Importing bookmarks',
        totalSteps: 100,
        completedSteps: 50,
      });

      expect(job.progress).toBe(50);
      expect(job.currentStep).toBe('Importing bookmarks');
      expect(job.totalSteps).toBe(100);
      expect(job.completedSteps).toBe(50);
    });

    it('should persist job to database', async () => {
      const job = await createJob({
        type: JobType.MANUAL_ADD,
      });

      const retrieved = await db.jobs.get(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(job.id);
    });
  });

  describe('updateJob', () => {
    it('should update job status', async () => {
      const job = await createJob({
        type: JobType.MARKDOWN_GENERATION,
      });

      await updateJob(job.id, {
        status: JobStatus.IN_PROGRESS,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.status).toBe(JobStatus.IN_PROGRESS);
    });

    it('should update job progress', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
      });

      await updateJob(job.id, {
        progress: 75,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.progress).toBe(75);
    });

    it('should update currentStep', async () => {
      const job = await createJob({
        type: JobType.QA_GENERATION,
      });

      await updateJob(job.id, {
        currentStep: 'Generating embeddings',
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.currentStep).toBe('Generating embeddings');
    });

    it('should merge metadata', async () => {
      const job = await createJob({
        type: JobType.BULK_URL_IMPORT,
        metadata: {
          totalUrls: 10,
          successCount: 0,
        },
      });

      await updateJob(job.id, {
        metadata: {
          successCount: 5,
        },
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.metadata).toEqual({
        totalUrls: 10,
        successCount: 5,
      });
    });

    it('should set completedAt when status is COMPLETED', async () => {
      const job = await createJob({
        type: JobType.MANUAL_ADD,
      });

      await updateJob(job.id, {
        status: JobStatus.COMPLETED,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should set completedAt when status is FAILED', async () => {
      const job = await createJob({
        type: JobType.URL_FETCH,
      });

      await updateJob(job.id, {
        status: JobStatus.FAILED,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should set completedAt when status is CANCELLED', async () => {
      const job = await createJob({
        type: JobType.BULK_URL_IMPORT,
      });

      await updateJob(job.id, {
        status: JobStatus.CANCELLED,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should throw error if job not found', async () => {
      await expect(
        updateJob('non-existent-id', { status: JobStatus.COMPLETED })
      ).rejects.toThrow('Job not found');
    });

    it('should update updatedAt timestamp', async () => {
      const job = await createJob({
        type: JobType.MANUAL_ADD,
      });

      const originalUpdatedAt = job.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      await updateJob(job.id, {
        progress: 50,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('completeJob', () => {
    it('should mark job as completed', async () => {
      const job = await createJob({
        type: JobType.MARKDOWN_GENERATION,
        status: JobStatus.IN_PROGRESS,
      });

      await completeJob(job.id);

      const updated = await db.jobs.get(job.id);
      expect(updated?.status).toBe(JobStatus.COMPLETED);
      expect(updated?.progress).toBe(100);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should add metadata when completing job', async () => {
      const job = await createJob({
        type: JobType.MARKDOWN_GENERATION,
      });

      await completeJob(job.id, {
        characterCount: 5000,
        wordCount: 800,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.metadata).toEqual({
        characterCount: 5000,
        wordCount: 800,
      });
    });

    it('should merge metadata with existing metadata', async () => {
      const job = await createJob({
        type: JobType.QA_GENERATION,
        metadata: {
          pairsGenerated: 10,
        },
      });

      await completeJob(job.id, {
        apiTimeMs: 2500,
      });

      const updated = await db.jobs.get(job.id);
      expect(updated?.metadata).toEqual({
        pairsGenerated: 10,
        apiTimeMs: 2500,
      });
    });

    it('should throw error if job not found', async () => {
      await expect(
        completeJob('non-existent-id')
      ).rejects.toThrow('Job not found');
    });
  });

  describe('failJob', () => {
    it('should mark job as failed with error message', async () => {
      const job = await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.IN_PROGRESS,
      });

      await failJob(job.id, 'Network timeout');

      const updated = await db.jobs.get(job.id);
      expect(updated?.status).toBe(JobStatus.FAILED);
      expect(updated?.metadata.errorMessage).toBe('Network timeout');
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should handle Error objects', async () => {
      const job = await createJob({
        type: JobType.MARKDOWN_GENERATION,
      });

      const error = new Error('Readability failed');
      await failJob(job.id, error);

      const updated = await db.jobs.get(job.id);
      expect(updated?.metadata.errorMessage).toBe('Readability failed');
      expect(updated?.metadata.errorStack).toBeDefined();
    });

    it('should preserve existing metadata', async () => {
      const job = await createJob({
        type: JobType.URL_FETCH,
        metadata: {
          url: 'https://example.com',
        },
      });

      await failJob(job.id, 'Failed to fetch');

      const updated = await db.jobs.get(job.id);
      expect(updated?.metadata.url).toBe('https://example.com');
      expect(updated?.metadata.errorMessage).toBe('Failed to fetch');
    });

    it('should throw error if job not found', async () => {
      await expect(
        failJob('non-existent-id', 'Error')
      ).rejects.toThrow('Job not found');
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job', async () => {
      const job = await createJob({
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
      });

      await cancelJob(job.id);

      const updated = await db.jobs.get(job.id);
      expect(updated?.status).toBe(JobStatus.CANCELLED);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('getJobsByBookmark', () => {
    it('should return jobs for a specific bookmark', async () => {
      const bookmarkId = 'bookmark-123';

      await createJob({
        type: JobType.MANUAL_ADD,
        bookmarkId,
      });

      await createJob({
        type: JobType.MARKDOWN_GENERATION,
        bookmarkId,
      });

      await createJob({
        type: JobType.QA_GENERATION,
        bookmarkId: 'other-bookmark',
      });

      const jobs = await getJobsByBookmark(bookmarkId);
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.bookmarkId === bookmarkId)).toBe(true);
    });

    it('should return jobs ordered by creation date (newest first)', async () => {
      const bookmarkId = 'bookmark-123';

      const job1 = await createJob({
        type: JobType.MANUAL_ADD,
        bookmarkId,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const job2 = await createJob({
        type: JobType.MARKDOWN_GENERATION,
        bookmarkId,
      });

      const jobs = await getJobsByBookmark(bookmarkId);
      expect(jobs[0].id).toBe(job2.id);
      expect(jobs[1].id).toBe(job1.id);
    });

    it('should return empty array if no jobs found', async () => {
      const jobs = await getJobsByBookmark('non-existent-bookmark');
      expect(jobs).toEqual([]);
    });
  });

  describe('getJobsByParent', () => {
    it('should return child jobs of a parent', async () => {
      const parentJob = await createJob({
        type: JobType.BULK_URL_IMPORT,
      });

      await createJob({
        type: JobType.URL_FETCH,
        parentJobId: parentJob.id,
      });

      await createJob({
        type: JobType.URL_FETCH,
        parentJobId: parentJob.id,
      });

      await createJob({
        type: JobType.URL_FETCH,
        parentJobId: 'other-parent',
      });

      const childJobs = await getJobsByParent(parentJob.id);
      expect(childJobs).toHaveLength(2);
      expect(childJobs.every(j => j.parentJobId === parentJob.id)).toBe(true);
    });

    it('should return jobs ordered by creation date', async () => {
      const parentJob = await createJob({
        type: JobType.BULK_URL_IMPORT,
      });

      const child1 = await createJob({
        type: JobType.URL_FETCH,
        parentJobId: parentJob.id,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const child2 = await createJob({
        type: JobType.URL_FETCH,
        parentJobId: parentJob.id,
      });

      const childJobs = await getJobsByParent(parentJob.id);
      expect(childJobs[0].id).toBe(child1.id);
      expect(childJobs[1].id).toBe(child2.id);
    });

    it('should return empty array if no child jobs found', async () => {
      const jobs = await getJobsByParent('non-existent-parent');
      expect(jobs).toEqual([]);
    });
  });

  describe('getActiveJobs', () => {
    it('should return only in-progress jobs', async () => {
      await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.PENDING,
      });

      await createJob({
        type: JobType.MARKDOWN_GENERATION,
        status: JobStatus.IN_PROGRESS,
      });

      await createJob({
        type: JobType.QA_GENERATION,
        status: JobStatus.IN_PROGRESS,
      });

      await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
      });

      const activeJobs = await getActiveJobs();
      expect(activeJobs).toHaveLength(2);
      expect(activeJobs.every(j => j.status === JobStatus.IN_PROGRESS)).toBe(true);
    });

    it('should return empty array if no active jobs', async () => {
      await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
      });

      const activeJobs = await getActiveJobs();
      expect(activeJobs).toEqual([]);
    });
  });

  describe('getRecentJobs', () => {
    it('should return recent jobs with default limit', async () => {
      for (let i = 0; i < 5; i++) {
        await createJob({
          type: JobType.MANUAL_ADD,
        });
      }

      const jobs = await getRecentJobs();
      expect(jobs.length).toBeLessThanOrEqual(100);
    });

    it('should respect custom limit', async () => {
      for (let i = 0; i < 10; i++) {
        await createJob({
          type: JobType.MANUAL_ADD,
        });
      }

      const jobs = await getRecentJobs({ limit: 5 });
      expect(jobs).toHaveLength(5);
    });

    it('should filter by job type', async () => {
      await createJob({ type: JobType.MANUAL_ADD });
      await createJob({ type: JobType.MARKDOWN_GENERATION });
      await createJob({ type: JobType.MANUAL_ADD });

      const jobs = await getRecentJobs({ type: JobType.MANUAL_ADD });
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.type === JobType.MANUAL_ADD)).toBe(true);
    });

    it('should filter by job status', async () => {
      await createJob({ type: JobType.MANUAL_ADD, status: JobStatus.PENDING });
      await createJob({ type: JobType.MANUAL_ADD, status: JobStatus.COMPLETED });
      await createJob({ type: JobType.MANUAL_ADD, status: JobStatus.PENDING });

      const jobs = await getRecentJobs({ status: JobStatus.PENDING });
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.status === JobStatus.PENDING)).toBe(true);
    });

    it('should filter by parentJobId', async () => {
      const parentJob = await createJob({ type: JobType.BULK_URL_IMPORT });

      await createJob({ type: JobType.URL_FETCH, parentJobId: parentJob.id });
      await createJob({ type: JobType.URL_FETCH, parentJobId: 'other-parent' });

      const jobs = await getRecentJobs({ parentJobId: parentJob.id });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].parentJobId).toBe(parentJob.id);
    });

    it('should return jobs ordered by creation date (newest first)', async () => {
      const job1 = await createJob({ type: JobType.MANUAL_ADD });
      await new Promise(resolve => setTimeout(resolve, 10));
      const job2 = await createJob({ type: JobType.MANUAL_ADD });

      const jobs = await getRecentJobs();
      expect(jobs[0].id).toBe(job2.id);
      expect(jobs[1].id).toBe(job1.id);
    });

    it('should combine filters with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await createJob({
          type: JobType.MANUAL_ADD,
          status: JobStatus.COMPLETED
        });
      }

      for (let i = 0; i < 3; i++) {
        await createJob({
          type: JobType.MANUAL_ADD,
          status: JobStatus.PENDING
        });
      }

      const jobs = await getRecentJobs({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
        limit: 3
      });

      expect(jobs).toHaveLength(3);
      expect(jobs.every(j => j.status === JobStatus.COMPLETED)).toBe(true);
    });
  });

  describe('cleanupOldJobs', () => {
    it('should delete completed jobs older than specified days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);

      const oldJob = await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
      });
      await db.jobs.update(oldJob.id, { createdAt: oldDate });

      await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
      });

      const deletedCount = await cleanupOldJobs(30);
      expect(deletedCount).toBe(1);

      const remaining = await db.jobs.toArray();
      expect(remaining).toHaveLength(1);
    });

    it('should not delete failed jobs', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);

      const oldFailedJob = await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.FAILED,
      });
      await db.jobs.update(oldFailedJob.id, { createdAt: oldDate });

      const deletedCount = await cleanupOldJobs(30);
      expect(deletedCount).toBe(0);

      const remaining = await db.jobs.toArray();
      expect(remaining).toHaveLength(1);
    });

    it('should not delete recent completed jobs', async () => {
      await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
      });

      const deletedCount = await cleanupOldJobs(30);
      expect(deletedCount).toBe(0);
    });

    it('should handle custom days parameter', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 8);

      const oldJob = await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
      });
      await db.jobs.update(oldJob.id, { createdAt: oldDate });

      const deletedCount = await cleanupOldJobs(7);
      expect(deletedCount).toBe(1);
    });
  });

  describe('getJobStats', () => {
    it('should return job statistics', async () => {
      await createJob({ type: JobType.MANUAL_ADD, status: JobStatus.PENDING });
      await createJob({ type: JobType.MANUAL_ADD, status: JobStatus.COMPLETED });
      await createJob({ type: JobType.MARKDOWN_GENERATION, status: JobStatus.IN_PROGRESS });
      await createJob({ type: JobType.QA_GENERATION, status: JobStatus.FAILED });
      await createJob({ type: JobType.BULK_URL_IMPORT, status: JobStatus.CANCELLED });

      const stats = await getJobStats();

      expect(stats.total).toBe(5);
      expect(stats.byStatus[JobStatus.PENDING]).toBe(1);
      expect(stats.byStatus[JobStatus.COMPLETED]).toBe(1);
      expect(stats.byStatus[JobStatus.IN_PROGRESS]).toBe(1);
      expect(stats.byStatus[JobStatus.FAILED]).toBe(1);
      expect(stats.byStatus[JobStatus.CANCELLED]).toBe(1);
      expect(stats.byType[JobType.MANUAL_ADD]).toBe(2);
      expect(stats.byType[JobType.MARKDOWN_GENERATION]).toBe(1);
      expect(stats.byType[JobType.QA_GENERATION]).toBe(1);
      expect(stats.byType[JobType.BULK_URL_IMPORT]).toBe(1);
    });

    it('should return zero counts for empty database', async () => {
      const stats = await getJobStats();

      expect(stats.total).toBe(0);
      expect(Object.values(stats.byStatus).every(count => count === 0)).toBe(true);
      expect(Object.values(stats.byType).every(count => count === 0)).toBe(true);
    });

    it('should count all job types correctly', async () => {
      await createJob({ type: JobType.MANUAL_ADD });
      await createJob({ type: JobType.MARKDOWN_GENERATION });
      await createJob({ type: JobType.QA_GENERATION });
      await createJob({ type: JobType.FILE_IMPORT });
      await createJob({ type: JobType.BULK_URL_IMPORT });
      await createJob({ type: JobType.URL_FETCH });

      const stats = await getJobStats();

      expect(stats.total).toBe(6);
      expect(stats.byType[JobType.MANUAL_ADD]).toBe(1);
      expect(stats.byType[JobType.MARKDOWN_GENERATION]).toBe(1);
      expect(stats.byType[JobType.QA_GENERATION]).toBe(1);
      expect(stats.byType[JobType.FILE_IMPORT]).toBe(1);
      expect(stats.byType[JobType.BULK_URL_IMPORT]).toBe(1);
      expect(stats.byType[JobType.URL_FETCH]).toBe(1);
    });
  });
});
