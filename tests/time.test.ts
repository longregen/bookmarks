import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatTimeAgo } from '../src/lib/time';

describe('Time utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatTimeAgo', () => {
    it('should return "Just now" for times less than 60 seconds ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const thirtySecondsAgo = new Date('2024-01-15T11:59:30Z');
      expect(formatTimeAgo(thirtySecondsAgo)).toBe('Just now');

      const fiveSecondsAgo = new Date('2024-01-15T11:59:55Z');
      expect(formatTimeAgo(fiveSecondsAgo)).toBe('Just now');
    });

    it('should return singular minute for 1 minute ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const oneMinuteAgo = new Date('2024-01-15T11:59:00Z');
      expect(formatTimeAgo(oneMinuteAgo)).toBe('1 minute ago');
    });

    it('should return plural minutes for multiple minutes ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const fiveMinutesAgo = new Date('2024-01-15T11:55:00Z');
      expect(formatTimeAgo(fiveMinutesAgo)).toBe('5 minutes ago');

      const thirtyMinutesAgo = new Date('2024-01-15T11:30:00Z');
      expect(formatTimeAgo(thirtyMinutesAgo)).toBe('30 minutes ago');
    });

    it('should return singular hour for 1 hour ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const oneHourAgo = new Date('2024-01-15T11:00:00Z');
      expect(formatTimeAgo(oneHourAgo)).toBe('1 hour ago');
    });

    it('should return plural hours for multiple hours ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const threeHoursAgo = new Date('2024-01-15T09:00:00Z');
      expect(formatTimeAgo(threeHoursAgo)).toBe('3 hours ago');

      const twentyThreeHoursAgo = new Date('2024-01-14T13:00:00Z');
      expect(formatTimeAgo(twentyThreeHoursAgo)).toBe('23 hours ago');
    });

    it('should return singular day for 1 day ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const oneDayAgo = new Date('2024-01-14T12:00:00Z');
      expect(formatTimeAgo(oneDayAgo)).toBe('1 day ago');
    });

    it('should return plural days for multiple days ago (up to 6 days)', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const threeDaysAgo = new Date('2024-01-12T12:00:00Z');
      expect(formatTimeAgo(threeDaysAgo)).toBe('3 days ago');

      const sixDaysAgo = new Date('2024-01-09T12:00:00Z');
      expect(formatTimeAgo(sixDaysAgo)).toBe('6 days ago');
    });

    it('should return formatted date for 7 or more days ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const sevenDaysAgo = new Date('2024-01-08T12:00:00Z');
      const result = formatTimeAgo(sevenDaysAgo);
      expect(result).not.toContain('ago');
    });

    it('should handle Date objects correctly', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);

      const date = new Date('2024-01-15T11:55:00Z');
      expect(formatTimeAgo(date)).toBe('5 minutes ago');
    });
  });
});
