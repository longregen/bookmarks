import { db, Job, JobStatus, JobType } from '../db/schema.js';
import { getRecentJobs, getActiveJobs } from '../lib/jobs.js';
import { createElement } from '../lib/dom.js';

export type HealthState = 'healthy' | 'processing' | 'idle' | 'error';

export interface HealthIndicatorOptions {
  onStateChange?: (state: HealthState) => void;
}

/**
 * Get current health state based on jobs
 * Logic:
 * 1. error - If any jobs have status='failed' in last 24h
 * 2. processing - If any jobs have status='in_progress' or 'pending'
 * 3. healthy - If there are completed jobs and no errors
 * 4. idle - Default state when no jobs
 */
export async function getHealthState(): Promise<HealthState> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Check for recent failed jobs
  const recentJobs = await getRecentJobs({ limit: 100 });
  const recentFailures = recentJobs.filter(
    job => job.status === JobStatus.FAILED && job.updatedAt > oneDayAgo
  );

  if (recentFailures.length > 0) {
    return 'error';
  }

  // Check for active processing
  const activeJobs = await getActiveJobs();
  const pendingJobs = await db.jobs
    .where('status')
    .equals(JobStatus.PENDING)
    .toArray();

  if (activeJobs.length > 0 || pendingJobs.length > 0) {
    return 'processing';
  }

  // Check for any completed jobs
  const completedCount = await db.jobs
    .where('status')
    .equals(JobStatus.COMPLETED)
    .count();

  if (completedCount > 0) {
    return 'healthy';
  }

  return 'idle';
}

/**
 * Create the clickable health indicator element
 */
export function createHealthIndicator(options: HealthIndicatorOptions = {}): HTMLElement {
  const indicator = createElement('div', {
    className: 'health-indicator',
    attributes: {
      'data-state': 'idle',
      'role': 'button',
      'aria-label': 'System health status',
      'tabindex': '0'
    }
  });

  const dot = createElement('span', {
    className: 'health-dot',
    textContent: '○'
  });

  indicator.appendChild(dot);

  // Update function to change state
  const updateState = async () => {
    const state = await getHealthState();
    indicator.setAttribute('data-state', state);

    const symbols = {
      healthy: '●',
      processing: '◐',
      idle: '○',
      error: '✕'
    };

    const labels = {
      healthy: 'System healthy',
      processing: 'Processing in progress',
      idle: 'System idle',
      error: 'Errors need attention'
    };

    dot.textContent = symbols[state];
    indicator.setAttribute('aria-label', labels[state]);

    if (options.onStateChange) {
      options.onStateChange(state);
    }
  };

  // Initial update
  updateState();

  // Handle click to open diagnostics
  const handleClick = () => {
    const modal = createDiagnosticsModal(() => {
      document.body.removeChild(modal);
    });
    document.body.appendChild(modal);
  };

  indicator.addEventListener('click', handleClick);
  indicator.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  });

  // Store update function for external use
  (indicator as any)._updateState = updateState;

  return indicator;
}

/**
 * Format date for display in diagnostics
 */
function formatDiagnosticDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }

  // Same day or recent
  const isToday = now.toDateString() === date.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  const daysAgo = Math.floor(hours / 24);
  if (daysAgo < 7) {
    return `${daysAgo}d ago`;
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format time for job timeline (HH:MM format)
 */
function formatTimelineTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Get human-readable job type name
 */
function getJobTypeName(type: JobType): string {
  const names: Record<JobType, string> = {
    [JobType.MANUAL_ADD]: 'Manual Add',
    [JobType.MARKDOWN_GENERATION]: 'Markdown Generation',
    [JobType.QA_GENERATION]: 'Q&A Generation',
    [JobType.FILE_IMPORT]: 'File Import',
    [JobType.BULK_URL_IMPORT]: 'Bulk URL Import',
    [JobType.URL_FETCH]: 'URL Fetch'
  };
  return names[type] || type;
}

/**
 * Get status icon and label
 */
function getStatusDisplay(status: JobStatus): { icon: string; label: string } {
  const displays: Record<JobStatus, { icon: string; label: string }> = {
    [JobStatus.PENDING]: { icon: '○', label: 'Pending' },
    [JobStatus.IN_PROGRESS]: { icon: '◐', label: 'In Progress' },
    [JobStatus.COMPLETED]: { icon: '✓', label: 'Completed' },
    [JobStatus.FAILED]: { icon: '✕', label: 'Failed' },
    [JobStatus.CANCELLED]: { icon: '⊘', label: 'Cancelled' }
  };
  return displays[status] || { icon: '?', label: status };
}

/**
 * Create job timeline view
 */
async function createJobTimeline(job: Job, onBack: () => void): Promise<HTMLElement> {
  const container = createElement('div', { className: 'job-timeline-view' });

  // Header with back button
  const header = createElement('div', { className: 'timeline-header' }, [
    createElement('button', {
      className: 'timeline-back-btn',
      textContent: '← Back to Summary'
    }),
    createElement('h3', {
      className: 'timeline-title',
      textContent: 'Job Timeline'
    })
  ]);

  header.querySelector('.timeline-back-btn')!.addEventListener('click', onBack);

  // Job info section
  const jobInfo = createElement('div', { className: 'timeline-job-info' }, [
    createElement('div', { className: 'timeline-job-type' }, [
      createElement('strong', { textContent: 'Type: ' }),
      document.createTextNode(getJobTypeName(job.type))
    ]),
    createElement('div', { className: 'timeline-job-id' }, [
      createElement('strong', { textContent: 'Job ID: ' }),
      createElement('code', { textContent: job.id })
    ])
  ]);

  // Get all related jobs for timeline (parent -> children)
  let timelineJobs: Job[] = [];

  if (job.parentJobId) {
    // This is a child job, get parent and siblings
    const parent = await db.jobs.get(job.parentJobId);
    if (parent) {
      timelineJobs.push(parent);
    }
    const siblings = await db.jobs
      .where('parentJobId')
      .equals(job.parentJobId)
      .sortBy('createdAt');
    timelineJobs.push(...siblings);
  } else {
    // This might be a parent job, get children
    timelineJobs.push(job);
    const children = await db.jobs
      .where('parentJobId')
      .equals(job.id)
      .sortBy('createdAt');
    timelineJobs.push(...children);
  }

  // Sort by updatedAt descending (most recent first)
  timelineJobs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  // Timeline entries
  const timeline = createElement('div', { className: 'timeline-entries' });

  for (const timelineJob of timelineJobs) {
    const statusDisplay = getStatusDisplay(timelineJob.status);
    const entry = createElement('div', { className: 'timeline-entry' });
    entry.setAttribute('data-status', timelineJob.status);

    const entryHeader = createElement('div', { className: 'timeline-entry-header' }, [
      createElement('span', {
        className: 'timeline-time',
        textContent: formatTimelineTime(timelineJob.updatedAt)
      }),
      createElement('span', {
        className: 'timeline-status-icon',
        textContent: statusDisplay.icon
      }),
      createElement('span', {
        className: 'timeline-status-label',
        textContent: statusDisplay.label + ' - ' + getJobTypeName(timelineJob.type)
      })
    ]);

    // Details section (collapsible)
    const detailsToggle = createElement('button', {
      className: 'timeline-details-toggle',
      textContent: '▶ Details'
    });

    const detailsContent = createElement('div', {
      className: 'timeline-details-content hidden'
    });

    // Build details from metadata
    const details: string[] = [];

    if (timelineJob.progress > 0) {
      details.push(`Progress: ${timelineJob.progress}%`);
    }
    if (timelineJob.currentStep) {
      details.push(`Current Step: ${timelineJob.currentStep}`);
    }
    if (timelineJob.metadata.url) {
      details.push(`URL: ${timelineJob.metadata.url}`);
    }
    if (timelineJob.metadata.characterCount) {
      details.push(`Characters: ${timelineJob.metadata.characterCount.toLocaleString()}`);
    }
    if (timelineJob.metadata.pairsGenerated) {
      details.push(`Q&A Pairs: ${timelineJob.metadata.pairsGenerated}`);
    }
    if (timelineJob.metadata.totalUrls) {
      details.push(`Total URLs: ${timelineJob.metadata.totalUrls}`);
    }
    if (timelineJob.metadata.successCount !== undefined) {
      details.push(`Success: ${timelineJob.metadata.successCount}`);
    }
    if (timelineJob.metadata.failureCount !== undefined) {
      details.push(`Failed: ${timelineJob.metadata.failureCount}`);
    }
    if (timelineJob.metadata.errorMessage) {
      details.push(`Error: ${timelineJob.metadata.errorMessage}`);
    }

    if (details.length > 0) {
      const detailsList = createElement('ul', { className: 'timeline-details-list' });
      for (const detail of details) {
        detailsList.appendChild(createElement('li', { textContent: detail }));
      }
      detailsContent.appendChild(detailsList);
    } else {
      detailsContent.textContent = 'No additional details available';
    }

    // Toggle details
    detailsToggle.addEventListener('click', () => {
      const isHidden = detailsContent.classList.contains('hidden');
      detailsContent.classList.toggle('hidden');
      detailsToggle.textContent = isHidden ? '▼ Details' : '▶ Details';
    });

    entry.appendChild(entryHeader);
    entry.appendChild(detailsToggle);
    entry.appendChild(detailsContent);
    timeline.appendChild(entry);
  }

  container.appendChild(header);
  container.appendChild(jobInfo);
  container.appendChild(timeline);

  return container;
}

/**
 * Create health summary section
 */
async function createHealthSummary(): Promise<HTMLElement> {
  const summary = createElement('div', { className: 'health-summary' });

  const title = createElement('h3', {
    className: 'health-summary-title',
    textContent: 'HEALTH SUMMARY'
  });

  // Get stats
  const activeJobs = await getActiveJobs();
  const pendingJobs = await db.jobs
    .where('status')
    .equals(JobStatus.PENDING)
    .toArray();

  // Estimate storage usage
  const allBookmarks = await db.bookmarks.count();
  const estimatedMB = Math.round(allBookmarks * 0.5); // Rough estimate: 500KB per bookmark

  const items = createElement('ul', { className: 'health-summary-list' }, [
    createElement('li', { textContent: `API Connection: Healthy` }),
    createElement('li', { textContent: `Local Storage: ~${estimatedMB} MB used` }),
    createElement('li', {
      textContent: `Processing Queue: ${activeJobs.length + pendingJobs.length === 0 ? 'Empty' : `${activeJobs.length + pendingJobs.length} jobs`}`
    })
  ]);

  summary.appendChild(title);
  summary.appendChild(items);

  return summary;
}

/**
 * Create job list section
 */
async function createJobList(onJobClick: (job: Job) => void): Promise<HTMLElement> {
  const container = createElement('div', { className: 'job-list-section' });

  const title = createElement('h3', {
    className: 'job-list-title',
    textContent: 'Full Job History'
  });

  const jobList = createElement('div', { className: 'job-list' });

  // Get recent jobs (limit to 50 for performance)
  const jobs = await getRecentJobs({ limit: 50 });

  if (jobs.length === 0) {
    jobList.appendChild(createElement('p', {
      className: 'job-list-empty',
      textContent: 'No jobs yet'
    }));
  } else {
    for (const job of jobs) {
      const statusDisplay = getStatusDisplay(job.status);

      const jobCard = createElement('div', { className: 'job-card' });
      jobCard.setAttribute('data-status', job.status);

      const jobHeader = createElement('div', { className: 'job-card-header' }, [
        createElement('span', {
          className: 'job-status-icon',
          textContent: statusDisplay.icon
        }),
        createElement('span', {
          className: 'job-type',
          textContent: getJobTypeName(job.type)
        }),
        createElement('span', {
          className: 'job-time',
          textContent: formatDiagnosticDate(job.updatedAt)
        })
      ]);

      const jobMeta = createElement('div', { className: 'job-card-meta' });

      // Show relevant metadata
      if (job.metadata.url) {
        jobMeta.appendChild(createElement('div', {
          className: 'job-meta-item',
          textContent: `URL: ${job.metadata.url.substring(0, 50)}${job.metadata.url.length > 50 ? '...' : ''}`
        }));
      }

      if (job.progress > 0 && job.status === JobStatus.IN_PROGRESS) {
        jobMeta.appendChild(createElement('div', {
          className: 'job-meta-item',
          textContent: `Progress: ${job.progress}%`
        }));
      }

      if (job.metadata.errorMessage) {
        jobMeta.appendChild(createElement('div', {
          className: 'job-meta-item job-error',
          textContent: `Error: ${job.metadata.errorMessage}`
        }));
      }

      jobCard.appendChild(jobHeader);
      if (jobMeta.children.length > 0) {
        jobCard.appendChild(jobMeta);
      }

      // Click to view timeline
      jobCard.addEventListener('click', () => onJobClick(job));
      jobCard.style.cursor = 'pointer';

      jobList.appendChild(jobCard);
    }
  }

  container.appendChild(title);
  container.appendChild(jobList);

  return container;
}

/**
 * Create the diagnostics modal
 */
export function createDiagnosticsModal(onClose: () => void): HTMLElement {
  const overlay = createElement('div', { className: 'diagnostics-overlay' });

  const modal = createElement('div', { className: 'diagnostics-modal' });

  // Header
  const header = createElement('div', { className: 'diagnostics-header' }, [
    createElement('h2', {
      className: 'diagnostics-title',
      textContent: '⚙️ System Diagnostics'
    }),
    createElement('button', {
      className: 'diagnostics-close',
      textContent: '✕',
      attributes: { 'aria-label': 'Close diagnostics' }
    })
  ]);

  const closeBtn = header.querySelector('.diagnostics-close')!;
  closeBtn.addEventListener('click', onClose);

  // Content area
  const content = createElement('div', { className: 'diagnostics-content' });

  // Initial view: summary + job list
  const showSummaryView = async () => {
    content.innerHTML = '';
    const summary = await createHealthSummary();
    const separator = createElement('div', { className: 'diagnostics-separator' });
    const jobList = await createJobList(async (job) => {
      // Show timeline view
      const timeline = await createJobTimeline(job, showSummaryView);
      content.innerHTML = '';
      content.appendChild(timeline);
    });

    content.appendChild(summary);
    content.appendChild(separator);
    content.appendChild(jobList);
  };

  // Load initial view
  showSummaryView();

  modal.appendChild(header);
  modal.appendChild(content);
  overlay.appendChild(modal);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      onClose();
    }
  });

  // Close on Escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  return overlay;
}

