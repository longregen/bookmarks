import { formatTimeAgoShort } from './time.js';

/**
 * Format a date based on its age according to REDESIGN.md rules:
 * - < 2 weeks: Relative time (e.g., "2h ago", "3 days ago")
 * - < 12 months: Month and day (e.g., "Oct 12")
 * - ≥ 12 months: Full date (e.g., "2024-12-24")
 */
export function formatDateByAge(date: Date | string): string {
  const dateObj = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 14) {
    return formatTimeAgoShort(dateObj);
  }

  if (diffDays < 365) {
    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  return dateObj.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
}
