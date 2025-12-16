/**
 * Format a date as relative time (e.g., "2h ago", "3 days ago")
 */
function formatRelativeTime(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
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
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 14) {
    return formatRelativeTime(date, now);
  } else if (diffDays < 365) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toISOString().split('T')[0];
  }
}
