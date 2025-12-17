import { db, JobStatus } from '../db/schema';
import { config } from './config-registry';
import { openExtensionPage } from './tabs';

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
    // Use indexed counts instead of loading all jobs into memory
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

function getHealthIndicatorStyle(state: HealthState): { symbol: string; color: string; className: string } {
  switch (state) {
    case 'healthy':
      return { symbol: '●', color: '#22c55e', className: 'healthy' };
    case 'processing':
      return { symbol: '◐', color: '#3b82f6', className: 'processing' };
    case 'idle':
      return { symbol: '○', color: '#9ca3af', className: 'idle' };
    case 'error':
      return { symbol: '✕', color: '#ef4444', className: 'error' };
  }
}

export function createHealthIndicator(container: HTMLElement): () => void {
  const indicator = document.createElement('div');
  indicator.className = 'health-indicator';

  const dot = document.createElement('span');
  dot.className = 'health-indicator-dot';

  indicator.appendChild(dot);
  container.appendChild(indicator);

  const tooltip = document.createElement('div');
  tooltip.className = 'health-indicator-tooltip';
  container.style.position = 'relative';
  container.appendChild(tooltip);

  indicator.addEventListener('mouseenter', () => {
    tooltip.style.opacity = '1';
  });

  indicator.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  let currentHealthState: HealthState = 'idle';

  indicator.addEventListener('click', () => {
    if (currentHealthState === 'error') {
      void openExtensionPage('src/jobs/jobs.html?status=failed');
    } else {
      void openExtensionPage('src/jobs/jobs.html');
    }
  });

  async function updateIndicator(): Promise<void> {
    const health = await getHealthStatus();
    const style = getHealthIndicatorStyle(health.state);

    currentHealthState = health.state;

    dot.textContent = style.symbol;
    dot.style.color = style.color;

    indicator.className = `health-indicator ${style.className}`;

    indicator.style.cursor = 'pointer';

    tooltip.textContent = health.message;
  }

  void updateIndicator();

  const intervalId = setInterval(updateIndicator, config.HEALTH_REFRESH_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    container.removeChild(indicator);
    container.removeChild(tooltip);
  };
}
