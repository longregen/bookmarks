/**
 * Shared DOM utilities for CSP-safe element creation
 * Use these helpers instead of innerHTML to avoid Firefox extension warnings
 */

/**
 * Get a required DOM element by ID. Throws if not found.
 * Returns a properly typed non-null element, eliminating the need for ! assertions.
 *
 * @example
 * const btn = getElement<HTMLButtonElement>('submitBtn');
 * btn.disabled = true; // No ! needed, type is HTMLButtonElement
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Generic allows callers to specify expected element type
export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el as T;
}

/**
 * Get multiple required DOM elements by ID. Throws if any are not found.
 * Useful for validating multiple elements at once.
 *
 * @example
 * const [list, count] = getElements('bookmarkList', 'bookmarkCount');
 */
export function getElements<T extends HTMLElement = HTMLElement>(...ids: string[]): T[] {
  return ids.map(id => getElement<T>(id));
}

export interface CreateElementOptions {
  className?: string;
  textContent?: string;
  href?: string;
  target?: string;
  title?: string;
  style?: Partial<CSSStyleDeclaration>;
  attributes?: Record<string, string>;
}

// eslint-disable-next-line complexity
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: CreateElementOptions,
  children?: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (options?.className !== undefined && options.className !== '') el.className = options.className;
  if (options?.textContent !== undefined && options.textContent !== '') el.textContent = options.textContent;
  if (options?.title !== undefined && options.title !== '') el.title = options.title;
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

export function showStatusMessage(
  statusDiv: HTMLElement,
  message: string,
  type: 'success' | 'error' | 'warning',
  timeoutMs = 3000
): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');

  setTimeout(() => {
    statusDiv.classList.add('hidden');
  }, timeoutMs);
}
