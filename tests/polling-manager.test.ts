import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPoller } from '../src/lib/polling-manager';

describe('Polling Manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createPoller', () => {
    it('should create a poller with start/stop methods', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000);

      expect(poller).toHaveProperty('start');
      expect(poller).toHaveProperty('stop');
      expect(typeof poller.start).toBe('function');
      expect(typeof poller.stop).toBe('function');
    });


    it('should call callback at specified interval', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000);

      poller.start();

      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(3);

      poller.stop();
    });

    it('should call callback immediately when immediate option is true', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000, { immediate: true });

      poller.start();
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(2);

      poller.stop();
    });

    it('should not call callback immediately when immediate option is false', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000, { immediate: false });

      poller.start();
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      poller.stop();
    });

    it('should stop calling callback after stop', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000);

      poller.start();

      vi.advanceTimersByTime(2000);
      expect(callback).toHaveBeenCalledTimes(2);

      poller.stop();

      vi.advanceTimersByTime(3000);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should handle async callbacks', async () => {
      const results: number[] = [];
      const callback = vi.fn(async () => {
        await Promise.resolve();
        results.push(Date.now());
      });
      const poller = createPoller(callback, 1000);

      poller.start();

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(2);

      poller.stop();
    });

    it('should handle errors in async callbacks gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const callback = vi.fn(async () => {
        throw new Error('Callback error');
      });
      const poller = createPoller(callback, 1000, { immediate: true });

      expect(() => poller.start()).not.toThrow();

      vi.advanceTimersByTime(0);

      poller.stop();
      consoleErrorSpy.mockRestore();
    });

    it('should restart cleanly when start is called while running', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000);

      poller.start();
      vi.advanceTimersByTime(500);

      poller.start();

      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledTimes(1);

      poller.stop();
    });

    it('should handle multiple stop calls gracefully', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 1000);

      poller.start();
      poller.stop();
      poller.stop();
      poller.stop();
    });

    it('should work with very short intervals', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 10);

      poller.start();

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(10);

      poller.stop();
    });

    it('should work with long intervals', () => {
      const callback = vi.fn();
      const poller = createPoller(callback, 60000);

      poller.start();

      vi.advanceTimersByTime(59999);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);

      poller.stop();
    });

    it('should handle sync callback errors in immediate mode gracefully', () => {
      const callback = vi.fn(() => {
        throw new Error('Sync error');
      });
      const poller = createPoller(callback, 1000, { immediate: true });

      expect(() => poller.start()).toThrow('Sync error');
    });

    it('should handle errors in interval callbacks', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let callCount = 0;
      const callback = vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Interval error');
        }
      });
      const poller = createPoller(callback, 1000);

      poller.start();

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(3);

      poller.stop();
      consoleErrorSpy.mockRestore();
    });

    it('should return void from sync callbacks', () => {
      const callback = vi.fn(() => {});
      const poller = createPoller(callback, 1000);

      poller.start();
      vi.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalled();

      poller.stop();
    });
  });
});
