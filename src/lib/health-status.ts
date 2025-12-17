import { db, JobStatus } from '../db/schema';

export type HealthState = 'healthy' | 'processing' | 'idle' | 'error';

export interface HealthStatus {
  state: HealthState;
  message: string;
  details?: {
    pendingCount: number;
    inProgressCount: number;
    failedCount: number;
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  try {
    const [pendingCount, inProgressCount, failedCount, totalCount] = await Promise.all([
      db.jobs.where('status').equals(JobStatus.PENDING).count(),
      db.jobs.where('status').equals(JobStatus.IN_PROGRESS).count(),
      db.jobs.where('status').equals(JobStatus.FAILED).count(),
      db.jobs.count()
    ]);

    const details = { pendingCount, inProgressCount, failedCount };

    if (failedCount > 0) {
      return {
        state: 'error',
        message: `${failedCount} failed job${failedCount !== 1 ? 's' : ''} need${failedCount === 1 ? 's' : ''} attention`,
        details
      };
    }

    if (pendingCount > 0 || inProgressCount > 0) {
      const total = pendingCount + inProgressCount;
      return {
        state: 'processing',
        message: `Processing ${total} job${total !== 1 ? 's' : ''}`,
        details
      };
    }

    if (totalCount === 0) {
      return {
        state: 'idle',
        message: 'No jobs in queue',
        details
      };
    }

    return {
      state: 'healthy',
      message: 'All systems healthy',
      details
    };
  } catch (error) {
    console.error('Error checking health status:', error);
    return {
      state: 'error',
      message: 'Error checking system health'
    };
  }
}
