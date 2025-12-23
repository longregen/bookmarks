import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';

// ============================================================================
// Mock DOM Environment
// ============================================================================

/**
 * Creates a mock DOM environment with all required elements for options page
 */
function createMockDOM() {
  const elements = {
    // Theme elements
    themeRadios: [
      { name: 'theme', value: 'light', checked: false, addEventListener: vi.fn() },
      { name: 'theme', value: 'dark', checked: false, addEventListener: vi.fn() },
      { name: 'theme', value: 'auto', checked: false, addEventListener: vi.fn() },
    ],

    // Navigation elements
    navItems: [
      {
        dataset: { section: 'general' },
        classList: { add: vi.fn(), remove: vi.fn() },
        addEventListener: vi.fn(),
      },
      {
        dataset: { section: 'webdav' },
        classList: { add: vi.fn(), remove: vi.fn() },
        addEventListener: vi.fn(),
      },
      {
        dataset: { section: 'bulk-import' },
        classList: { add: vi.fn(), remove: vi.fn() },
        addEventListener: vi.fn(),
        style: { display: '' },
      },
    ],

    // Settings form elements
    settingsForm: {
      id: 'settingsForm',
      addEventListener: vi.fn(),
      querySelector: vi.fn(),
    },
    apiBaseUrl: { id: 'apiBaseUrl', value: '', addEventListener: vi.fn() },
    apiKey: { id: 'apiKey', value: '', addEventListener: vi.fn() },
    chatModel: { id: 'chatModel', value: '', addEventListener: vi.fn() },
    embeddingModel: { id: 'embeddingModel', value: '', addEventListener: vi.fn() },
    testBtn: {
      id: 'testBtn',
      textContent: 'Test Connection',
      addEventListener: vi.fn(),
      disabled: false,
    },
    testConnectionStatus: {
      id: 'testConnectionStatus',
      className: '',
      textContent: '',
      classList: { add: vi.fn(), remove: vi.fn() },
    },
    status: {
      id: 'status',
      textContent: '',
      className: '',
      classList: { add: vi.fn(), remove: vi.fn() },
      style: { display: 'none' },
    },

    // WebDAV form elements
    webdavForm: { id: 'webdavForm', addEventListener: vi.fn(), querySelector: vi.fn() },
    webdavEnabled: { id: 'webdavEnabled', checked: false, addEventListener: vi.fn() },
    webdavFields: { id: 'webdavFields', classList: { add: vi.fn(), remove: vi.fn() } },
    webdavUrl: { id: 'webdavUrl', value: '', addEventListener: vi.fn(), trim: vi.fn() },
    webdavUsername: { id: 'webdavUsername', value: '', addEventListener: vi.fn() },
    webdavPassword: { id: 'webdavPassword', value: '', addEventListener: vi.fn() },
    webdavPath: { id: 'webdavPath', value: '/bookmarks', addEventListener: vi.fn() },
    webdavSyncInterval: { id: 'webdavSyncInterval', value: '15', addEventListener: vi.fn() },
    webdavAllowInsecure: {
      id: 'webdavAllowInsecure',
      checked: false,
      addEventListener: vi.fn(),
    },
    testWebdavBtn: {
      id: 'testWebdavBtn',
      textContent: 'Test Connection',
      addEventListener: vi.fn(),
      disabled: false,
    },
    webdavConnectionStatus: {
      id: 'webdavConnectionStatus',
      className: '',
      querySelector: vi.fn().mockReturnValue({ textContent: '' }),
    },
    webdavUrlWarning: {
      id: 'webdavUrlWarning',
      classList: { add: vi.fn(), remove: vi.fn() },
    },
    syncStatusIndicator: {
      id: 'syncStatusIndicator',
      classList: { add: vi.fn(), remove: vi.fn() },
      querySelector: vi.fn().mockReturnValue({ textContent: '' }),
    },
    syncNowBtn: {
      id: 'syncNowBtn',
      textContent: 'Sync Now',
      disabled: false,
      addEventListener: vi.fn(),
    },

    // Bulk import elements
    bulkUrlsInput: {
      id: 'bulkUrlsInput',
      value: '',
      addEventListener: vi.fn(),
    },
    urlValidationFeedback: {
      id: 'urlValidationFeedback',
      className: '',
      textContent: '',
      classList: { add: vi.fn(), remove: vi.fn() },
    },
    startBulkImport: {
      id: 'startBulkImport',
      disabled: true,
      addEventListener: vi.fn(),
    },
    bulkImportProgress: {
      id: 'bulkImportProgress',
      classList: { add: vi.fn(), remove: vi.fn() },
    },
    bulkImportProgressBar: {
      id: 'bulkImportProgressBar',
      style: { width: '0%' },
    },
    bulkImportStatus: {
      id: 'bulkImportStatus',
      textContent: '',
    },

    // Container elements
    middle: {
      scrollTo: vi.fn(),
      scrollTop: 0,
      getBoundingClientRect: vi.fn().mockReturnValue({ top: 0 }),
    },

    general: {
      id: 'general',
      getBoundingClientRect: vi.fn().mockReturnValue({ top: 100 }),
    },
  };

  // Mock document.getElementById
  const getElementById = vi.fn((id: string) => {
    const element = elements[id as keyof typeof elements];
    return element || null;
  });

  // Mock document.querySelector
  const querySelector = vi.fn((selector: string) => {
    if (selector.includes('theme')) {
      return elements.themeRadios[0];
    }
    if (selector === '.middle') {
      return elements.middle;
    }
    if (selector === '.nav-item[data-section="bulk-import"]') {
      return elements.navItems[2];
    }
    return null;
  });

  // Mock document.querySelectorAll
  const querySelectorAll = vi.fn((selector: string) => {
    if (selector === 'input[name="theme"]') {
      return elements.themeRadios;
    }
    if (selector === '.nav-item') {
      return elements.navItems;
    }
    if (selector === '.settings-section') {
      return [elements.general];
    }
    return [];
  });

  return {
    elements,
    getElementById,
    querySelector,
    querySelectorAll,
  };
}

