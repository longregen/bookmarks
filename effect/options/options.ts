import * as Effect from 'effect/Effect';
import { initSettingsModule } from '../../src/options/modules/settings';
import { initWebDAVModule } from '../../src/options/modules/webdav';
import { initBulkImportModule } from '../../src/options/modules/bulk-import';
import { initThemeModule } from '../../src/options/modules/theme';
import { initNavigationModule } from '../../src/options/modules/navigation';

/**
 * Module Resource Management
 *
 * Each module is wrapped in an Effect.acquireRelease to ensure proper cleanup.
 * Modules that return cleanup functions have their cleanup called in the release phase.
 * Modules without cleanup are simply initialized without release.
 */

/**
 * Theme module resource - manages theme initialization
 */
function themeModuleResource(): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      initThemeModule();
      return undefined;
    }),
    () => Effect.void
  );
}

/**
 * Navigation module resource - manages navigation handlers
 */
function navigationModuleResource(): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      initNavigationModule();
      return undefined;
    }),
    () => Effect.void
  );
}

/**
 * Settings module resource - manages API settings form
 */
function settingsModuleResource(): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      initSettingsModule();
      return undefined;
    }),
    () => Effect.void
  );
}

/**
 * WebDAV module resource - manages WebDAV sync settings and polling
 * Returns cleanup function that stops sync status polling
 */
function webdavModuleResource(): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = initWebDAVModule();
      return cleanup;
    }),
    (cleanup) => Effect.sync(() => {
      cleanup();
    })
  );
}

/**
 * Bulk import module resource - manages bulk import UI and progress polling
 * Returns cleanup function that stops progress polling
 */
function bulkImportModuleResource(): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = initBulkImportModule();
      return cleanup;
    }),
    (cleanup) => Effect.sync(() => {
      cleanup();
    })
  );
}

/**
 * Window beforeunload listener resource
 * Ensures proper cleanup is signaled before window unloads
 */
function windowBeforeUnloadResource(): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const handler = (): void => {
        // Cleanup happens automatically via Effect scopes
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
}

/**
 * Initialize all modules in the correct order with resource management
 *
 * Order matters:
 * 1. Theme - must be first to apply theme before UI renders
 * 2. Navigation - sets up navigation before other modules interact with it
 * 3. Settings - core settings form
 * 4. WebDAV - depends on settings, has polling that needs cleanup
 * 5. Bulk Import - depends on settings, has progress polling that needs cleanup
 */
function initializeModules(): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    // Scoped resources are acquired in order and released in reverse order
    yield* themeModuleResource();
    yield* navigationModuleResource();
    yield* settingsModuleResource();
    yield* webdavModuleResource();
    yield* bulkImportModuleResource();
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        console.debug('All options page modules cleaned up');
      })
    )
  );
}

/**
 * Main program - compose window handler with module initialization
 *
 * The program acquires resources in this order:
 * 1. Window beforeunload handler
 * 2. All modules (in their initialization order)
 *
 * Resources are released in reverse order automatically by Effect.
 */
const program = Effect.gen(function* () {
  yield* windowBeforeUnloadResource();
  yield* initializeModules();
});

/**
 * Run the program
 *
 * Note: Since this is a long-lived page, the program runs but doesn't complete
 * until the page unloads. Resources remain acquired for the lifetime of the page.
 */
// Skip during tests to avoid initialization errors
if (!import.meta.vitest) {
  Effect.runPromise(program).catch((error: unknown) => {
    console.error('Failed to initialize options page:', error);
  });
}
