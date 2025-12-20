import { Context, Effect, Layer } from 'effect';
import { ConfigService } from '../lib/config-registry';
import { HealthStatusService, type HealthState, type HealthStatus } from '../lib/health-status';
import { TabsService } from '../lib/tabs';
import { runEffectWithLogging } from './ui-helpers';

// ============================================================================
// Types
// ============================================================================

interface HealthIndicatorStyle {
  readonly symbol: string;
  readonly color: string;
  readonly className: string;
}

interface HealthIndicatorElements {
  readonly indicator: HTMLElement;
  readonly dot: HTMLElement;
  readonly tooltip: HTMLElement;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get visual style for a given health state
 */
function getHealthIndicatorStyle(state: HealthState): HealthIndicatorStyle {
  switch (state) {
    case 'healthy':
      return { symbol: '●', color: '#22c55e', className: 'healthy' };
    case 'processing':
      return { symbol: '◐', color: '#3b82f6', className: 'processing' };
    case 'idle':
      return { symbol: '○', color: '#9ca3af', className: 'idle' };
    case 'error':
      return { symbol: '✕', color: '#ef4444', className: 'error' };
  }
}

// ============================================================================
// DOM Setup
// ============================================================================

/**
 * Create and attach health indicator DOM elements to container
 */
function setupHealthIndicatorElements(
  container: HTMLElement
): Effect.Effect<HealthIndicatorElements, never, never> {
  return Effect.sync(() => {
    const indicator = document.createElement('div');
    indicator.className = 'health-indicator';

    const dot = document.createElement('span');
    dot.className = 'health-indicator-dot';

    indicator.appendChild(dot);
    container.appendChild(indicator);

    const tooltip = document.createElement('div');
    tooltip.className = 'health-indicator-tooltip';
    container.style.position = 'relative';
    container.appendChild(tooltip);

    return { indicator, dot, tooltip };
  });
}

/**
 * Setup event listeners for health indicator
 */
function setupEventListeners(
  elements: HealthIndicatorElements,
  currentHealthStateRef: { current: HealthState }
): Effect.Effect<void, never, TabsService> {
  return Effect.gen(function* () {
    const tabsService = yield* TabsService;

    yield* Effect.sync(() => {
      // Show tooltip on hover
      elements.indicator.addEventListener('mouseenter', () => {
        elements.tooltip.style.opacity = '1';
      });

      elements.indicator.addEventListener('mouseleave', () => {
        elements.tooltip.style.opacity = '0';
      });

      // Navigate to jobs page on click
      elements.indicator.addEventListener('click', () => {
        const pagePath =
          currentHealthStateRef.current === 'error'
            ? 'src/jobs/jobs.html?status=failed'
            : 'src/jobs/jobs.html';

        // Run navigation effect
        runEffectWithLogging(
          tabsService.openExtensionPage(pagePath),
          'Failed to open extension page'
        );
      });
    });
  });
}

/**
 * Update indicator visual state based on current health
 */
function updateIndicator(
  elements: HealthIndicatorElements,
  currentHealthStateRef: { current: HealthState }
): Effect.Effect<void, never, HealthStatusService> {
  return Effect.gen(function* () {
    const healthService = yield* HealthStatusService;
    const health = yield* healthService.getHealthStatus().pipe(
      Effect.catchAll((error) => {
        // If health check fails, return error state
        return Effect.succeed({
          state: 'error' as const,
          message: 'Health check failed',
        });
      })
    );

    const style = getHealthIndicatorStyle(health.state);

    yield* Effect.sync(() => {
      currentHealthStateRef.current = health.state;

      elements.dot.textContent = style.symbol;
      elements.dot.style.color = style.color;

      elements.indicator.className = `health-indicator ${style.className}`;
      elements.indicator.style.cursor = 'pointer';

      elements.tooltip.textContent = health.message;
    });
  });
}

// ============================================================================
// Main Effect
// ============================================================================

/**
 * Create health indicator with periodic updates
 * Returns an Effect that provides a cleanup function
 */
export function createHealthIndicatorEffect(
  container: HTMLElement
): Effect.Effect<
  () => void,
  never,
  ConfigService | HealthStatusService | TabsService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const healthService = yield* HealthStatusService;

    // Setup DOM elements
    const elements = yield* setupHealthIndicatorElements(container);
    const currentHealthStateRef = { current: 'idle' as HealthState };

    // Setup event listeners
    yield* setupEventListeners(elements, currentHealthStateRef);

    // Perform initial update
    yield* updateIndicator(elements, currentHealthStateRef);

    // Get refresh interval from config
    const refreshIntervalMs = yield* configService.getValue('HEALTH_REFRESH_INTERVAL_MS').pipe(
      Effect.catchAll(() => Effect.succeed(5000)) // Fallback to 5 seconds
    );

