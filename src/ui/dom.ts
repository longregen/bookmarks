// CSP-safe DOM utilities. Use instead of innerHTML to avoid Firefox extension warnings.

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Generic allows callers to specify expected element type
export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el as T;
}

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

export function createSpinner(): HTMLSpanElement {
  return createElement('span', { className: 'spinner' });
}

export function setSpinnerContent(element: HTMLElement, text: string): void {
  element.textContent = '';
  element.appendChild(createSpinner());
  element.appendChild(document.createTextNode(` ${text}`));
}

/**
 * Sets sanitized HTML content on an element using DOMParser.
 * This avoids direct innerHTML assignment warnings in Firefox addon reviews
 * while still allowing sanitized HTML from trusted sources like DOMPurify.
 */
export function setSanitizedHTML(element: HTMLElement, sanitizedHTML: string): void {
  element.textContent = '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizedHTML, 'text/html');
  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) {
    fragment.appendChild(document.adoptNode(doc.body.firstChild));
  }
  element.appendChild(fragment);
}