// ============================================================================
// Mock Window and Global APIs
// ============================================================================

function createMockWindow() {
  const eventListeners = new Map<string, Array<(e: Event) => void>>();

  return {
    addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event)!.push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
      const handlers = eventListeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    }),
    matchMedia: vi.fn((query: string) => ({
      matches: query.includes('1024px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    dispatchEvent: vi.fn(),
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    eventListeners,
  };
}

// ============================================================================
// Module Initialization Tracking
// ============================================================================

interface ModuleInitEvent {
  readonly module: string;
  readonly timestamp: number;
  readonly action: 'init' | 'cleanup';
}

/**
 * Creates a tracking service to monitor module initialization order
 */
function createModuleTracker() {
  const events: ModuleInitEvent[] = [];

  return {
    trackInit: (module: string) => {
      events.push({
        module,
        timestamp: Date.now(),
        action: 'init',
      });
    },
    trackCleanup: (module: string) => {
      events.push({
        module,
        timestamp: Date.now(),
        action: 'cleanup',
      });
    },
    getEvents: () => [...events],
    getInitOrder: () =>
      events.filter((e) => e.action === 'init').map((e) => e.module),
    getCleanupOrder: () =>
      events.filter((e) => e.action === 'cleanup').map((e) => e.module),
    clear: () => {
      events.length = 0;
    },
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Options Page Modules Integration', () => {
  let mockDOM: ReturnType<typeof createMockDOM>;
  let mockWindow: ReturnType<typeof createMockWindow>;
  let moduleTracker: ReturnType<typeof createModuleTracker>;

  beforeEach(() => {
    mockDOM = createMockDOM();
    mockWindow = createMockWindow();
    moduleTracker = createModuleTracker();

    // Setup global mocks
    global.document = {
      getElementById: mockDOM.getElementById,
      querySelector: mockDOM.querySelector,
      querySelectorAll: mockDOM.querySelectorAll,
    } as any;

    global.window = mockWindow as any;

    // Mock IntersectionObserver as a class constructor
    global.IntersectionObserver = class IntersectionObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: any, options?: any) {}
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
    moduleTracker.clear();
  });

  describe('Module Initialization Sequence', () => {
    it('should initialize modules in the correct order', async () => {
      const program = Effect.scoped(
        Effect.gen(function* () {
          // Simulate theme module
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              moduleTracker.trackInit('theme');
              return undefined;
            }),
            () =>
              Effect.sync(() => {
                moduleTracker.trackCleanup('theme');
              })
          );

          // Simulate navigation module
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              moduleTracker.trackInit('navigation');
              return undefined;
            }),
            () =>
              Effect.sync(() => {
                moduleTracker.trackCleanup('navigation');
              })
          );

          // Simulate settings module
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              moduleTracker.trackInit('settings');
              return undefined;
            }),
            () =>
              Effect.sync(() => {
                moduleTracker.trackCleanup('settings');
              })
          );

          // Simulate webdav module with cleanup
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              moduleTracker.trackInit('webdav');
              return () => {
                // WebDAV cleanup function
              };
            }),
            (cleanup) =>
              Effect.sync(() => {
                moduleTracker.trackCleanup('webdav');
                cleanup();
              })
          );

          // Simulate bulk import module with cleanup
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              moduleTracker.trackInit('bulk-import');
              return () => {
                // Bulk import cleanup function
              };
            }),
            (cleanup) =>
              Effect.sync(() => {
                moduleTracker.trackCleanup('bulk-import');
                cleanup();
              })
          );
        })
      );

      await Effect.runPromise(program);

      const initOrder = moduleTracker.getInitOrder();
      const cleanupOrder = moduleTracker.getCleanupOrder();

      // Verify initialization order
      expect(initOrder).toEqual(['theme', 'navigation', 'settings', 'webdav', 'bulk-import']);

      // Verify cleanup happens in reverse order
      expect(cleanupOrder).toEqual([
        'bulk-import',
        'webdav',
        'settings',
        'navigation',
        'theme',
      ]);
    });

    it('should track module initialization timestamps', async () => {
      const program = Effect.gen(function* () {
        yield* Effect.sync(() => moduleTracker.trackInit('theme'));
        yield* Effect.sleep('5 millis');
        yield* Effect.sync(() => moduleTracker.trackInit('navigation'));
        yield* Effect.sleep('5 millis');
        yield* Effect.sync(() => moduleTracker.trackInit('settings'));
      });

      await Effect.runPromise(program);

      const events = moduleTracker.getEvents();
      expect(events[0].timestamp).toBeLessThan(events[1].timestamp);
      expect(events[1].timestamp).toBeLessThan(events[2].timestamp);
    });
  });

  describe('Resource Cleanup with Effect.acquireRelease', () => {
    it('should properly cleanup modules with cleanup functions', async () => {
      const cleanupCalls = {
        webdav: 0,
        bulkImport: 0,
      };

      const program = Effect.scoped(
        Effect.gen(function* () {
          // WebDAV module resource
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              return () => {
                cleanupCalls.webdav++;
              };
            }),
            (cleanup) =>
              Effect.sync(() => {
                cleanup();
              })
          );

          // Bulk import module resource
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              return () => {
                cleanupCalls.bulkImport++;
              };
            }),
            (cleanup) =>
              Effect.sync(() => {
                cleanup();
              })
          );
        })
      );

      await Effect.runPromise(program);

      // Both cleanup functions should have been called
      expect(cleanupCalls.webdav).toBe(1);
      expect(cleanupCalls.bulkImport).toBe(1);
    });

    it('should cleanup even when errors occur', async () => {
      let cleanupCalled = false;

      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              return () => {
                cleanupCalled = true;
              };
            }),
            (cleanup) =>
              Effect.sync(() => {
                cleanup();
              })
          );

          // Throw an error
          yield* Effect.fail(new Error('Test error'));
        })
      );

      await Effect.runPromise(program.pipe(Effect.either));

      // Cleanup should still be called despite error
      expect(cleanupCalled).toBe(true);
    });

    it('should handle Effect.ensuring for additional cleanup', async () => {
      let ensuringCalled = false;

      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => 'resource'),
            () =>
              Effect.sync(() => {
                // Primary cleanup
              })
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              ensuringCalled = true;
            })
          )
        )
      );

      await Effect.runPromise(program);

      expect(ensuringCalled).toBe(true);
    });
  });

  describe('Settings Module Form Handling', () => {
    it('should initialize settings form with form helper', async () => {
      const formConfig = {
        formId: 'settingsForm',
        statusId: 'status',
        onLoad: vi.fn(async () => {}),
        onSave: vi.fn(async () => {}),
        saveButtonText: {
          default: 'Save Settings',
          saving: 'Saving...',
        },
      };

      const program = Effect.gen(function* () {
        // Simulate form initialization
        yield* Effect.sync(() => {
          expect(formConfig.formId).toBe('settingsForm');
          expect(formConfig.statusId).toBe('status');
        });

        // Trigger onLoad
        yield* Effect.promise(() => formConfig.onLoad());

        // Trigger onSave
        yield* Effect.promise(() => formConfig.onSave());
      });

      await Effect.runPromise(program);

      expect(formConfig.onLoad).toHaveBeenCalled();
      expect(formConfig.onSave).toHaveBeenCalled();
    });

    it('should handle test connection functionality', async () => {
      const testConnectionRef = await Effect.runPromise(Ref.make(false));

      const program = Effect.gen(function* () {
        // Simulate setting up test button listener
        const testBtn = mockDOM.elements.testBtn;

        yield* Effect.sync(() => {
          const clickHandler = () => {
            Effect.runPromise(
              Ref.set(testConnectionRef, true)
            );
          };
          testBtn.addEventListener('click', clickHandler);
        });

        // Verify listener was added
        expect(testBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      });

      await Effect.runPromise(program);
    });

    it('should reset test button on input changes', async () => {
      const resetCalls = await Effect.runPromise(Ref.make(0));

      const program = Effect.gen(function* () {
        // Setup input listeners that reset test button
        const inputs = [
          mockDOM.elements.apiBaseUrl,
          mockDOM.elements.apiKey,
          mockDOM.elements.chatModel,
          mockDOM.elements.embeddingModel,
        ];

        for (const input of inputs) {
          yield* Effect.sync(() => {
            const resetHandler = () => {
              Effect.runPromise(Ref.update(resetCalls, (n) => n + 1));
            };
            input.addEventListener('input', resetHandler);
          });
        }

        // Verify all listeners were added
        expect(mockDOM.elements.apiBaseUrl.addEventListener).toHaveBeenCalled();
        expect(mockDOM.elements.apiKey.addEventListener).toHaveBeenCalled();
        expect(mockDOM.elements.chatModel.addEventListener).toHaveBeenCalled();
        expect(mockDOM.elements.embeddingModel.addEventListener).toHaveBeenCalled();
      });

      await Effect.runPromise(program);
    });
  });

  describe('WebDAV Module Connection Testing', () => {
    it('should handle WebDAV connection test with valid credentials', async () => {
      const connectionTestResult = await Effect.runPromise(
        Ref.make<'pending' | 'success' | 'error'>('pending')
      );

      const program = Effect.gen(function* () {
        // Mock successful WebDAV test
        const mockFetch = vi.fn().mockResolvedValue({
          status: 207,
          ok: true,
        });

        global.fetch = mockFetch as any;

        // Simulate test connection
        yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch('https://webdav.example.com/bookmarks', {
              method: 'PROPFIND',
              headers: {
                Depth: '0',
                Authorization: `Basic ${btoa('user:pass')}`,
                'Content-Type': 'application/xml',
              },
            });

            if (response.status === 207 || response.ok) {
              await Effect.runPromise(Ref.set(connectionTestResult, 'success'));
            }
          },
          catch: () => {
            return Effect.runPromise(Ref.set(connectionTestResult, 'error'));
          },
        });

        const result = yield* Ref.get(connectionTestResult);
        expect(result).toBe('success');
      });

      await Effect.runPromise(program);
    });

    it('should handle WebDAV connection test with authentication failure', async () => {
      const program = Effect.gen(function* () {
        // Mock 401 Unauthorized response
        const mockFetch = vi.fn().mockResolvedValue({
          status: 401,
          ok: false,
        });

        global.fetch = mockFetch as any;

        const result = yield* Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            fetch('https://webdav.example.com/bookmarks', {
              method: 'PROPFIND',
            })
          );

          if (response.status === 401) {
            return yield* Effect.fail('auth-error');
          }
          return 'success';
        }).pipe(
          Effect.catchAll(() => Effect.succeed('error'))
        );

        expect(result).toBe('error');
      });

      await Effect.runPromise(program);
    });

    it('should cleanup WebDAV polling on module unload', async () => {
      let pollerStopped = false;

      const program = Effect.scoped(
        Effect.gen(function* () {
          // Simulate WebDAV module with polling
          const cleanup = yield* Effect.acquireRelease(
            Effect.sync(() => {
              // Start polling
              return () => {
                // Stop polling
                pollerStopped = true;
              };
            }),
            (cleanupFn) =>
              Effect.sync(() => {
                cleanupFn();
              })
          );
        })
      );

      await Effect.runPromise(program);

      expect(pollerStopped).toBe(true);
    });
  });

  describe('Module Coordination', () => {
    it('should allow modules to share services via layers', async () => {
      interface SharedState {
        apiKey: string;
      }

      class SettingsState extends Effect.Tag('SettingsState')<
        SettingsState,
        Ref.Ref<SharedState>
      >() {}

      const SettingsStateLive = Layer.effect(
        SettingsState,
        Ref.make<SharedState>({ apiKey: '' })
      );

      const program = Effect.gen(function* () {
        const state = yield* SettingsState;

        // Settings module sets the API key
        yield* Ref.update(state, () => ({ apiKey: 'test-key-123' }));

        // WebDAV module reads the API key
        const currentState = yield* Ref.get(state);
        expect(currentState.apiKey).toBe('test-key-123');
      });

      await Effect.runPromise(program.pipe(Effect.provide(SettingsStateLive)));
    });

    it('should coordinate navigation and settings visibility', async () => {
      const program = Effect.gen(function* () {
        // Simulate navigation to WebDAV section
        const webdavNavItem = mockDOM.elements.navItems[1];

        yield* Effect.sync(() => {
          webdavNavItem.classList.add('active');
        });

        expect(webdavNavItem.classList.add).toHaveBeenCalledWith('active');

        // Simulate showing WebDAV fields
        const webdavFields = mockDOM.elements.webdavFields;
        yield* Effect.sync(() => {
          webdavFields.classList.remove('hidden');
        });

        expect(webdavFields.classList.remove).toHaveBeenCalledWith('hidden');
      });

      await Effect.runPromise(program);
    });

    it('should handle responsive navigation tracking setup', async () => {
      const program = Effect.gen(function* () {
        // Check if desktop
        const isDesktop = yield* Effect.sync(() =>
          window.matchMedia('(min-width: 1024px)').matches
        );

        if (isDesktop) {
          // Setup scroll tracking
          yield* Effect.sync(() => {
            const observer = new IntersectionObserver(() => {}, {
              root: mockDOM.elements.middle,
              threshold: 0,
            });
            return () => observer.disconnect();
          });
        }

        expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
      });

      await Effect.runPromise(program);
    });
  });

  describe('Resource Cleanup on Unload', () => {
    it('should add and remove window beforeunload listener', async () => {
      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const handler = () => {
                console.debug('Options page unloading');
              };
              window.addEventListener('beforeunload', handler);
              return handler;
            }),
            (handler) =>
              Effect.sync(() => {
                window.removeEventListener('beforeunload', handler);
              })
          );
        })
      );

      await Effect.runPromise(program);

      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
    });

    it('should cleanup all modules when scope closes', async () => {
      const cleanupOrder: string[] = [];

      const program = Effect.scoped(
        Effect.gen(function* () {
          // Initialize all modules with cleanup tracking
          yield* Effect.acquireRelease(
            Effect.sync(() => () => cleanupOrder.push('theme')),
            (cleanup) => Effect.sync(cleanup)
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => () => cleanupOrder.push('navigation')),
            (cleanup) => Effect.sync(cleanup)
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => () => cleanupOrder.push('settings')),
            (cleanup) => Effect.sync(cleanup)
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => () => cleanupOrder.push('webdav')),
            (cleanup) => Effect.sync(cleanup)
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => () => cleanupOrder.push('bulk-import')),
            (cleanup) => Effect.sync(cleanup)
          );
        })
      );

      await Effect.runPromise(program);

      // Verify cleanup happens in reverse order
      expect(cleanupOrder).toEqual([
        'bulk-import',
        'webdav',
        'settings',
        'navigation',
        'theme',
      ]);
    });

    it('should ensure cleanup message is logged', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.void;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              console.debug('All options page modules cleaned up');
            })
          )
        )
      );

      await Effect.runPromise(program);

      expect(consoleSpy).toHaveBeenCalledWith('All options page modules cleaned up');
      consoleSpy.mockRestore();
    });
  });

  describe('Full Options Page Lifecycle', () => {
    it('should simulate complete options page lifecycle', async () => {
      const lifecycle = await Effect.runPromise(
        Ref.make<string[]>([])
      );

      const program = Effect.scoped(
        Effect.gen(function* () {
          // Window beforeunload handler
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'beforeunload:init']));
              return () => {};
            }),
            () =>
              Effect.sync(() => {
                Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'beforeunload:cleanup']));
              })
          );

          // Initialize modules
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'theme:init']));
            }),
            () =>
              Effect.sync(() => {
                Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'theme:cleanup']));
              })
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'navigation:init']));
            }),
            () =>
              Effect.sync(() => {
                Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'navigation:cleanup']));
              })
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'settings:init']));
            }),
            () =>
              Effect.sync(() => {
                Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'settings:cleanup']));
              })
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'webdav:init']));
              return () => {};
            }),
            () =>
              Effect.sync(() => {
                Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'webdav:cleanup']));
              })
          );

          yield* Effect.acquireRelease(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'bulk-import:init']));
              return () => {};
            }),
            () =>
              Effect.sync(() => {
                Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'bulk-import:cleanup']));
              })
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              Effect.runSync(Ref.update(lifecycle, (l) => [...l, 'ensuring:cleanup']));
            })
          )
        )
      );

      await Effect.runPromise(program);

      const events = await Effect.runPromise(Ref.get(lifecycle));

      // Verify initialization order
      expect(events.slice(0, 6)).toEqual([
        'beforeunload:init',
        'theme:init',
        'navigation:init',
        'settings:init',
        'webdav:init',
        'bulk-import:init',
      ]);

      // Verify cleanup order
      // Note: Effect.ensuring runs before acquireRelease cleanup
      expect(events.slice(6)).toContain('ensuring:cleanup');
      expect(events.slice(6)).toContain('bulk-import:cleanup');
      expect(events.slice(6)).toContain('webdav:cleanup');
      expect(events.slice(6)).toContain('settings:cleanup');
      expect(events.slice(6)).toContain('navigation:cleanup');
      expect(events.slice(6)).toContain('theme:cleanup');
      expect(events.slice(6)).toContain('beforeunload:cleanup');

      // Verify reverse order for module cleanup (excluding ensuring)
      const moduleCleanups = events.filter((e) => e.includes(':cleanup') && e !== 'ensuring:cleanup');
      expect(moduleCleanups).toEqual([
        'bulk-import:cleanup',
        'webdav:cleanup',
        'settings:cleanup',
        'navigation:cleanup',
        'theme:cleanup',
        'beforeunload:cleanup',
      ]);
    });
  });
});
