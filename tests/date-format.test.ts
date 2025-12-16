import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDateByAge } from '../src/lib/date-format';

describe('Date Format', () => {
  let mockNow: Date;

  beforeEach(() => {
    // Set a fixed "now" time for consistent testing
    mockNow = new Date('2025-06-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatDateByAge - Relative time (< 2 weeks)', () => {
    it('should show "just now" for dates less than 60 seconds ago', () => {
      const date = new Date(mockNow.getTime() - 30 * 1000); // 30 seconds ago
      expect(formatDateByAge(date)).toBe('just now');
    });

    it('should show minutes for dates less than 1 hour ago', () => {
      const date = new Date(mockNow.getTime() - 25 * 60 * 1000); // 25 minutes ago
      expect(formatDateByAge(date)).toBe('25m ago');
    });

    it('should show hours for dates less than 24 hours ago', () => {
      const date = new Date(mockNow.getTime() - 5 * 60 * 60 * 1000); // 5 hours ago
      expect(formatDateByAge(date)).toBe('5h ago');
    });

    it('should show days for dates less than 14 days ago', () => {
      const date = new Date(mockNow.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      expect(formatDateByAge(date)).toBe('7 days ago');
    });

    it('should show singular "day" for 1 day ago', () => {
      const date = new Date(mockNow.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
      expect(formatDateByAge(date)).toBe('1 day ago');
    });

    it('should show "13 days ago" for dates just under 14 days', () => {
      const date = new Date(mockNow.getTime() - 13 * 24 * 60 * 60 * 1000); // 13 days ago
      expect(formatDateByAge(date)).toBe('13 days ago');
    });
  });

  describe('formatDateByAge - Month and day (< 12 months)', () => {
    it('should show "Month Day" format for dates between 14 days and 12 months', () => {
      const date = new Date('2025-05-01T12:00:00Z'); // ~1.5 months ago
      const result = formatDateByAge(date);
      expect(result).toBe('May 1');
    });

    it('should show abbreviated month name with day', () => {
      const date = new Date('2025-03-20T12:00:00Z'); // ~3 months ago
      const result = formatDateByAge(date);
      expect(result).toBe('Mar 20');
    });

    it('should handle dates exactly 14 days old', () => {
      const date = new Date(mockNow.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
      const result = formatDateByAge(date);
      // Should show month/day format, not relative time
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    });

    it('should handle dates close to 12 months old', () => {
      const date = new Date('2024-07-01T12:00:00Z'); // ~11.5 months ago
      const result = formatDateByAge(date);
      expect(result).toBe('Jul 1');
    });
  });

  describe('formatDateByAge - Full date (>= 12 months)', () => {
    it('should show "YYYY-MM-DD" format for dates 12 months or older', () => {
      const date = new Date('2024-06-01T12:00:00Z'); // ~12 months ago
      const result = formatDateByAge(date);
      expect(result).toBe('2024-06-01');
    });

    it('should show full ISO date for dates over 1 year old', () => {
      const date = new Date('2023-03-15T12:00:00Z'); // ~2 years ago
      const result = formatDateByAge(date);
      expect(result).toBe('2023-03-15');
    });

    it('should show full ISO date for very old dates', () => {
      const date = new Date('2020-01-01T12:00:00Z'); // ~5 years ago
      const result = formatDateByAge(date);
      expect(result).toBe('2020-01-01');
    });

    it('should handle dates exactly at 365 days old', () => {
      const date = new Date(mockNow.getTime() - 365 * 24 * 60 * 60 * 1000); // 365 days ago
      const result = formatDateByAge(date);
      // Should be in YYYY-MM-DD format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('formatDateByAge - Edge cases', () => {
    it('should handle current moment correctly', () => {
      const date = new Date(mockNow);
      expect(formatDateByAge(date)).toBe('just now');
    });

    it('should handle dates with millisecond precision', () => {
      const date = new Date(mockNow.getTime() - 1234); // 1.234 seconds ago
      expect(formatDateByAge(date)).toBe('just now');
    });

    it('should handle boundary at 60 seconds', () => {
      const date = new Date(mockNow.getTime() - 60 * 1000); // exactly 60 seconds ago
      expect(formatDateByAge(date)).toBe('1m ago');
    });

    it('should handle boundary at 60 minutes', () => {
      const date = new Date(mockNow.getTime() - 60 * 60 * 1000); // exactly 60 minutes ago
      expect(formatDateByAge(date)).toBe('1h ago');
    });

    it('should handle dates across different years', () => {
      const date = new Date('2024-12-31T23:59:59Z'); // Just before new year
      const result = formatDateByAge(date);
      // Should use Month Day format since it's less than a year ago
      expect(result).toMatch(/^Dec 31$/);
    });
  });
});
