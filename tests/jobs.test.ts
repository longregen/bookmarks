import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import {
  createJob,
  getRecentJobs,
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
});
