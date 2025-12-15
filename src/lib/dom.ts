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

/**
 * Create a DOM element safely without innerHTML
 * @param tag HTML tag name
 * @param options Element options (className, textContent, href, etc.)
 * @param children Child elements or text strings to append
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: CreateElementOptions,
  children?: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (options?.className) el.className = options.className;
  if (options?.textContent) el.textContent = options.textContent;
  if (options?.title) el.title = options.title;
  if (options?.style) Object.assign(el.style, options.style);

  if (options?.href && 'href' in el) {
    (el as HTMLAnchorElement).href = options.href;
  }
  if (options?.target && 'target' in el) {
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
 * Show a temporary status message in a status div
 * @param statusDiv The status div element
 * @param message Message to display
 * @param type Type of status (success, error, warning)
 * @param timeoutMs Duration to show the message (default: 3000ms)
 */
export function showStatusMessage(
  statusDiv: HTMLElement,
  message: string,
  type: 'success' | 'error' | 'warning',
  timeoutMs: number = 3000
): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');

  setTimeout(() => {
    statusDiv.classList.add('hidden');
  }, timeoutMs);
}
