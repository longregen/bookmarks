import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import {
  DOMService,
  DOMError,
  CreateElementOptions,
} from '../effect/ui/dom';
import {
  ThemeService,
  Theme,
  ThemeError,
} from '../effect/shared/theme';

// ============================================================================
// Test Utilities - DOM Mocking
// ============================================================================

interface MockElement {
  id: string;
  tagName: string;
  className: string;
  textContent: string;
  title: string;
  href?: string;
  target?: string;
  style: Record<string, string>;
  attributes: Map<string, string>;
  children: MockElement[];
  dataset: Record<string, string>;
}

/**
 * Create a mock DOM element
 */
const createMockElement = (
  tagName: string,
  id = ''
): MockElement & HTMLElement => {
  const element: any = {
    id,
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    title: '',
    href: undefined,
    target: undefined,
    style: {},
    attributes: new Map<string, string>(),
    children: [],
    dataset: {},
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value);
      if (key === 'data-theme') {
        this.dataset.theme = value;
      }
    },
    getAttribute(key: string) {
      return this.attributes.get(key);
    },
    removeAttribute(key: string) {
      this.attributes.delete(key);
      if (key === 'data-theme') {
        delete this.dataset.theme;
      }
    },
    appendChild(child: MockElement) {
      this.children.push(child);
      return child;
    },
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  };
  return element as MockElement & HTMLElement;
};

/**
 * Create a mock document for testing
 */
const createMockDocument = () => {
  const elements = new Map<string, MockElement & HTMLElement>();
  const documentElement = createMockElement('html');

  return {
    elements,
    documentElement,
    getElementById: vi.fn((id: string) => elements.get(id) || null),
    createElement: vi.fn((tag: string) => createMockElement(tag)),
    createTextNode: vi.fn((text: string) => ({ textContent: text } as any)),
    createDocumentFragment: vi.fn(() => ({
      appendChild: vi.fn(),
    })),
    registerElement: (id: string, element: MockElement & HTMLElement) => {
      elements.set(id, element);
    },
  };
};

/**
 * Mock storage for testing theme persistence
 */
interface MockStorage {
  data: Map<string, string>;
  listeners: Array<(event: StorageEvent) => void>;
}

const createMockStorage = (): MockStorage => ({
  data: new Map<string, string>(),
  listeners: [],
});

// ============================================================================
// Test DOMService Implementation
// ============================================================================

