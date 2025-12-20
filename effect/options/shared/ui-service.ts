import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from '../../lib/effect-utils';

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
    readonly hideElement: (element: HTMLElement) => Effect.Effect<void, never>;
    readonly showElement: (element: HTMLElement) => Effect.Effect<void, never>;
    readonly toggleClass: (
      element: HTMLElement,
      className: string,
      condition: boolean
    ) => Effect.Effect<void, never>;
    readonly clearElement: (element: HTMLElement) => Effect.Effect<void, never>;
  }
>() {}

/**
 * Live implementation of UIService
 */
export const UIServiceLive: Layer.Layer<UIService, never, never> = makeLayer(
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

    hideElement: (element: HTMLElement) =>
      Effect.sync(() => {
        element.classList.add('hidden');
      }),

    showElement: (element: HTMLElement) =>
      Effect.sync(() => {
        element.classList.remove('hidden');
      }),

    toggleClass: (element: HTMLElement, className: string, condition: boolean) =>
      Effect.sync(() => {
        element.classList.toggle(className, condition);
      }),

    clearElement: (element: HTMLElement) =>
      Effect.sync(() => {
        element.textContent = '';
      }),
  }
);
