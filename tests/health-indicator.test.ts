import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import { getHealthStatus } from '../src/lib/health-status';
import { createHealthIndicator } from '../src/ui/health-indicator';
import * as tabs from '../src/lib/tabs';

vi.mock('../src/lib/tabs', () => ({
  openExtensionPage: vi.fn()
}));

describe('Health Indicator', () => {
  beforeEach(async () => {
    await db.jobs.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.jobs.clear();
  });

  describe('getHealthStatus', () => {
    it('should return idle state when no jobs exist', async () => {
      const status = await getHealthStatus();

      expect(status.state).toBe('idle');
      expect(status.message).toBe('No jobs in queue');
      expect(status.details).toEqual({
        pendingCount: 0,
        inProgressCount: 0,
        failedCount: 0
      });
    });

    it('should return error state when failed jobs exist', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.FAILED,
        progress: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const status = await getHealthStatus();

      expect(status.state).toBe('error');
      expect(status.message).toBe('1 failed job needs attention');
      expect(status.details?.failedCount).toBe(1);
    });

    it('should return error state with plural message for multiple failed jobs', async () => {
      await db.jobs.bulkAdd([
        {
          id: 'job-1',
          type: JobType.URL_FETCH,
          status: JobStatus.FAILED,
          progress: 0,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'job-2',
          type: JobType.MARKDOWN_GENERATION,
          status: JobStatus.FAILED,
          progress: 0,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      const status = await getHealthStatus();

      expect(status.state).toBe('error');
      expect(status.message).toBe('2 failed jobs need attention');
      expect(status.details?.failedCount).toBe(2);
    });

    it('should return processing state when jobs are pending', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        progress: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const status = await getHealthStatus();

      expect(status.state).toBe('processing');
      expect(status.message).toBe('Processing 1 job');
      expect(status.details?.pendingCount).toBe(1);
    });

    it('should return processing state when jobs are in progress', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.IN_PROGRESS,
        progress: 50,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const status = await getHealthStatus();

      expect(status.state).toBe('processing');
      expect(status.message).toBe('Processing 1 job');
      expect(status.details?.inProgressCount).toBe(1);
    });

    it('should return healthy state when all jobs are complete', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETE,
        progress: 100,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const status = await getHealthStatus();

      expect(status.state).toBe('healthy');
      expect(status.message).toBe('All systems healthy');
    });

    it('should prioritize error state over processing state', async () => {
      await db.jobs.bulkAdd([
        {
          id: 'job-1',
          type: JobType.URL_FETCH,
          status: JobStatus.FAILED,
          progress: 0,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'job-2',
          type: JobType.MARKDOWN_GENERATION,
          status: JobStatus.PENDING,
          progress: 0,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      const status = await getHealthStatus();

      expect(status.state).toBe('error');
    });
  });

  describe('createHealthIndicator', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should create health indicator DOM elements', async () => {
      createHealthIndicator(container);

      const indicator = container.querySelector('.health-indicator');
      const dot = container.querySelector('.health-indicator-dot');
      const tooltip = container.querySelector('.health-indicator-tooltip');

      expect(indicator).toBeTruthy();
      expect(dot).toBeTruthy();
      expect(tooltip).toBeTruthy();
    });

    it('should set cursor to pointer when in error state', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.FAILED,
        progress: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      expect(indicator.style.cursor).toBe('pointer');
    });

    it('should set cursor to pointer when in healthy state', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETE,
        progress: 100,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      expect(indicator.style.cursor).toBe('pointer');
    });

    it('should navigate to jobs page (filtered to failed) when clicked in error state', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.FAILED,
        progress: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      indicator.click();

      expect(tabs.openExtensionPage).toHaveBeenCalledWith('src/jobs/jobs.html?status=failed');
    });

    it('should navigate to jobs page when clicked in healthy state', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETE,
        progress: 100,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      indicator.click();

      expect(tabs.openExtensionPage).toHaveBeenCalledWith('src/jobs/jobs.html');
    });

    it('should navigate to jobs page when clicked in processing state', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        progress: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      indicator.click();

      expect(tabs.openExtensionPage).toHaveBeenCalledWith('src/jobs/jobs.html');
    });

    it('should update tooltip with error message', async () => {
      await db.jobs.bulkAdd([
        {
          id: 'job-1',
          type: JobType.URL_FETCH,
          status: JobStatus.FAILED,
          progress: 0,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'job-2',
          type: JobType.MARKDOWN_GENERATION,
          status: JobStatus.FAILED,
          progress: 0,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;
      expect(tooltip.textContent).toBe('2 failed jobs need attention');
    });

    it('should display error symbol (✕) when in error state', async () => {
      await db.jobs.add({
        id: 'job-1',
        type: JobType.URL_FETCH,
        status: JobStatus.FAILED,
        progress: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      createHealthIndicator(container);

      await new Promise(resolve => setTimeout(resolve, 100));

      const dot = container.querySelector('.health-indicator-dot') as HTMLElement;
      expect(dot.textContent).toBe('✕');
    });

    it('should cleanup interval and DOM elements on destroy', () => {
      const cleanup = createHealthIndicator(container);

      expect(container.querySelector('.health-indicator')).toBeTruthy();
      expect(container.querySelector('.health-indicator-tooltip')).toBeTruthy();

      cleanup();

      expect(container.querySelector('.health-indicator')).toBeFalsy();
      expect(container.querySelector('.health-indicator-tooltip')).toBeFalsy();
    });
  });
});
