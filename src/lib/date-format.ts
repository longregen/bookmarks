import { TIME } from './constants';
import { config } from './config-registry';

function formatRelativeTime(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / TIME.SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / TIME.MINUTES_PER_HOUR);
  const days = Math.floor(hours / TIME.HOURS_PER_DAY);

  if (seconds < TIME.SECONDS_PER_MINUTE) return 'just now';
  if (minutes < TIME.MINUTES_PER_HOUR) return `${minutes}m ago`;
  if (hours < TIME.HOURS_PER_DAY) return `${hours}h ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function formatDateByAge(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / TIME.MS_PER_DAY;

  if (diffDays < config.DATE_RELATIVE_TIME_THRESHOLD_DAYS) {
    return formatRelativeTime(date, now);
  } else if (diffDays < config.DATE_FULL_DATE_THRESHOLD_DAYS) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toISOString().split('T')[0];
  }
}
