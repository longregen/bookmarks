/**
 * Integration test for Health Monitoring cooperation in Effect.ts refactored codebase
 *
 * This test validates how health monitoring works across modules:
 * - HealthStatusService layer provision and health calculation
 * - Health state determination based on job counts
 * - Health indicator UI rendering and state management
 * - Periodic health status refresh
 * - Click navigation to jobs page
 * - Error state handling and display
 *
 * Modules involved:
 * - lib/health-status (HealthStatusService)
 * - ui/health-indicator (createHealthIndicatorEffect)
 * - library/library (uses health indicator)
 * - search/search (uses health indicator)
 * - stumble/stumble (uses health indicator)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Ref from 'effect/Ref';
import {
  HealthStatusService,
  HealthStatusServiceLive,
  HealthStorageService,
  getHealthStatus,
  type HealthStatus,
  type HealthState,
  HealthCheckError,
} from '../effect/lib/health-status';
import {
  createHealthIndicatorEffect,
  createHealthIndicator,
} from '../effect/ui/health-indicator';
import { ConfigService } from '../effect/lib/config-registry';
import { TabsService } from '../effect/lib/tabs';
import { StorageError } from '../effect/lib/errors';

// ============================================================================
// Mock Storage Service
// ============================================================================

interface JobCountState {
  pending: number;
  inProgress: number;
  failed: number;
  total: number;
  shouldFailQuery: boolean;
  queryError?: string;
}

/**
 * Create mock storage service that tracks job counts
 */
const createMockStorageService = (stateRef: Ref.Ref<JobCountState>) => ({
  queryCount: (
    table: string,
    filter: { field?: string; operator?: string; value?: unknown }
  ): Effect.Effect<number, StorageError> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      if (state.shouldFailQuery) {
        return yield* Effect.fail(
          new StorageError({
            message: state.queryError ?? 'Storage query failed',
            operation: 'queryCount',
          })
        );
      }

      if (table !== 'jobs') {
        return yield* Effect.fail(
          new StorageError({
            message: `Unknown table: ${table}`,
            operation: 'queryCount',
          })
        );
      }

      // Return count based on filter
      if (!filter.field) {
        return state.total;
      }

      if (filter.field === 'status' && filter.operator === 'eq') {
        switch (filter.value) {
          case 'pending':
            return state.pending;
          case 'in_progress':
            return state.inProgress;
          case 'failed':
            return state.failed;
          default:
            return 0;
        }
      }

      return 0;
    }),
});

/**
 * Create a test storage layer
 */
const makeTestStorageLayer = (stateRef: Ref.Ref<JobCountState>) =>
  Layer.succeed(HealthStorageService, createMockStorageService(stateRef));

// ============================================================================
// Mock Config Service
// ============================================================================

interface ConfigState {
  healthRefreshIntervalMs: number;
  shouldFailGetValue: boolean;
}

/**
 * Create mock config service
 */
const createMockConfigService = (stateRef: Ref.Ref<ConfigState>) => ({
  getValue: (key: string): Effect.Effect<unknown, Error> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      if (state.shouldFailGetValue) {
        return yield* Effect.fail(new Error('Config service failed'));
      }

      if (key === 'HEALTH_REFRESH_INTERVAL_MS') {
        return state.healthRefreshIntervalMs;
      }

      return yield* Effect.fail(new Error(`Unknown config key: ${key}`));
    }),

  setValue: (key: string, value: unknown): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (key === 'HEALTH_REFRESH_INTERVAL_MS') {
        yield* Ref.update(stateRef, (s) => ({
          ...s,
          healthRefreshIntervalMs: value as number,
        }));
      }
    }),
});

/**
 * Create a test config layer
 */
const makeTestConfigLayer = (stateRef: Ref.Ref<ConfigState>) =>
  Layer.succeed(ConfigService, createMockConfigService(stateRef));

// ============================================================================
// Mock Tabs Service
// ============================================================================

interface TabsState {
  lastOpenedPage: string | null;
  shouldFailOpen: boolean;
}

/**
 * Create mock tabs service
 */