    // Setup periodic updates
    const intervalId = setInterval(() => {
      // Run update effect for each interval tick
      runEffectWithLogging(
        healthService.getHealthStatus().pipe(
          Effect.tap((health) =>
            Effect.sync(() => {
              const style = getHealthIndicatorStyle(health.state);
              currentHealthStateRef.current = health.state;
              elements.dot.textContent = style.symbol;
              elements.dot.style.color = style.color;
              elements.indicator.className = `health-indicator ${style.className}`;
              elements.indicator.style.cursor = 'pointer';
              elements.tooltip.textContent = health.message;
            })
          ),
          Effect.catchAll(() => {
            // On error, show error state
            const style = getHealthIndicatorStyle('error');
            return Effect.sync(() => {
              currentHealthStateRef.current = 'error';
              elements.dot.textContent = style.symbol;
              elements.dot.style.color = style.color;
              elements.indicator.className = `health-indicator ${style.className}`;
              elements.tooltip.textContent = 'Health check failed';
            });
          })
        ),
        'Health indicator update failed'
      );
    }, refreshIntervalMs as number);

    // Return cleanup function
    return () => {
      clearInterval(intervalId);
      if (container.contains(elements.indicator)) {
        container.removeChild(elements.indicator);
      }
      if (container.contains(elements.tooltip)) {
        container.removeChild(elements.tooltip);
      }
    };
  });
}

// ============================================================================
// Alternative: Scoped Resource Management
// ============================================================================

/**
 * Create health indicator as a scoped resource
 * Automatically cleans up when scope exits
 */
export function createHealthIndicatorScoped(
  container: HTMLElement
): Effect.Effect<void, never, ConfigService | HealthStatusService | TabsService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const healthService = yield* HealthStatusService;

    // Setup DOM elements with automatic cleanup
    const elements = yield* Effect.acquireRelease(
      setupHealthIndicatorElements(container),
      (elements) =>
        Effect.sync(() => {
          if (container.contains(elements.indicator)) {
            container.removeChild(elements.indicator);
          }
          if (container.contains(elements.tooltip)) {
            container.removeChild(elements.tooltip);
          }
        })
    );

    const currentHealthStateRef = { current: 'idle' as HealthState };

    // Setup event listeners
    yield* setupEventListeners(elements, currentHealthStateRef);

    // Perform initial update
    yield* updateIndicator(elements, currentHealthStateRef);

    // Get refresh interval from config
    const refreshIntervalMs = yield* configService.getValue('HEALTH_REFRESH_INTERVAL_MS').pipe(
      Effect.catchAll(() => Effect.succeed(5000))
    );

    // Setup periodic updates with automatic cleanup
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const intervalId = setInterval(() => {
          runEffectWithLogging(
            healthService.getHealthStatus().pipe(
              Effect.tap((health) =>
                Effect.sync(() => {
                  const style = getHealthIndicatorStyle(health.state);
                  currentHealthStateRef.current = health.state;
                  elements.dot.textContent = style.symbol;
                  elements.dot.style.color = style.color;
                  elements.indicator.className = `health-indicator ${style.className}`;
                  elements.indicator.style.cursor = 'pointer';
                  elements.tooltip.textContent = health.message;
                })
              ),
              Effect.catchAll(() => Effect.void)
            ),
            'Health indicator update failed'
          );
        }, refreshIntervalMs as number);

        return intervalId;
      }),
      (intervalId) => Effect.sync(() => clearInterval(intervalId))
    );

    // Keep running indefinitely
    yield* Effect.never;
  });
}

// ============================================================================
// Service Definition (Optional)
// ============================================================================

/**
 * Service interface for health indicator operations
 * Useful if multiple parts of the app need to manage health indicators
 */
export class HealthIndicatorService extends Context.Tag('HealthIndicatorService')<
  HealthIndicatorService,
  {
    readonly create: (
      container: HTMLElement
    ) => Effect.Effect<
      () => void,
      never,
      ConfigService | HealthStatusService | TabsService
    >;
  }
>() {}

/**
 * Live implementation of HealthIndicatorService
 */
export const HealthIndicatorServiceLive: Layer.Layer<
  HealthIndicatorService,
  never,
  never
> = Layer.succeed(HealthIndicatorService, {
  create: (container: HTMLElement) => createHealthIndicatorEffect(container),
});

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a health indicator and run it with provided services
 * This is a convenience wrapper that maintains a similar API to the original
 *
 * @param container - HTML element to attach the indicator to
 * @param config - Configuration service instance
 * @param healthService - Health status service instance
 * @param tabsService - Tabs service instance
 * @returns Cleanup function
 */
export function createHealthIndicator(
  container: HTMLElement,
  config: Context.Tag.Service<ConfigService>,
  healthService: Context.Tag.Service<HealthStatusService>,
  tabsService: Context.Tag.Service<TabsService>
): () => void {
  const configLayer = Layer.succeed(ConfigService, config);
  const healthLayer = Layer.succeed(HealthStatusService, healthService);
  const tabsLayer = Layer.succeed(TabsService, tabsService);

  const appLayer = Layer.mergeAll(configLayer, healthLayer, tabsLayer);

  const cleanupEffect = createHealthIndicatorEffect(container).pipe(
    Effect.provide(appLayer)
  );

  const cleanup = Effect.runSync(cleanupEffect);
  return cleanup;
}