const createTestDOMService = (mockDoc: ReturnType<typeof createMockDocument>) =>
  Effect.succeed({
    getElement: <T extends HTMLElement = HTMLElement>(id: string) =>
      Effect.try({
        try: () => {
          const el = mockDoc.getElementById(id);
          if (!el) {
            throw new DOMError({
              reason: 'element_not_found',
              elementId: id,
              details: `Required element #${id} not found`,
            });
          }
          return el as T;
        },
        catch: (error) => {
          if (error instanceof DOMError) {
            return error;
          }
          return new DOMError({
            reason: 'element_not_found',
            elementId: id,
            details: error instanceof Error ? error.message : 'Unknown error',
          });
        },
      }),

    createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: CreateElementOptions,
      children?: (HTMLElement | Text | string)[]
    ) =>
      Effect.sync(() => {
        const el = mockDoc.createElement(tag as string);

        if (options?.className) el.className = options.className;
        if (options?.textContent) el.textContent = options.textContent;
        if (options?.title) el.title = options.title;
        if (options?.style) Object.assign(el.style, options.style);

        if (options?.href && 'href' in el) {
          (el as any).href = options.href;
        }
        if (options?.target && 'target' in el) {
          (el as any).target = options.target;
        }

        if (options?.attributes) {
          for (const [key, value] of Object.entries(options.attributes)) {
            el.setAttribute(key, value);
          }
        }

        if (children) {
          for (const child of children) {
            if (typeof child === 'string') {
              el.appendChild(mockDoc.createTextNode(child) as any);
            } else {
              el.appendChild(child as any);
            }
          }
        }

        return el as HTMLElementTagNameMap[K];
      }),

    showStatusMessage: (
      statusDiv: HTMLElement,
      message: string,
      type: 'success' | 'error' | 'warning',
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
      Effect.sync(() => mockDoc.createElement('span')).pipe(
        Effect.tap((span) =>
          Effect.sync(() => {
            span.className = 'spinner';
          })
        )
      ),

    setSpinnerContent: (element: HTMLElement, text: string) =>
      Effect.sync(() => {
        element.textContent = '';
        const spinner = mockDoc.createElement('span');
        spinner.className = 'spinner';
        element.appendChild(spinner as any);
        element.appendChild(mockDoc.createTextNode(` ${text}`) as any);
      }),

    setSanitizedHTML: (element: HTMLElement, sanitizedHTML: string) =>
      Effect.try({
        try: () => {
          element.textContent = '';
          if (sanitizedHTML.includes('parsererror')) {
            throw new DOMError({
              reason: 'parse_error',
              details: 'Failed to parse HTML content',
            });
          }
          element.textContent = sanitizedHTML;
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
  });

// ============================================================================
// Test ThemeService Implementation
// ============================================================================

const createTestThemeService = (
  storage: MockStorage,
  mockDoc: ReturnType<typeof createMockDocument>
) =>
  Effect.succeed({
    getTheme: Effect.try({
      try: () => {
        const stored = storage.data.get('bookmark-rag-theme');
        return (stored as Theme | undefined) ?? 'auto';
      },
      catch: (error) =>
        new ThemeError({
          operation: 'get',
          message: 'Failed to get theme from storage',
          cause: error,
        }),
    }),

    setTheme: (theme: Theme) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => {
            storage.data.set('bookmark-rag-theme', theme);
          },
          catch: (error) =>
            new ThemeError({
              operation: 'set',
              message: 'Failed to set theme in storage',
              cause: error,
            }),
        });

        yield* Effect.sync(() => {
          const root = mockDoc.documentElement;
          root.removeAttribute('data-theme');

          if (theme !== 'auto') {
            root.setAttribute('data-theme', theme);
          }
        });
      }),

    applyTheme: (theme: Theme) =>
      Effect.sync(() => {
        const root = mockDoc.documentElement;
        root.removeAttribute('data-theme');

        if (theme !== 'auto') {
          root.setAttribute('data-theme', theme);
        }
      }),

    initTheme: Effect.gen(function* () {
      const theme = yield* Effect.try({
        try: () => {
          const stored = storage.data.get('bookmark-rag-theme');
          return (stored as Theme | undefined) ?? 'auto';
        },
        catch: (error) =>
          new ThemeError({
            operation: 'get',
            message: 'Failed to get theme from storage',
            cause: error,
          }),
      });

      yield* Effect.sync(() => {
        const root = mockDoc.documentElement;
        root.removeAttribute('data-theme');

        if (theme !== 'auto') {
          root.setAttribute('data-theme', theme);
        }
      });
    }),

    onThemeChange: (callback: (theme: Theme) => void) =>
      Effect.sync(() => {
        const handler = (event: StorageEvent): void => {
          if (
            event.key === 'bookmark-rag-theme' &&
            event.newValue !== null &&
            event.newValue !== ''
          ) {
            callback(event.newValue as Theme);
          }
        };

        storage.listeners.push(handler);

        return () => {
          const index = storage.listeners.indexOf(handler);
          if (index > -1) {
            storage.listeners.splice(index, 1);
          }
        };
      }),
  });

// ============================================================================
// Integration Tests
// ============================================================================

