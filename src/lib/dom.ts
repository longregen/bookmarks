/**
 * Shared DOM utilities for CSP-safe element creation
 * Use these helpers instead of innerHTML to avoid Firefox extension warnings
 */

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
