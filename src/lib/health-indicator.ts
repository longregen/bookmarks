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

/**
 * Query db.jobs and determine the current health state
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  try {
    const allJobs = await db.jobs.toArray();

    const pendingCount = allJobs.filter(job => job.status === JobStatus.PENDING).length;
    const inProgressCount = allJobs.filter(job => job.status === JobStatus.IN_PROGRESS).length;
    const failedCount = allJobs.filter(job => job.status === JobStatus.FAILED).length;

    const details = { pendingCount, inProgressCount, failedCount };

    // Priority order: error > processing > idle > healthy
    if (failedCount > 0) {
      return {
        state: 'error',
        message: `${failedCount} failed job${failedCount > 1 ? 's' : ''} need attention`,
        details
      };
    }

    if (pendingCount > 0 || inProgressCount > 0) {
      const total = pendingCount + inProgressCount;
      return {
        state: 'processing',
        message: `Processing ${total} job${total > 1 ? 's' : ''}`,
        details
      };
    }

    if (allJobs.length === 0) {
      return {
        state: 'idle',
        message: 'No jobs in queue',
        details
      };
    }

    // All jobs completed successfully
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

/**
 * Get the appropriate symbol and color for the health state
 */
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

/**
 * Create or update the health indicator DOM element
 */
export function createHealthIndicator(container: HTMLElement): () => void {
  // Create the indicator element
  const indicator = document.createElement('div');
  indicator.className = 'health-indicator';
  indicator.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 200ms ease;
  `;

  const dot = document.createElement('span');
  dot.className = 'health-indicator-dot';
  dot.style.cssText = `
    font-size: 12px;
    line-height: 1;
    user-select: none;
  `;

  indicator.appendChild(dot);
  container.appendChild(indicator);

  // Tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'health-indicator-tooltip';
  tooltip.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    white-space: nowrap;
    z-index: 1000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms ease;
  `;
  container.style.position = 'relative';
  container.appendChild(tooltip);

  // Show/hide tooltip on hover
  indicator.addEventListener('mouseenter', () => {
    tooltip.style.opacity = '1';
  });

  indicator.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  // Update function
  async function updateIndicator() {
    const health = await getHealthStatus();
    const style = getHealthIndicatorStyle(health.state);

    // Update dot
    dot.textContent = style.symbol;
    dot.style.color = style.color;

    // Update classes for animation
    indicator.className = `health-indicator ${style.className}`;

    // Update tooltip
    tooltip.textContent = health.message;
  }

  // Initial update
  updateIndicator();

  // Auto-refresh every 5 seconds
  const intervalId = setInterval(updateIndicator, 5000);

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
    container.removeChild(indicator);
    container.removeChild(tooltip);
  };
}
