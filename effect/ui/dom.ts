// CSP-safe DOM utilities refactored for Effect.ts
// Use instead of innerHTML to avoid Firefox extension warnings.

import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

// ============================================================================
// Errors
// ============================================================================

export class DOMError extends Data.TaggedError('DOMError')<{
  readonly reason: 'element_not_found' | 'invalid_element' | 'parse_error';
  readonly elementId?: string;
  readonly details?: string;
}> {}

// ============================================================================
// Types
// ============================================================================

export interface CreateElementOptions {
  className?: string;
  textContent?: string;
  href?: string;
  target?: string;
  title?: string;
  style?: Partial<CSSStyleDeclaration>;
  attributes?: Record<string, string>;
}

export type StatusType = 'success' | 'error' | 'warning';

// ============================================================================
// DOMService Interface
// ============================================================================

export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    /**
     * Gets an element by ID. Fails with DOMError if element not found.
     */
    getElement: <T extends HTMLElement = HTMLElement>(
      id: string
    ) => Effect.Effect<T, DOMError>;

    /**
     * Creates an HTML element with options and children.
     */
    createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: CreateElementOptions,
      children?: (HTMLElement | Text | string)[]
    ) => Effect.Effect<HTMLElementTagNameMap[K], never>;

    /**
     * Shows a status message that auto-hides after timeout.
     */
    showStatusMessage: (
      statusDiv: HTMLElement,
      message: string,
      type: StatusType,
      timeoutMs?: number
    ) => Effect.Effect<void, never>;

    /**
     * Creates a spinner element.
     */
    createSpinner: () => Effect.Effect<HTMLSpanElement, never>;

    /**
     * Sets element content with a spinner and text.
     */
    setSpinnerContent: (
      element: HTMLElement,
      text: string
    ) => Effect.Effect<void, never>;

    /**
     * Sets sanitized HTML content using DOMParser.
     * Avoids direct innerHTML assignment warnings in Firefox.
     */
    setSanitizedHTML: (
      element: HTMLElement,
      sanitizedHTML: string
    ) => Effect.Effect<void, DOMError>;
  }
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

const makeDOMService = (): Effect.Effect<
  Context.Tag.Service<DOMService>,
  never
> =>
  Effect.sync(() => ({
    getElement: <T extends HTMLElement = HTMLElement>(id: string) =>
      Effect.sync(() => {
        const el = document.getElementById(id);
        if (!el) {
          throw new DOMError({
            reason: 'element_not_found',
            elementId: id,
            details: `Required element #${id} not found`,
          });
        }
        return el as T;
      }),

    createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: CreateElementOptions,
      children?: (HTMLElement | Text | string)[]
    ) =>
      Effect.sync(() => {
        const el = document.createElement(tag);

        if (options?.className !== undefined && options.className !== '')
          el.className = options.className;
        if (options?.textContent !== undefined && options.textContent !== '')
          el.textContent = options.textContent;
        if (options?.title !== undefined && options.title !== '')
          el.title = options.title;
        if (options?.style) Object.assign(el.style, options.style);

        if (
          options?.href !== undefined &&
          options.href !== '' &&
          'href' in el
        ) {
          (el as HTMLAnchorElement).href = options.href;
        }
        if (
          options?.target !== undefined &&
          options.target !== '' &&
          'target' in el
        ) {
          (el as HTMLAnchorElement).target = options.target;
        }

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
      }),

    showStatusMessage: (
      statusDiv: HTMLElement,
      message: string,
      type: StatusType,
      timeoutMs = 3000
    ) =>
      Effect.sync(() => {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.classList.remove('hidden');

        setTimeout(() => {
          statusDiv.classList.add('hidden');
        }, timeoutMs);
      }),

    createSpinner: () =>
      Effect.sync(() => document.createElement('span')).pipe(
        Effect.tap((span) =>
          Effect.sync(() => {
            span.className = 'spinner';
          })
        )
      ),

    setSpinnerContent: (element: HTMLElement, text: string) =>
      Effect.gen(function* () {
        element.textContent = '';
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        element.appendChild(spinner);
        element.appendChild(document.createTextNode(` ${text}`));
      }),

    setSanitizedHTML: (element: HTMLElement, sanitizedHTML: string) =>
      Effect.try({
        try: () => {
          element.textContent = '';
          const parser = new DOMParser();
          const doc = parser.parseFromString(sanitizedHTML, 'text/html');

          // Check for parse errors
          const parserError = doc.querySelector('parsererror');
          if (parserError) {
            throw new DOMError({
              reason: 'parse_error',
              details: 'Failed to parse HTML content',
            });
          }

          const fragment = document.createDocumentFragment();
          while (doc.body.firstChild) {
            fragment.appendChild(document.adoptNode(doc.body.firstChild));
          }
          element.appendChild(fragment);
        },
        catch: (error) => {
          if (error instanceof DOMError) {
            return error;
          }
          return new DOMError({
            reason: 'parse_error',
            details:
              error instanceof Error
                ? error.message
                : 'Unknown error parsing HTML',
          });
        },
      }),
  }));

// ============================================================================
// Layer
// ============================================================================

/**
 * Default DOMService layer for browser environments.
 */
export const DOMServiceLive: Layer.Layer<DOMService, never> = Layer.effect(
  DOMService,
  makeDOMService()
);

// ============================================================================
// Convenience Functions (for backward compatibility)
// ============================================================================

/**
 * Gets an element by ID. Throws if not found.
 * For use in contexts where Effect runtime is not available.
 */
export function getElement<T extends HTMLElement = HTMLElement>(
  id: string
): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el as T;
}

/**
 * Creates an HTML element with options and children.
 * For use in contexts where Effect runtime is not available.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: CreateElementOptions,
  children?: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (options?.className !== undefined && options.className !== '')
    el.className = options.className;
  if (options?.textContent !== undefined && options.textContent !== '')
    el.textContent = options.textContent;
  if (options?.title !== undefined && options.title !== '')
    el.title = options.title;
  if (options?.style) Object.assign(el.style, options.style);

  if (options?.href !== undefined && options.href !== '' && 'href' in el) {
    (el as HTMLAnchorElement).href = options.href;
  }
  if (options?.target !== undefined && options.target !== '' && 'target' in el) {
    (el as HTMLAnchorElement).target = options.target;
  }

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
 * Shows a status message that auto-hides.
 * For use in contexts where Effect runtime is not available.
 */
export function showStatusMessage(
  statusDiv: HTMLElement,
  message: string,
  type: StatusType,
  timeoutMs = 3000
): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');

  setTimeout(() => {
    statusDiv.classList.add('hidden');
  }, timeoutMs);
}

/**
 * Creates a spinner element.
 * For use in contexts where Effect runtime is not available.
 */
export function createSpinner(): HTMLSpanElement {
  return createElement('span', { className: 'spinner' });
}

/**
 * Sets element content with a spinner and text.
 * For use in contexts where Effect runtime is not available.
 */
export function setSpinnerContent(element: HTMLElement, text: string): void {
  element.textContent = '';
  element.appendChild(createSpinner());
  element.appendChild(document.createTextNode(` ${text}`));
}

/**
 * Sets sanitized HTML content using DOMParser.
 * For use in contexts where Effect runtime is not available.
 */
export function setSanitizedHTML(
  element: HTMLElement,
  sanitizedHTML: string
): void {
  element.textContent = '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizedHTML, 'text/html');
  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) {
    fragment.appendChild(document.adoptNode(doc.body.firstChild));
  }
  element.appendChild(fragment);
}
