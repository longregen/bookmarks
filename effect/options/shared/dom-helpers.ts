import * as Effect from 'effect/Effect';
import { DOMError, UIElementNotFoundError } from './errors';

/**
 * Options for creating DOM elements
 */
export interface CreateElementOptions {
  className?: string;
  textContent?: string;
  title?: string;
  attributes?: Record<string, string>;
}

/**
 * Create a DOM element with options and children
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: CreateElementOptions,
  children?: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (options?.className !== undefined && options.className !== '') el.className = options.className;
  if (options?.textContent !== undefined && options.textContent !== '') el.textContent = options.textContent;
  if (options?.title !== undefined && options.title !== '') el.title = options.title;

  if (options?.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      el.setAttribute(key, value);
    }
  }

  if (children) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else {
        el.appendChild(child);
      }
    }
  }

  return el;
}

/**
 * Get a required DOM element by ID (Effect version)
 */
export function getElementSafe<T extends HTMLElement>(
  id: string
): Effect.Effect<T, DOMError> {
  return Effect.sync(() => {
    const el = document.getElementById(id);
    if (!el) {
      throw new DOMError({
        elementId: id,
        operation: 'get',
        message: `Required element #${id} not found`,
      });
    }
    return el as T;
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new DOMError({
          elementId: id,
          operation: 'get',
          message: defect instanceof DOMError ? defect.message : `Failed to get element #${id}`,
          cause: defect,
        })
      )
    )
  );
}

/**
 * Get a required DOM element by ID (throws UIElementNotFoundError)
 */
export function getElement<T extends HTMLElement>(
  id: string
): Effect.Effect<T, UIElementNotFoundError> {
  return Effect.gen(function* () {
    const element = yield* Effect.sync(() => document.getElementById(id));

    if (!element) {
      return yield* Effect.fail(
        new UIElementNotFoundError({
          elementId: id,
          message: `Required element #${id} not found`,
        })
      );
    }

    return element as T;
  });
}

/**
 * Clear all children from an element
 */
export function clearChildren(element: HTMLElement): void {
  element.replaceChildren();
}
