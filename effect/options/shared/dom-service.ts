import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { DOMError } from './errors';

/**
 * Shared DOM service for common DOM operations
 */
export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly getElementById: <T extends HTMLElement>(id: string) => Effect.Effect<T, DOMError>;
    readonly querySelector: <T extends Element>(selector: string) => Effect.Effect<T | null, never>;
    readonly getTextContent: (element: HTMLElement) => Effect.Effect<string, never>;
    readonly setTextContent: (element: HTMLElement, text: string) => Effect.Effect<void, never>;
    readonly getValue: (element: HTMLInputElement) => Effect.Effect<string, never>;
    readonly setValue: (element: HTMLInputElement, value: string) => Effect.Effect<void, never>;
    readonly setClassName: (element: HTMLElement, className: string) => Effect.Effect<void, never>;
    readonly addClass: (element: HTMLElement, className: string) => Effect.Effect<void, never>;
    readonly removeClass: (element: HTMLElement, className: string) => Effect.Effect<void, never>;
    readonly setDisabled: (element: HTMLButtonElement, disabled: boolean) => Effect.Effect<void, never>;
    readonly addEventListener: <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      type: K,
      listener: (ev: HTMLElementEventMap[K]) => void
    ) => Effect.Effect<void, never>;
  }
>() {}

/**
 * Live implementation of DOMService
 */
export const DOMServiceLive: Layer.Layer<DOMService, never, never> = Layer.succeed(
  DOMService,
  {
    getElementById: <T extends HTMLElement>(id: string) =>
      Effect.sync(() => {
        const element = document.getElementById(id) as T | null;
        if (!element) {
          throw new DOMError({
            elementId: id,
            operation: 'get',
            message: `Element with id '${id}' not found`,
          });
        }
        return element;
      }),

    querySelector: <T extends Element>(selector: string) =>
      Effect.sync(() => document.querySelector<T>(selector)),

    getTextContent: (element: HTMLElement) =>
      Effect.sync(() => element.textContent ?? ''),

    setTextContent: (element: HTMLElement, text: string) =>
      Effect.sync(() => {
        element.textContent = text;
      }),

    getValue: (element: HTMLInputElement) =>
      Effect.sync(() => element.value),

    setValue: (element: HTMLInputElement, value: string) =>
      Effect.sync(() => {
        element.value = value;
      }),

    setClassName: (element: HTMLElement, className: string) =>
      Effect.sync(() => {
        element.className = className;
      }),

    addClass: (element: HTMLElement, className: string) =>
      Effect.sync(() => {
        element.classList.add(className);
      }),

    removeClass: (element: HTMLElement, className: string) =>
      Effect.sync(() => {
        element.classList.remove(className);
      }),

    setDisabled: (element: HTMLButtonElement, disabled: boolean) =>
      Effect.sync(() => {
        element.disabled = disabled;
      }),

    addEventListener: <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      type: K,
      listener: (ev: HTMLElementEventMap[K]) => void
    ) =>
      Effect.sync(() => {
        element.addEventListener(type, listener);
      }),
  }
);