const createMockTabsService = (stateRef: Ref.Ref<TabsState>) => ({
  openExtensionPage: (pagePath: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      if (state.shouldFailOpen) {
        return yield* Effect.fail(new Error('Failed to open extension page'));
      }

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        lastOpenedPage: pagePath,
      }));
    }),

  getExtensionUrl: (path: string): Effect.Effect<string, never> =>
    Effect.succeed(`chrome-extension://test-extension-id/${path}`),
});

/**
 * Create a test tabs layer
 */
const makeTestTabsLayer = (stateRef: Ref.Ref<TabsState>) =>
  Layer.succeed(TabsService, createMockTabsService(stateRef));

// ============================================================================
// Test Suite
// ============================================================================

describe('Health Monitoring Integration', () => {
  let jobCountState: Ref.Ref<JobCountState>;
  let configState: Ref.Ref<ConfigState>;
  let tabsState: Ref.Ref<TabsState>;

  beforeEach(async () => {
    // Initialize test state
    jobCountState = await Effect.runPromise(
      Ref.make({
        pending: 0,
        inProgress: 0,
        failed: 0,
        total: 0,
        shouldFailQuery: false,
      })
    );

    configState = await Effect.runPromise(
      Ref.make({
        healthRefreshIntervalMs: 1000,
        shouldFailGetValue: false,
      })
    );

    tabsState = await Effect.runPromise(
      Ref.make({
        lastOpenedPage: null,
        shouldFailOpen: false,
      })
    );

    // Mock timers
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ==========================================================================
  // Health Status Service Tests
  // ==========================================================================

  describe('HealthStatusService', () => {
    it('should return idle state when no jobs exist', async () => {
      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('idle');
      expect(result.message).toBe('No jobs in queue');
      expect(result.details).toEqual({
        pendingCount: 0,
        inProgressCount: 0,
        failedCount: 0,
      });
    });

    it('should return healthy state when all jobs completed', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 0,
          inProgress: 0,
          failed: 0,
          total: 10, // Jobs exist but all completed
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('healthy');
      expect(result.message).toBe('All systems healthy');
      expect(result.details).toEqual({
        pendingCount: 0,
        inProgressCount: 0,
        failedCount: 0,
      });
    });

    it('should return processing state when jobs are pending', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 5,
          inProgress: 2,
          failed: 0,
          total: 10,
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('processing');
      expect(result.message).toBe('Processing 7 jobs');
      expect(result.details).toEqual({
        pendingCount: 5,
        inProgressCount: 2,
        failedCount: 0,
      });
    });

    it('should return processing state with singular job message', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 1,
          inProgress: 0,
          failed: 0,
          total: 5,
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('processing');
      expect(result.message).toBe('Processing 1 job');
    });

    it('should return error state when jobs have failed', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 0,
          inProgress: 0,
          failed: 3,
          total: 10,
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('error');
      expect(result.message).toBe('3 failed jobs need attention');
      expect(result.details).toEqual({
        pendingCount: 0,
        inProgressCount: 0,
        failedCount: 3,
      });
    });

    it('should return error state with singular job message', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 0,
          inProgress: 0,
          failed: 1,
          total: 10,
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('error');
      expect(result.message).toBe('1 failed job needs attention');
    });

    it('should prioritize error state over processing state', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 5,
          inProgress: 2,
          failed: 1,
          total: 10,
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(Effect.provide(healthLayer))
      );

      expect(result.state).toBe('error');
      expect(result.message).toBe('1 failed job needs attention');
    });

    it('should handle storage query failures', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          shouldFailQuery: true,
          queryError: 'Database connection failed',
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

      const result = await Effect.runPromise(
        getHealthStatus().pipe(
          Effect.provide(healthLayer),
          Effect.either
        )
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(HealthCheckError);
        expect(result.left.message).toBe('Failed to query job counts');
      }
    });
  });

  // ==========================================================================
  // Health Indicator UI Tests
  // ==========================================================================

  describe('Health Indicator UI', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should create health indicator DOM elements', async () => {
      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      // Verify DOM structure
      const indicator = container.querySelector('.health-indicator');
      expect(indicator).toBeTruthy();

      const dot = indicator?.querySelector('.health-indicator-dot');
      expect(dot).toBeTruthy();

      const tooltip = container.querySelector('.health-indicator-tooltip');
      expect(tooltip).toBeTruthy();

      cleanup();
    });

    it('should display idle state correctly', async () => {
      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      const dot = container.querySelector('.health-indicator-dot') as HTMLElement;
      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      expect(indicator.className).toContain('idle');
      expect(dot.textContent).toBe('○');
      expect(dot.style.color).toBe('rgb(156, 163, 175)'); // #9ca3af
      expect(tooltip.textContent).toBe('No jobs in queue');

      cleanup();
    });

    it('should display healthy state correctly', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, total: 10 }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      const dot = container.querySelector('.health-indicator-dot') as HTMLElement;
      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      expect(indicator.className).toContain('healthy');
      expect(dot.textContent).toBe('●');
      expect(dot.style.color).toBe('rgb(34, 197, 94)'); // #22c55e
      expect(tooltip.textContent).toBe('All systems healthy');

      cleanup();
    });

    it('should display processing state correctly', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({
          ...s,
          pending: 3,
          inProgress: 2,
          total: 10,
        }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      const dot = container.querySelector('.health-indicator-dot') as HTMLElement;
      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      expect(indicator.className).toContain('processing');
      expect(dot.textContent).toBe('◐');
      expect(dot.style.color).toBe('rgb(59, 130, 246)'); // #3b82f6
      expect(tooltip.textContent).toBe('Processing 5 jobs');

      cleanup();
    });

    it('should display error state correctly', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, failed: 2, total: 10 }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      const dot = container.querySelector('.health-indicator-dot') as HTMLElement;
      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      expect(indicator.className).toContain('error');
      expect(dot.textContent).toBe('✕');
      expect(dot.style.color).toBe('rgb(239, 68, 68)'); // #ef4444
      expect(tooltip.textContent).toBe('2 failed jobs need attention');

      cleanup();
    });

    it('should show error state when health check fails', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, shouldFailQuery: true }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      expect(indicator.className).toContain('error');
      expect(tooltip.textContent).toBe('Health check failed');

      cleanup();
    });
  });

  // ==========================================================================
  // Periodic Refresh Tests
  // ==========================================================================

  describe('Periodic Refresh', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should refresh health status periodically', async () => {
      await Effect.runPromise(
        Ref.update(configState, (s) => ({ ...s, healthRefreshIntervalMs: 1000 }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      // Initial state: idle
      expect(tooltip.textContent).toBe('No jobs in queue');

      // Update job counts
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, pending: 5, total: 10 }))
      );

      // Advance timer to trigger refresh
      await vi.advanceTimersByTimeAsync(1000);

      // Should now show processing state
      expect(tooltip.textContent).toBe('Processing 5 jobs');

      // Update to failed state
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, pending: 0, failed: 2 }))
      );

      // Advance timer again
      await vi.advanceTimersByTimeAsync(1000);

      // Should now show error state
      expect(tooltip.textContent).toBe('2 failed jobs need attention');

      cleanup();
    });

    it('should use configured refresh interval', async () => {
      await Effect.runPromise(
        Ref.update(configState, (s) => ({ ...s, healthRefreshIntervalMs: 2000 }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      // Update job counts
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, pending: 3, total: 10 }))
      );

      // Advance timer by less than interval
      await vi.advanceTimersByTimeAsync(1000);

      // Should still show initial state
      expect(tooltip.textContent).toBe('No jobs in queue');

      // Advance timer to reach interval
      await vi.advanceTimersByTimeAsync(1000);

      // Should now show updated state
      expect(tooltip.textContent).toBe('Processing 3 jobs');

      cleanup();
    });

    it('should use default interval when config fails', async () => {
      await Effect.runPromise(
        Ref.update(configState, (s) => ({ ...s, shouldFailGetValue: true }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      // Update job counts
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, pending: 2, total: 10 }))
      );

      // Advance timer by default interval (5000ms)
      await vi.advanceTimersByTimeAsync(5000);

      // Should show updated state with default interval
      expect(tooltip.textContent).toBe('Processing 2 jobs');

      cleanup();
    });

    it('should stop refreshing after cleanup', async () => {
      await Effect.runPromise(
        Ref.update(configState, (s) => ({ ...s, healthRefreshIntervalMs: 1000 }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      // Call cleanup
      cleanup();

      // Update job counts
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, pending: 5, total: 10 }))
      );

      // Advance timer
      await vi.advanceTimersByTimeAsync(1000);

      // Should still show initial state (no updates after cleanup)
      expect(tooltip.textContent).toBe('No jobs in queue');
    });
  });

  // ==========================================================================
  // Navigation Tests
  // ==========================================================================

  describe('Click Navigation', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should navigate to jobs page on click', async () => {
      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;

      // Click the indicator
      indicator.click();

      // Wait for promise to resolve
      await vi.waitFor(async () => {
        const state = await Effect.runPromise(Ref.get(tabsState));
        expect(state.lastOpenedPage).toBe('src/jobs/jobs.html');
      });

      cleanup();
    });

    it('should navigate to failed jobs page when in error state', async () => {
      await Effect.runPromise(
        Ref.update(jobCountState, (s) => ({ ...s, failed: 3, total: 10 }))
      );

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;

      // Click the indicator
      indicator.click();

      // Wait for promise to resolve
      await vi.waitFor(async () => {
        const state = await Effect.runPromise(Ref.get(tabsState));
        expect(state.lastOpenedPage).toBe('src/jobs/jobs.html?status=failed');
      });

      cleanup();
    });

    it('should handle navigation errors gracefully', async () => {
      await Effect.runPromise(
        Ref.update(tabsState, (s) => ({ ...s, shouldFailOpen: true }))
      );

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;

      // Click the indicator
      indicator.click();

      // Wait for error to be logged
      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to open extension page:',
          expect.any(Error)
        );
      });

      cleanup();
      consoleErrorSpy.mockRestore();
    });

    it('should show/hide tooltip on hover', async () => {
      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      const indicator = container.querySelector('.health-indicator') as HTMLElement;
      const tooltip = container.querySelector('.health-indicator-tooltip') as HTMLElement;

      // Initial state
      expect(tooltip.style.opacity).toBe('');

      // Mouse enter
      const mouseEnterEvent = new MouseEvent('mouseenter', { bubbles: true });
      indicator.dispatchEvent(mouseEnterEvent);
      expect(tooltip.style.opacity).toBe('1');

      // Mouse leave
      const mouseLeaveEvent = new MouseEvent('mouseleave', { bubbles: true });
      indicator.dispatchEvent(mouseLeaveEvent);
      expect(tooltip.style.opacity).toBe('0');

      cleanup();
    });
  });

  // ==========================================================================
  // Convenience Function Tests
  // ==========================================================================

  describe('createHealthIndicator convenience function', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should create indicator with direct service injection', async () => {
      const storageService = createMockStorageService(jobCountState);
      const configService = createMockConfigService(configState);
      const tabsService = createMockTabsService(tabsState);

      const storageLayer = Layer.succeed(HealthStorageService, storageService);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const healthService = await Effect.runPromise(
        HealthStatusService.pipe(Effect.provide(healthLayer))
      );

      const cleanup = createHealthIndicator(
        container,
        configService,
        healthService,
        tabsService
      );

      // Verify DOM structure
      const indicator = container.querySelector('.health-indicator');
      expect(indicator).toBeTruthy();

      cleanup();
    });
  });

  // ==========================================================================
  // DOM Cleanup Tests
  // ==========================================================================

  describe('DOM Cleanup', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should remove DOM elements on cleanup', async () => {
      const storageLayer = makeTestStorageLayer(jobCountState);
      const configLayer = makeTestConfigLayer(configState);
      const tabsLayer = makeTestTabsLayer(tabsState);
      const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));
      const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

      const cleanup = await Effect.runPromise(
        createHealthIndicatorEffect(container).pipe(Effect.provide(appLayer))
      );

      // Verify elements exist
      expect(container.querySelector('.health-indicator')).toBeTruthy();
      expect(container.querySelector('.health-indicator-tooltip')).toBeTruthy();

      // Cleanup
      cleanup();

      // Verify elements removed
      expect(container.querySelector('.health-indicator')).toBeFalsy();
      expect(container.querySelector('.health-indicator-tooltip')).toBeFalsy();
    });
  });
});
