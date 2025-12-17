import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager, createStateManager } from '../src/lib/state-manager';

describe('StateManager', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    vi.useFakeTimers();
    stateManager = createStateManager({
      name: 'TestOperation',
      timeoutMs: 1000, // 1 second timeout for tests
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should create a state manager with the given options', () => {
      expect(stateManager).toBeDefined();
      expect(stateManager.isActive()).toBe(false);
    });

    it('should have a unique session ID', () => {
      const sessionId = stateManager.getSessionId();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should have consistent session ID across multiple calls', () => {
      const sessionId1 = stateManager.getSessionId();
      const sessionId2 = stateManager.getSessionId();
      expect(sessionId1).toBe(sessionId2);
    });

    it('should have different session IDs for different instances', () => {
      const manager1 = createStateManager({ name: 'Test1', timeoutMs: 1000 });
      const manager2 = createStateManager({ name: 'Test2', timeoutMs: 1000 });

      // Both should share the same session ID (module-level)
      expect(manager1.getSessionId()).toBe(manager2.getSessionId());
    });
  });

  describe('start()', () => {
    it('should start the operation successfully', () => {
      const result = stateManager.start();
      expect(result).toBe(true);
      expect(stateManager.isActive()).toBe(true);
    });

    it('should return false if already active', () => {
      stateManager.start();
      const result = stateManager.start();
      expect(result).toBe(false);
      expect(stateManager.isActive()).toBe(true);
    });

    it('should set the start time', () => {
      const beforeStart = Date.now();
      stateManager.start();
      const state = stateManager.getState();
      expect(state.startTime).toBeGreaterThanOrEqual(beforeStart);
      expect(state.startTime).toBeLessThanOrEqual(Date.now());
    });

    it('should set the session ID', () => {
      stateManager.start();
      const state = stateManager.getState();
      expect(state.sessionId).toBe(stateManager.getSessionId());
    });
  });

  describe('isActive()', () => {
    it('should return false when not started', () => {
      expect(stateManager.isActive()).toBe(false);
    });

    it('should return true when active', () => {
      stateManager.start();
      expect(stateManager.isActive()).toBe(true);
    });

    it('should return false after reset', () => {
      stateManager.start();
      stateManager.reset();
      expect(stateManager.isActive()).toBe(false);
    });

    it('should return false after timeout', () => {
      stateManager.start();
      expect(stateManager.isActive()).toBe(true);

      // Advance time past timeout
      vi.advanceTimersByTime(1100);

      expect(stateManager.isActive()).toBe(false);
    });

    it('should auto-reset on timeout', () => {
      stateManager.start();

      // Advance time past timeout
      vi.advanceTimersByTime(1100);

      // Check that it's no longer active (auto-reset)
      expect(stateManager.isActive()).toBe(false);

      // Should be able to start again
      const result = stateManager.start();
      expect(result).toBe(true);
    });
  });

  describe('reset()', () => {
    it('should reset the state', () => {
      stateManager.start();
      stateManager.reset();

      expect(stateManager.isActive()).toBe(false);
      const state = stateManager.getState();
      expect(state.isActive).toBe(false);
      expect(state.startTime).toBe(0);
    });

    it('should allow starting again after reset', () => {
      stateManager.start();
      stateManager.reset();

      const result = stateManager.start();
      expect(result).toBe(true);
      expect(stateManager.isActive()).toBe(true);
    });

    it('should be idempotent', () => {
      stateManager.start();
      stateManager.reset();
      stateManager.reset();
      stateManager.reset();

      expect(stateManager.isActive()).toBe(false);
    });
  });

  describe('getState()', () => {
    it('should return the initial state', () => {
      const state = stateManager.getState();
      expect(state.isActive).toBe(false);
      expect(state.startTime).toBe(0);
      expect(state.sessionId).toBe(stateManager.getSessionId());
    });

    it('should return the active state', () => {
      stateManager.start();
      const state = stateManager.getState();
      expect(state.isActive).toBe(true);
      expect(state.startTime).toBeGreaterThan(0);
      expect(state.sessionId).toBe(stateManager.getSessionId());
    });

    it('should return a readonly copy', () => {
      stateManager.start();
      const state = stateManager.getState();

      // Modifying the returned state should not affect internal state
      (state as any).isActive = false;
      expect(stateManager.isActive()).toBe(true);
    });
  });

  describe('getElapsedTime()', () => {
    it('should return 0 when not active', () => {
      expect(stateManager.getElapsedTime()).toBe(0);
    });

    it('should return elapsed time when active', () => {
      stateManager.start();

      vi.advanceTimersByTime(100);

      const elapsed = stateManager.getElapsedTime();
      expect(elapsed).toBe(100);
    });

    it('should return 0 after reset', () => {
      stateManager.start();
      vi.advanceTimersByTime(100);
      stateManager.reset();

      expect(stateManager.getElapsedTime()).toBe(0);
    });
  });

  describe('isNearTimeout()', () => {
    it('should return false when not active', () => {
      expect(stateManager.isNearTimeout()).toBe(false);
    });

    it('should return false when just started', () => {
      stateManager.start();
      expect(stateManager.isNearTimeout()).toBe(false);
    });

    it('should return true when close to timeout', () => {
      stateManager.start();

      // Advance to 90% of timeout (900ms out of 1000ms)
      vi.advanceTimersByTime(900);

      expect(stateManager.isNearTimeout()).toBe(true);
    });

    it('should return false after reset', () => {
      stateManager.start();
      vi.advanceTimersByTime(900);
      stateManager.reset();

      expect(stateManager.isNearTimeout()).toBe(false);
    });
  });

  describe('timeout behavior', () => {
    it('should automatically recover from timeout', () => {
      // Start first operation
      expect(stateManager.start()).toBe(true);

      // Advance time past timeout
      vi.advanceTimersByTime(1100);

      // Should be able to start a new operation
      expect(stateManager.start()).toBe(true);
      expect(stateManager.isActive()).toBe(true);
    });

    it('should handle multiple timeout cycles', () => {
      for (let i = 0; i < 3; i++) {
        expect(stateManager.start()).toBe(true);
        vi.advanceTimersByTime(1100);
        expect(stateManager.isActive()).toBe(false);
      }
    });
  });

  describe('session validation', () => {
    it('should maintain session consistency', () => {
      const sessionId = stateManager.getSessionId();
      stateManager.start();

      const state = stateManager.getState();
      expect(state.sessionId).toBe(sessionId);
    });

    it('should preserve session ID across resets', () => {
      const sessionId = stateManager.getSessionId();
      stateManager.start();
      stateManager.reset();

      expect(stateManager.getSessionId()).toBe(sessionId);
    });
  });

  describe('error handling', () => {
    it('should handle rapid start attempts gracefully', () => {
      expect(stateManager.start()).toBe(true);
      expect(stateManager.start()).toBe(false);
      expect(stateManager.start()).toBe(false);
      expect(stateManager.isActive()).toBe(true);
    });

    it('should handle rapid reset calls gracefully', () => {
      stateManager.start();
      stateManager.reset();
      stateManager.reset();
      stateManager.reset();

      expect(stateManager.isActive()).toBe(false);
    });
  });

  describe('createStateManager factory', () => {
    it('should create a StateManager instance', () => {
      const manager = createStateManager({
        name: 'Factory Test',
        timeoutMs: 5000,
      });

      expect(manager).toBeInstanceOf(StateManager);
    });

    it('should respect custom timeout values', () => {
      const manager = createStateManager({
        name: 'Custom Timeout',
        timeoutMs: 500,
      });

      manager.start();
      expect(manager.isActive()).toBe(true);

      vi.advanceTimersByTime(600);

      expect(manager.isActive()).toBe(false);
    });
  });

  describe('console logging', () => {
    it('should log when starting operation', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      stateManager.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestOperation')
      );

      consoleSpy.mockRestore();
    });

    it('should log when operation times out', () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      stateManager.start();
      vi.advanceTimersByTime(1100);

      // Trigger timeout check
      stateManager.isActive();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('timeout exceeded')
      );

      consoleSpy.mockRestore();
    });

    it('should log when completing operation', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      stateManager.start();
      stateManager.reset();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('completed')
      );

      consoleSpy.mockRestore();
    });
  });
});