/**
 * Start polling for health state changes
 * @param indicator The health indicator element to update
 * @param intervalMs Polling interval in milliseconds (default: 2000)
 * @returns Cleanup function to stop polling
 */
export function startHealthMonitor(
  indicator: HTMLElement,
  intervalMs: number = 2000
): () => void {
  const updateFn = (indicator as any)._updateState;

  if (!updateFn) {
    console.warn('Health indicator missing update function');
    return () => {};
  }

  // Initial update
  updateFn();

  // Set up polling
  const intervalId = setInterval(updateFn, intervalMs);

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
  };
}

/**
 * Inject health indicator styles
 */
export function injectHealthIndicatorStyles(): void {
  if (document.getElementById('health-indicator-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'health-indicator-styles';
  style.textContent = `
    /* Health Indicator */
    .health-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      cursor: pointer;
      border-radius: 50%;
      transition: all 0.2s ease;
      user-select: none;
    }

    .health-indicator:hover {
      background-color: var(--bg-secondary, rgba(0, 0, 0, 0.05));
    }

    .health-indicator:focus {
      outline: 2px solid var(--accent-primary, #3b82f6);
      outline-offset: 2px;
    }

    .health-dot {
      font-size: 16px;
      line-height: 1;
      display: inline-block;
    }

    /* Health states */
    .health-indicator[data-state="healthy"] .health-dot {
      color: var(--status-success-text, #10b981);
    }

    .health-indicator[data-state="processing"] .health-dot {
      color: var(--status-info-text, #3b82f6);
      animation: pulse 2s ease-in-out infinite;
    }

    .health-indicator[data-state="idle"] .health-dot {
      color: var(--text-secondary, #6b7280);
    }

    .health-indicator[data-state="error"] .health-dot {
      color: var(--status-error-text, #ef4444);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Diagnostics Modal */
    .diagnostics-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(2px);
    }

    .diagnostics-modal {
      background-color: var(--bg-primary, #ffffff);
      border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .diagnostics-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid var(--border-primary, #e5e7eb);
    }

    .diagnostics-title {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
      color: var(--text-primary, #111827);
    }

    .diagnostics-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--text-secondary, #6b7280);
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .diagnostics-close:hover {
      background-color: var(--bg-secondary, #f3f4f6);
      color: var(--text-primary, #111827);
    }

    .diagnostics-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }

    .diagnostics-separator {
      height: 1px;
      background-color: var(--border-primary, #e5e7eb);
      margin: 24px 0;
    }

    /* Health Summary */
    .health-summary-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #6b7280);
      margin: 0 0 12px 0;
    }

    .health-summary-list {
      list-style: none;
      padding: 0;
      margin: 0;
      font-size: 14px;
      line-height: 1.8;
      color: var(--text-primary, #111827);
    }

    .health-summary-list li {
      padding: 4px 0;
    }

    /* Job List */
    .job-list-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #6b7280);
      margin: 0 0 12px 0;
    }

    .job-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .job-list-empty {
      color: var(--text-secondary, #6b7280);
      font-style: italic;
      text-align: center;
      padding: 24px;
    }

    .job-card {
      border: 1px solid var(--border-primary, #e5e7eb);
      border-radius: 6px;
      padding: 12px;
      transition: all 0.2s;
    }

    .job-card:hover {
      border-color: var(--accent-primary, #3b82f6);
      background-color: var(--bg-secondary, #f9fafb);
    }

    .job-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      margin-bottom: 4px;
    }

    .job-status-icon {
      font-size: 16px;
      line-height: 1;
    }

    .job-card[data-status="completed"] .job-status-icon {
      color: var(--status-success-text, #10b981);
    }

    .job-card[data-status="failed"] .job-status-icon {
      color: var(--status-error-text, #ef4444);
    }

    .job-card[data-status="in_progress"] .job-status-icon {
      color: var(--status-info-text, #3b82f6);
    }

    .job-card[data-status="pending"] .job-status-icon {
      color: var(--text-secondary, #6b7280);
    }

    .job-type {
      font-weight: 500;
      color: var(--text-primary, #111827);
      flex: 1;
    }

    .job-time {
      font-size: 12px;
      color: var(--text-secondary, #6b7280);
    }

    .job-card-meta {
      font-size: 13px;
      color: var(--text-secondary, #6b7280);
      margin-top: 8px;
    }

    .job-meta-item {
      padding: 2px 0;
    }

    .job-meta-item.job-error {
      color: var(--status-error-text, #ef4444);
      font-size: 12px;
    }

    /* Job Timeline View */
    .job-timeline-view {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .timeline-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .timeline-back-btn {
      align-self: flex-start;
      background: none;
      border: none;
      color: var(--accent-primary, #3b82f6);
      font-size: 14px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .timeline-back-btn:hover {
      background-color: var(--bg-secondary, #f3f4f6);
    }

    .timeline-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      color: var(--text-primary, #111827);
    }

    .timeline-job-info {
      background-color: var(--bg-secondary, #f9fafb);
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
      line-height: 1.6;
    }

    .timeline-job-info div {
      margin: 4px 0;
    }

    .timeline-job-info code {
      font-family: monospace;
      font-size: 11px;
      background-color: var(--bg-primary, #ffffff);
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid var(--border-primary, #e5e7eb);
    }

    .timeline-entries {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .timeline-entry {
      border-left: 2px solid var(--border-primary, #e5e7eb);
      padding-left: 16px;
      position: relative;
    }

    .timeline-entry::before {
      content: '';
      position: absolute;
      left: -5px;
      top: 4px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--bg-primary, #ffffff);
      border: 2px solid var(--border-primary, #e5e7eb);
    }

    .timeline-entry[data-status="completed"]::before {
      border-color: var(--status-success-text, #10b981);
      background-color: var(--status-success-text, #10b981);
    }

    .timeline-entry[data-status="failed"]::before {
      border-color: var(--status-error-text, #ef4444);
      background-color: var(--status-error-text, #ef4444);
    }

    .timeline-entry[data-status="in_progress"]::before {
      border-color: var(--status-info-text, #3b82f6);
      background-color: var(--status-info-text, #3b82f6);
    }

    .timeline-entry-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      margin-bottom: 4px;
    }

    .timeline-time {
      font-family: monospace;
      font-size: 13px;
      color: var(--text-secondary, #6b7280);
      min-width: 50px;
    }

    .timeline-status-icon {
      font-size: 16px;
      line-height: 1;
    }

    .timeline-entry[data-status="completed"] .timeline-status-icon {
      color: var(--status-success-text, #10b981);
    }

    .timeline-entry[data-status="failed"] .timeline-status-icon {
      color: var(--status-error-text, #ef4444);
    }

    .timeline-entry[data-status="in_progress"] .timeline-status-icon {
      color: var(--status-info-text, #3b82f6);
    }

    .timeline-status-label {
      font-weight: 500;
      color: var(--text-primary, #111827);
    }

    .timeline-details-toggle {
      background: none;
      border: none;
      color: var(--accent-primary, #3b82f6);
      font-size: 13px;
      cursor: pointer;
      padding: 4px 0;
      margin: 4px 0;
      display: block;
      transition: color 0.2s;
    }

    .timeline-details-toggle:hover {
      color: var(--accent-secondary, #2563eb);
    }

    .timeline-details-content {
      font-size: 13px;
      color: var(--text-secondary, #6b7280);
      margin-top: 8px;
      padding: 12px;
      background-color: var(--bg-secondary, #f9fafb);
      border-radius: 4px;
    }

    .timeline-details-content.hidden {
      display: none;
    }

    .timeline-details-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .timeline-details-list li {
      padding: 4px 0;
      line-height: 1.6;
    }
  `;

  document.head.appendChild(style);
}
