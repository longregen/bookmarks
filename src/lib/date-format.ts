import {
  TIME_SECONDS_PER_MINUTE,
  TIME_MINUTES_PER_HOUR,
  TIME_HOURS_PER_DAY,
  TIME_MS_PER_DAY,
  DATE_RELATIVE_TIME_THRESHOLD_DAYS,
  DATE_FULL_DATE_THRESHOLD_DAYS
} from './constants';

/**
 * Format a date as relative time (e.g., "2h ago", "3 days ago")
 */
function formatRelativeTime(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / TIME_SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / TIME_MINUTES_PER_HOUR);
  const days = Math.floor(hours / TIME_HOURS_PER_DAY);

  if (seconds < TIME_SECONDS_PER_MINUTE) return 'just now';
  if (minutes < TIME_MINUTES_PER_HOUR) return `${minutes}m ago`;
  if (hours < TIME_HOURS_PER_DAY) return `${hours}h ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * Format dates based on age:
 * - < 2 weeks: Relative time (e.g., "2h ago", "3 days ago")
 * - < 12 months: Month and day (e.g., "Oct 12")
 * - >= 12 months: Full date (e.g., "2024-12-24"
 */
export function formatDateByAge(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / TIME_MS_PER_DAY;

  if (diffDays < DATE_RELATIVE_TIME_THRESHOLD_DAYS) {
    return formatRelativeTime(date, now);
  } else if (diffDays < DATE_FULL_DATE_THRESHOLD_DAYS) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toISOString().split('T')[0];
  }
}
