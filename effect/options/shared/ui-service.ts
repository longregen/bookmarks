import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

/**
 * Shared UI service for common UI operations
 */
export class UIService extends Context.Tag('UIService')<
  UIService,
  {
    readonly showStatus: (
      element: HTMLElement,
      message: string,
      type: 'success' | 'error' | 'warning' | 'info',
      duration?: number
    ) => Effect.Effect<void, never>;
  }
>() {}

/**
 * Live implementation of UIService
 */
export const UIServiceLive: Layer.Layer<UIService, never, never> = Layer.succeed(
  UIService,
  {
    showStatus: (
      element: HTMLElement,
      message: string,
      type: 'success' | 'error' | 'warning' | 'info',
      duration = 3000
    ) =>
      Effect.sync(() => {
        element.textContent = message;
        element.className = `status ${type}`;
        element.classList.remove('hidden');
        element.style.display = 'block';

        if (duration > 0) {
          setTimeout(() => {
            element.classList.add('hidden');
            element.style.display = 'none';
          }, duration);
        }
      }),
  }
);
