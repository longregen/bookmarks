import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import {
  createJob,
  getJobsByParent,
  getRecentJobs,
  cleanupOldJobs,
  deleteJob,
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

  describe('getJobsByParent', () => {
    it('should return child jobs of a parent', async () => {
      const parentJob = await createJob({
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.COMPLETED,
      });

      await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: parentJob.id,
      });

      await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: parentJob.id,
      });

      await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: 'other-parent',
      });

      const childJobs = await getJobsByParent(parentJob.id);
      expect(childJobs).toHaveLength(2);
      expect(childJobs.every(j => j.parentJobId === parentJob.id)).toBe(true);
    });

    it('should return empty array if no child jobs found', async () => {
      const jobs = await getJobsByParent('non-existent-parent');
      expect(jobs).toEqual([]);
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

  describe('cleanupOldJobs', () => {
    it('should delete jobs older than specified days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);

      const oldJob = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });
      await db.jobs.update(oldJob.id, { createdAt: oldDate });

      await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });

      const deletedCount = await cleanupOldJobs(30);
      expect(deletedCount).toBe(1);

      const remaining = await db.jobs.toArray();
      expect(remaining).toHaveLength(1);
    });

    it('should not delete recent jobs', async () => {
      await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });

      const deletedCount = await cleanupOldJobs(30);
      expect(deletedCount).toBe(0);
    });

    it('should handle custom days parameter', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 8);

      const oldJob = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
      });
      await db.jobs.update(oldJob.id, { createdAt: oldDate });

      const deletedCount = await cleanupOldJobs(7);
      expect(deletedCount).toBe(1);
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
});
