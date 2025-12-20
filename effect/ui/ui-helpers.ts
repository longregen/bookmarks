import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';

// ============================================================================
// Errors
// ============================================================================

export class UIOperationError extends Data.TaggedError('UIOperationError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Button State Management
// ============================================================================

/**
 * Manages button state during an async operation.
 * Disables the button and changes text while the effect runs,
 * then restores original state afterwards.
 *
 * @param button - The button element to manage
 * @param loadingText - Text to display while effect is running
 * @param effect - The effect to execute
 * @returns Effect that manages button state and executes the given effect
 */
export function withButtonState<A, E, R>(
  button: HTMLButtonElement,
  loadingText: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const originalText = button.textContent || '';
    const wasDisabled = button.disabled;

    yield* Effect.sync(() => {
      button.disabled = true;
      button.textContent = loadingText;
    });

    try {
      return yield* effect;
    } finally {
      yield* Effect.sync(() => {
        button.disabled = wasDisabled;
        button.textContent = originalText;
      });
    }
  });
}

// ============================================================================
// Fragment Rendering
// ============================================================================

/**
 * Clears a container and renders elements using DocumentFragment for performance.
 * Uses a single DOM operation to minimize reflows.
 *
 * @param container - The container element to render into
 * @param elements - Elements to render
 * @returns Effect that performs the render
 */
export function renderToContainer(
  container: HTMLElement,
  elements: readonly HTMLElement[]
): Effect.Effect<void, UIOperationError> {
  return Effect.try({
    try: () => {
      const fragment = document.createDocumentFragment();
      for (const element of elements) {
        fragment.appendChild(element);
      }
      container.innerHTML = '';
      container.appendChild(fragment);
    },
    catch: (error) =>
      new UIOperationError({
        operation: 'render',
        message: 'Failed to render elements to container',
        cause: error,
      }),
  });
}

/**
 * Creates a DocumentFragment and appends elements to it.
 *
 * @param elements - Elements to add to the fragment
 * @returns Effect that creates and populates the fragment
 */
export function createFragment(
  elements: readonly HTMLElement[]
): Effect.Effect<DocumentFragment, never> {
  return Effect.sync(() => {
    const fragment = document.createDocumentFragment();
    for (const element of elements) {
      fragment.appendChild(element);
    }
    return fragment;
  });
}

// ============================================================================
// Event Handler Management
// ============================================================================

export interface EventListenerConfig<K extends keyof HTMLElementEventMap> {
  readonly element: HTMLElement;
  readonly event: K;
  readonly handler: (event: HTMLElementEventMap[K]) => void;
  readonly options?: boolean | AddEventListenerOptions;
}

/**
 * Adds an event listener with cleanup tracking.
 * Returns a cleanup function that removes the listener.
 *
 * @param config - Event listener configuration
 * @returns Effect that adds the listener and returns cleanup function
 */
export function addEventListenerWithCleanup<K extends keyof HTMLElementEventMap>(
  config: EventListenerConfig<K>
): Effect.Effect<() => void, never> {
  return Effect.sync(() => {
    config.element.addEventListener(
      config.event,
      config.handler as EventListener,
      config.options
    );

    return () => {
      config.element.removeEventListener(
        config.event,
        config.handler as EventListener,
        config.options
      );
    };
  });
}

/**
 * Adds multiple event listeners and returns a cleanup function that removes all.
 *
 * @param configs - Array of event listener configurations
 * @returns Effect that adds all listeners and returns cleanup function
 */
export function addEventListenersWithCleanup(
  configs: readonly EventListenerConfig<keyof HTMLElementEventMap>[]
): Effect.Effect<() => void, never> {
  return Effect.gen(function* () {
    const cleanups: Array<() => void> = [];

    for (const config of configs) {
      const cleanup = yield* addEventListenerWithCleanup(config);
      cleanups.push(cleanup);
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  });
}

// ============================================================================
// Effect Runtime Helpers
// ============================================================================

/**
 * Runs an effect and logs errors to console.
 * Useful for event handlers and callbacks that can't propagate errors.
 *
 * @param effect - The effect to run
 * @param errorPrefix - Optional prefix for error log message
 * @returns Promise that resolves when effect completes
 */
export function runEffectWithLogging<A, E>(
  effect: Effect.Effect<A, E>,
  errorPrefix = 'Effect failed'
): Promise<void> {
  return Effect.runPromise(effect).catch((error) => {
    console.error(`${errorPrefix}:`, error);
  });
}

/**
 * Runs an effect in an event handler context.
 * Catches errors and logs them, preventing unhandled promise rejections.
 *
 * @param effect - The effect to run
 * @returns Event handler function
 */
export function createEffectEventHandler<E, R>(
  effectFn: () => Effect.Effect<void, E, R>
): () => void {
  return () => {
    runEffectWithLogging(effectFn(), 'Event handler failed');
  };
}

// ============================================================================
// Cleanup Management
// ============================================================================

export interface CleanupTracker {
  readonly add: (cleanup: () => void) => void;
  readonly cleanup: () => void;
}

/**
 * Creates a cleanup tracker that can collect and execute multiple cleanup functions.
 *
 * @returns Cleanup tracker object
 */
export function createCleanupTracker(): CleanupTracker {
  const cleanups: Array<() => void> = [];

  return {
    add: (cleanup: () => void) => {
      cleanups.push(cleanup);
    },
    cleanup: () => {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (error) {
          console.error('Cleanup function failed:', error);
        }
      }
      cleanups.length = 0;
    },
  };
}

/**
 * Attaches a cleanup function to an element's custom property.
 * Useful for components that need to cleanup event listeners when re-rendered.
 *
 * @param element - The element to attach cleanup to
 * @param cleanup - The cleanup function
 */
export function attachCleanup(
  element: HTMLElement & { _cleanup?: () => void },
  cleanup: () => void
): Effect.Effect<void, never> {
  return Effect.sync(() => {
    if (element._cleanup) {
      element._cleanup();
    }
    element._cleanup = cleanup;
  });
}

/**
 * Executes and clears any cleanup function attached to an element.
 *
 * @param element - The element to cleanup
 */
export function executeAttachedCleanup(
  element: HTMLElement & { _cleanup?: () => void }
): Effect.Effect<void, never> {
  return Effect.sync(() => {
    if (element._cleanup) {
      element._cleanup();
      element._cleanup = undefined;
    }
  });
}