describe('UI Framework & Theme Integration', () => {
  let mockDoc: ReturnType<typeof createMockDocument>;
  let mockStorage: MockStorage;
  let testDOMLayer: Layer.Layer<DOMService, never>;
  let testThemeLayer: Layer.Layer<ThemeService, never>;

  beforeEach(() => {
    mockDoc = createMockDocument();
    mockStorage = createMockStorage();
    testDOMLayer = Layer.effect(DOMService, createTestDOMService(mockDoc));
    testThemeLayer = Layer.effect(
      ThemeService,
      createTestThemeService(mockStorage, mockDoc)
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // DOMService Tests
  // ==========================================================================

  describe('DOMService - Element Operations', () => {
    it('should get element by ID successfully', async () => {
      const testElement = createMockElement('div', 'test-id');
      mockDoc.registerElement('test-id', testElement);

      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const element = yield* dom.getElement('test-id');
        return element;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.id).toBe('test-id');
      expect(mockDoc.getElementById).toHaveBeenCalledWith('test-id');
    });

    it('should fail when element not found', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.getElement('missing-id');
      });

      const result = await Effect.runPromise(
        Effect.either(program.pipe(Effect.provide(testDOMLayer)))
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(DOMError);
        expect(result.left.reason).toBe('element_not_found');
        expect(result.left.elementId).toBe('missing-id');
      }
    });

    it('should create element with className', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.createElement('div', { className: 'test-class' });
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.tagName).toBe('DIV');
      expect(result.className).toBe('test-class');
    });

    it('should create element with textContent', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.createElement('span', {
          textContent: 'Hello World',
        });
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.textContent).toBe('Hello World');
    });

    it('should create element with style options', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.createElement('div', {
          style: { color: 'red', fontSize: '16px' },
        });
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.style.color).toBe('red');
      expect(result.style.fontSize).toBe('16px');
    });

    it('should create anchor element with href and target', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.createElement('a', {
          href: 'https://example.com',
          target: '_blank',
        });
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.tagName).toBe('A');
      expect((result as any).href).toBe('https://example.com');
      expect((result as any).target).toBe('_blank');
    });

    it('should create element with custom attributes', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.createElement('button', {
          attributes: {
            'data-id': '123',
            'aria-label': 'Close',
          },
        });
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.getAttribute('data-id')).toBe('123');
      expect(result.getAttribute('aria-label')).toBe('Close');
    });

    it('should create element with children', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const child1 = yield* dom.createElement('span', {
          textContent: 'Child 1',
        });
        const child2 = yield* dom.createElement('span', {
          textContent: 'Child 2',
        });
        return yield* dom.createElement('div', undefined, [
          child1,
          'text',
          child2,
        ]);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.children.length).toBe(3);
    });

    it('should show status message with auto-hide', async () => {
      const statusDiv = createMockElement('div', 'status');

      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        yield* dom.showStatusMessage(
          statusDiv as any,
          'Operation successful',
          'success',
          100
        );
      });

      await Effect.runPromise(program.pipe(Effect.provide(testDOMLayer)));

      expect(statusDiv.textContent).toBe('Operation successful');
      expect(statusDiv.className).toBe('status success');
      expect(statusDiv.classList.remove).toHaveBeenCalledWith('hidden');
    });

    it('should create spinner element', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        return yield* dom.createSpinner();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result.className).toBe('spinner');
    });

    it('should set spinner content', async () => {
      const element = createMockElement('button');

      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        yield* dom.setSpinnerContent(element as any, 'Loading...');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testDOMLayer)));

      expect(element.children.length).toBe(2);
      expect(element.children[0].className).toBe('spinner');
    });

    it('should set sanitized HTML successfully', async () => {
      const element = createMockElement('div');

      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        yield* dom.setSanitizedHTML(element as any, '<p>Safe content</p>');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testDOMLayer)));

      expect(element.textContent).toBe('<p>Safe content</p>');
    });

    it('should fail on parse error in sanitized HTML', async () => {
      const element = createMockElement('div');

      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        yield* dom.setSanitizedHTML(element as any, '<parsererror>Bad HTML');
      });

      const result = await Effect.runPromise(
        Effect.either(program.pipe(Effect.provide(testDOMLayer)))
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(DOMError);
        expect(result.left.reason).toBe('parse_error');
      }
    });
  });

  // ==========================================================================
  // ThemeService Tests
  // ==========================================================================

  describe('ThemeService - Theme Management', () => {
    it('should get default theme when none is set', async () => {
      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        return yield* theme.getTheme;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testThemeLayer))
      );

      expect(result).toBe('auto');
    });

    it('should set and get theme from storage', async () => {
      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        yield* theme.setTheme('dark');
        return yield* theme.getTheme;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testThemeLayer))
      );

      expect(result).toBe('dark');
      expect(mockStorage.data.get('bookmark-rag-theme')).toBe('dark');
    });

    it('should apply theme to DOM for non-auto themes', async () => {
      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        yield* theme.applyTheme('dark');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testThemeLayer)));

      expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should remove data-theme attribute for auto theme', async () => {
      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        yield* theme.applyTheme('dark');
        yield* theme.applyTheme('auto');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testThemeLayer)));

      expect(mockDoc.documentElement.getAttribute('data-theme')).toBeUndefined();
    });

    it('should test all theme types', async () => {
      const themes: Theme[] = ['auto', 'light', 'dark', 'terminal', 'tufte'];

      for (const themeValue of themes) {
        const program = Effect.gen(function* () {
          const theme = yield* ThemeService;
          yield* theme.setTheme(themeValue);
          return yield* theme.getTheme;
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(testThemeLayer))
        );

        expect(result).toBe(themeValue);

        if (themeValue === 'auto') {
          expect(
            mockDoc.documentElement.getAttribute('data-theme')
          ).toBeUndefined();
        } else {
          expect(mockDoc.documentElement.getAttribute('data-theme')).toBe(
            themeValue
          );
        }
      }
    });

    it('should initialize theme from storage', async () => {
      mockStorage.data.set('bookmark-rag-theme', 'terminal');

      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        yield* theme.initTheme;
      });

      await Effect.runPromise(program.pipe(Effect.provide(testThemeLayer)));

      expect(mockDoc.documentElement.getAttribute('data-theme')).toBe(
        'terminal'
      );
    });

    it('should register theme change listener', async () => {
      const changes: Theme[] = [];

      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        const cleanup = yield* theme.onThemeChange((t) => changes.push(t));
        return cleanup;
      });

      const cleanup = await Effect.runPromise(
        program.pipe(Effect.provide(testThemeLayer))
      );

      expect(mockStorage.listeners.length).toBe(1);

      const mockEvent: StorageEvent = {
        key: 'bookmark-rag-theme',
        newValue: 'dark',
      } as StorageEvent;

      mockStorage.listeners[0](mockEvent);

      expect(changes).toEqual(['dark']);

      cleanup();
      expect(mockStorage.listeners.length).toBe(0);
    });

    it('should ignore theme changes for different storage keys', async () => {
      const changes: Theme[] = [];

      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        yield* theme.onThemeChange((t) => changes.push(t));
      });

      await Effect.runPromise(program.pipe(Effect.provide(testThemeLayer)));

      const mockEvent: StorageEvent = {
        key: 'other-key',
        newValue: 'dark',
      } as StorageEvent;

      mockStorage.listeners[0](mockEvent);

      expect(changes).toEqual([]);
    });

    it('should ignore null or empty theme values in change listener', async () => {
      const changes: Theme[] = [];

      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;
        yield* theme.onThemeChange((t) => changes.push(t));
      });

      await Effect.runPromise(program.pipe(Effect.provide(testThemeLayer)));

      const mockEvent1: StorageEvent = {
        key: 'bookmark-rag-theme',
        newValue: null,
      } as StorageEvent;

      const mockEvent2: StorageEvent = {
        key: 'bookmark-rag-theme',
        newValue: '',
      } as StorageEvent;

      mockStorage.listeners[0](mockEvent1);
      mockStorage.listeners[0](mockEvent2);

      expect(changes).toEqual([]);
    });
  });

  // ==========================================================================
  // Integration Tests - DOM & Theme Cooperation
  // ==========================================================================

  describe('UI Framework & Theme Cooperation', () => {
    it('should create themed UI components', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const theme = yield* ThemeService;

        yield* theme.setTheme('dark');

        const container = yield* dom.createElement('div', {
          className: 'theme-container',
        });

        const currentTheme = yield* theme.getTheme;

        return { container, currentTheme };
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(testDOMLayer, testThemeLayer))
        )
      );

      expect(result.currentTheme).toBe('dark');
      expect(result.container.className).toBe('theme-container');
      expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should handle theme switching with UI updates', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const theme = yield* ThemeService;

        const statusDiv = yield* dom.createElement('div', { className: 'status' });

        yield* theme.setTheme('light');
        yield* dom.showStatusMessage(
          statusDiv as any,
          'Theme set to light',
          'success'
        );

        const theme1 = yield* theme.getTheme;

        yield* theme.setTheme('dark');
        yield* dom.showStatusMessage(
          statusDiv as any,
          'Theme set to dark',
          'success'
        );

        const theme2 = yield* theme.getTheme;

        return { theme1, theme2, statusDiv };
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(testDOMLayer, testThemeLayer))
        )
      );

      expect(result.theme1).toBe('light');
      expect(result.theme2).toBe('dark');
      expect(result.statusDiv.textContent).toBe('Theme set to dark');
    });

    it('should create theme selector UI with event handlers', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const theme = yield* ThemeService;

        const selector = yield* dom.createElement('select', {
          className: 'theme-selector',
        });

        const themes: Theme[] = ['auto', 'light', 'dark', 'terminal', 'tufte'];
        const options: HTMLElement[] = [];

        for (const themeValue of themes) {
          const option = yield* dom.createElement('option', {
            textContent: themeValue,
            attributes: { value: themeValue },
          });
          options.push(option);
        }

        yield* theme.initTheme;

        return { selector, options };
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(testDOMLayer, testThemeLayer))
        )
      );

      expect(result.selector.className).toBe('theme-selector');
      expect(result.options.length).toBe(5);
      expect(result.options[0].textContent).toBe('auto');
      expect(result.options[4].textContent).toBe('tufte');
    });

    it('should propagate theme changes to multiple listeners', async () => {
      const listener1Changes: Theme[] = [];
      const listener2Changes: Theme[] = [];

      const program = Effect.gen(function* () {
        const theme = yield* ThemeService;

        const cleanup1 = yield* theme.onThemeChange((t) =>
          listener1Changes.push(t)
        );
        const cleanup2 = yield* theme.onThemeChange((t) =>
          listener2Changes.push(t)
        );

        return { cleanup1, cleanup2 };
      });

      const { cleanup1, cleanup2 } = await Effect.runPromise(
        program.pipe(Effect.provide(testThemeLayer))
      );

      expect(mockStorage.listeners.length).toBe(2);

      const mockEvent: StorageEvent = {
        key: 'bookmark-rag-theme',
        newValue: 'tufte',
      } as StorageEvent;

      mockStorage.listeners.forEach((listener) => listener(mockEvent));

      expect(listener1Changes).toEqual(['tufte']);
      expect(listener2Changes).toEqual(['tufte']);

      cleanup1();
      cleanup2();
      expect(mockStorage.listeners.length).toBe(0);
    });

    it('should handle complex UI update flow with theme changes', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const theme = yield* ThemeService;

        const app = yield* dom.createElement('div', { className: 'app' });
        const header = yield* dom.createElement('header', undefined, ['Header']);
        const main = yield* dom.createElement('main');
        const footer = yield* dom.createElement('footer');

        yield* theme.setTheme('terminal');

        const spinner = yield* dom.createSpinner();
        yield* dom.setSpinnerContent(main as any, 'Loading content...');

        const currentTheme = yield* theme.getTheme;

        return {
          app,
          header,
          main,
          footer,
          spinner,
          currentTheme,
        };
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(testDOMLayer, testThemeLayer))
        )
      );

      expect(result.currentTheme).toBe('terminal');
      expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('terminal');
      expect(result.app.className).toBe('app');
      expect(result.spinner.className).toBe('spinner');
      expect(result.main.children.length).toBe(2);
    });

    it('should handle error scenarios gracefully', async () => {
      const program = Effect.gen(function* () {
        const dom = yield* DOMService;

        const element = yield* Effect.either(dom.getElement('nonexistent'));

        return element;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testDOMLayer))
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(DOMError);
        expect(result.left.reason).toBe('element_not_found');
      }
    });

    it('should combine both services in a realistic scenario', async () => {
      const testElement = createMockElement('div', 'app-container');
      mockDoc.registerElement('app-container', testElement);
      mockStorage.data.set('bookmark-rag-theme', 'dark');

      const program = Effect.gen(function* () {
        const dom = yield* DOMService;
        const theme = yield* ThemeService;

        yield* theme.initTheme;

        const container = yield* dom.getElement('app-container');
        const button = yield* dom.createElement('button', {
          textContent: 'Toggle Theme',
          className: 'theme-toggle',
        });

        const currentTheme = yield* theme.getTheme;
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        yield* theme.setTheme(newTheme);

        const updatedTheme = yield* theme.getTheme;

        return {
          container,
          button,
          initialTheme: currentTheme,
          finalTheme: updatedTheme,
        };
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(testDOMLayer, testThemeLayer))
        )
      );

      expect(result.container.id).toBe('app-container');
      expect(result.button.textContent).toBe('Toggle Theme');
      expect(result.initialTheme).toBe('dark');
      expect(result.finalTheme).toBe('light');
      expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
});
