import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import * as Option from 'effect/Option';

// ============================================================================
// Errors
// ============================================================================

export class DOMError extends Data.TaggedError('DOMError')<{
  readonly operation: string;
  readonly selector?: string;
  readonly reason: string;
}> {}

export class NavigationError extends Data.TaggedError('NavigationError')<{
  readonly operation: string;
  readonly reason: string;
}> {}

// ============================================================================
// Services
// ============================================================================

export class DOMQueryService extends Context.Tag('DOMQueryService')<
  DOMQueryService,
  {
    querySelector<T extends Element>(selector: string): Effect.Effect<Option.Option<T>, DOMError>;
    querySelectorAll<T extends Element>(selector: string): Effect.Effect<T[], DOMError>;
    getElementById(id: string): Effect.Effect<Option.Option<HTMLElement>, DOMError>;
    getBoundingClientRect(element: Element): Effect.Effect<DOMRect, DOMError>;
  }
>() {}

export class ScrollService extends Context.Tag('ScrollService')<
  ScrollService,
  {
    scrollTo(
      container: Element,
      options: ScrollToOptions
    ): Effect.Effect<void, never>;
    getScrollTop(container: Element): Effect.Effect<number, never>;
  }
>() {}

export class PlatformService extends Context.Tag('PlatformService')<
  PlatformService,
  {
    isWeb(): Effect.Effect<boolean, never>;
    isDesktop(): Effect.Effect<boolean, never>;
  }
>() {}

export class NavigationStateService extends Context.Tag('NavigationStateService')<
  NavigationStateService,
  {
    getNavItems(): Effect.Effect<HTMLAnchorElement[], never>;
    setActiveNavItem(sectionId: string): Effect.Effect<void, never>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

export const DOMQueryServiceLive: Layer.Layer<DOMQueryService> = Layer.succeed(
  DOMQueryService,
  {
    querySelector: <T extends Element>(selector: string) =>
      Effect.sync(() => {
        const element = document.querySelector<T>(selector);
        return element ? Option.some(element) : Option.none();
      }),

    querySelectorAll: <T extends Element>(selector: string) =>
      Effect.sync(() => Array.from(document.querySelectorAll<T>(selector))),

    getElementById: (id: string) =>
      Effect.sync(() => {
        const element = document.getElementById(id);
        return element ? Option.some(element) : Option.none();
      }),

    getBoundingClientRect: (element: Element) =>
      Effect.sync(() => element.getBoundingClientRect()),
  }
);

export const ScrollServiceLive: Layer.Layer<ScrollService> = Layer.succeed(
  ScrollService,
  {
    scrollTo: (container: Element, options: ScrollToOptions) =>
      Effect.sync(() => {
        container.scrollTo(options);
      }),

    getScrollTop: (container: Element) =>
      Effect.sync(() => container.scrollTop),
  }
);

export const PlatformServiceLive: Layer.Layer<PlatformService> = Layer.succeed(
  PlatformService,
  {
    isWeb: () => Effect.sync(() => __IS_WEB__),
    isDesktop: () =>
      Effect.sync(() => window.matchMedia('(min-width: 1024px)').matches),
  }
);

export const NavigationStateServiceLive: Layer.Layer<
  NavigationStateService,
  never,
  DOMQueryService
> = Layer.effect(
  NavigationStateService,
  Effect.gen(function* () {
    const domQuery = yield* DOMQueryService;

    let navItems: HTMLAnchorElement[] = [];

    const getNavItems = Effect.gen(function* () {
      if (navItems.length === 0) {
        navItems = yield* domQuery.querySelectorAll<HTMLAnchorElement>('.nav-item');
      }
      return navItems;
    });

    const setActiveNavItem = (sectionId: string) =>
      Effect.gen(function* () {
        const items = yield* getNavItems;
        items.forEach((item) => {
          if (item.dataset.section === sectionId) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      });

    return {
      getNavItems,
      setActiveNavItem,
    };
  })
);

// ============================================================================
// Core Navigation Operations
// ============================================================================

const handleNavItemClick = (
  item: HTMLAnchorElement,
  e: Event
): Effect.Effect<
  void,
  DOMError,
  DOMQueryService | ScrollService | NavigationStateService
> =>
  Effect.gen(function* () {
    const domQuery = yield* DOMQueryService;
    const scrollService = yield* ScrollService;
    const navState = yield* NavigationStateService;

    e.preventDefault();

    const sectionId = item.dataset.section;
    if (!sectionId || sectionId === '') {
      return;
    }

    yield* navState.setActiveNavItem(sectionId);

    const sectionOpt = yield* domQuery.getElementById(sectionId);
    const scrollContainerOpt = yield* domQuery.querySelector<Element>('.middle');

    yield* Effect.gen(function* () {
      const section = yield* Effect.fromOption(() =>
        new DOMError({
          operation: 'getElementById',
          selector: sectionId,
          reason: 'Section not found',
        })
      )(sectionOpt);

      const scrollContainer = yield* Effect.fromOption(() =>
        new DOMError({
          operation: 'querySelector',
          selector: '.middle',
          reason: 'Scroll container not found',
        })
      )(scrollContainerOpt);

      const sectionRect = yield* domQuery.getBoundingClientRect(section);
      const containerRect = yield* domQuery.getBoundingClientRect(scrollContainer);
      const scrollTop = yield* scrollService.getScrollTop(scrollContainer);

      const newScrollTop =
        scrollTop + sectionRect.top - containerRect.top - 24;

      yield* scrollService.scrollTo(scrollContainer, {
        top: newScrollTop,
        behavior: 'smooth',
      });
    }).pipe(
      Effect.catchAll(() => Effect.void) // Silently ignore if section/container not found
    );
  });

const setupNavItemListeners = (): Effect.Effect<
  () => void,
  never,
  DOMQueryService | ScrollService | NavigationStateService
> =>
  Effect.gen(function* () {
    const domQuery = yield* DOMQueryService;
    const navItems = yield* domQuery.querySelectorAll<HTMLAnchorElement>('.nav-item');

    const listeners: Array<{ item: HTMLAnchorElement; listener: (e: Event) => void }> = [];

    navItems.forEach((item) => {
      const listener = (e: Event) => {
        Effect.runPromise(handleNavItemClick(item, e));
      };
      item.addEventListener('click', listener);
      listeners.push({ item, listener });
    });

    return () => {
      listeners.forEach(({ item, listener }) => {
        item.removeEventListener('click', listener);
      });
    };
  });

// ============================================================================
// Scroll Tracking with IntersectionObserver
// ============================================================================

const createIntersectionObserver = (
  sections: HTMLElement[],
  scrollContainer: Element
): Effect.Effect<
  { observer: IntersectionObserver; cleanup: () => void },
  never,
  NavigationStateService
> =>
  Effect.gen(function* () {
    const navState = yield* NavigationStateService;
    const intersectingSections = new Set<HTMLElement>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const section = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            intersectingSections.add(section);
          } else {
            intersectingSections.delete(section);
          }
        });

        let activeSection: HTMLElement | null = null;
        for (const section of sections) {
          if (intersectingSections.has(section)) {
            activeSection = section;
            break;
          }
        }

        if (!activeSection && sections.length > 0) {
          activeSection = sections[0];
        }

        if (activeSection) {
          Effect.runSync(navState.setActiveNavItem(activeSection.id));
        }
      },
      {
        root: scrollContainer,
        threshold: 0,
        rootMargin: '-50px 0px 0px 0px',
      }
    );

    sections.forEach((section) => observer.observe(section));

    const cleanup = () => {
      observer.disconnect();
    };

    return { observer, cleanup };
  });

const setupScrollTracking = (): Effect.Effect<
  Option.Option<() => void>,
  never,
  DOMQueryService | NavigationStateService
> =>
  Effect.gen(function* () {
    const domQuery = yield* DOMQueryService;

    const scrollContainerOpt = yield* domQuery.querySelector<Element>('.middle');

    if (Option.isNone(scrollContainerOpt)) {
      return Option.none();
    }

    const scrollContainer = scrollContainerOpt.value;

    const sections = yield* domQuery.querySelectorAll<HTMLElement>('.settings-section');

    if (sections.length === 0) {
      return Option.none();
    }

    const { cleanup } = yield* createIntersectionObserver(sections, scrollContainer);

    return Option.some(cleanup);
  });

// ============================================================================
// Responsive Tracking Management
// ============================================================================

export interface ResponsiveTrackingState {
  scrollCleanup: Option.Option<() => void>;
}

const handleResponsiveTracking = (
  state: ResponsiveTrackingState
): Effect.Effect<void, never, PlatformService | DOMQueryService | NavigationStateService> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;

    // Clean up existing scroll tracking if present
    if (Option.isSome(state.scrollCleanup)) {
      state.scrollCleanup.value();
      state.scrollCleanup = Option.none();
    }

    const isDesktop = yield* platform.isDesktop();

    if (isDesktop) {
      const cleanupOpt = yield* setupScrollTracking();
      state.scrollCleanup = cleanupOpt;
    }
  });

const setupResponsiveTracking = (): Effect.Effect<
  () => void,
  never,
  PlatformService | DOMQueryService | NavigationStateService
> =>
  Effect.gen(function* () {
    const state: ResponsiveTrackingState = {
      scrollCleanup: Option.none(),
    };

    // Initial setup
    yield* handleResponsiveTracking(state);

    // Set up resize listener
    const resizeListener = () => {
      Effect.runPromise(handleResponsiveTracking(state));
    };

    window.addEventListener('resize', resizeListener);

    return () => {
      window.removeEventListener('resize', resizeListener);
      if (Option.isSome(state.scrollCleanup)) {
        state.scrollCleanup.value();
      }
    };
  });

// ============================================================================
// Platform-Specific Initialization
// ============================================================================

const hideBulkImportForWeb = (): Effect.Effect<void, never, PlatformService | DOMQueryService> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;
    const domQuery = yield* DOMQueryService;

    const isWeb = yield* platform.isWeb();

    if (!isWeb) {
      return;
    }

    const bulkImportNavItemOpt = yield* domQuery.querySelector<HTMLAnchorElement>(
      '.nav-item[data-section="bulk-import"]'
    );

    if (Option.isSome(bulkImportNavItemOpt)) {
      bulkImportNavItemOpt.value.style.display = 'none';
    }
  });

// ============================================================================
// Public API (maintains compatibility with original module)
// ============================================================================

export const initNavigationModule = (): Effect.Effect<
  () => void,
  never,
  DOMQueryService | ScrollService | NavigationStateService | PlatformService
> =>
  Effect.gen(function* () {
    // Set up navigation item click listeners
    const navCleanup = yield* setupNavItemListeners();

    // Set up responsive scroll tracking
    const trackingCleanup = yield* setupResponsiveTracking();

    // Hide bulk import for web platform
    yield* hideBulkImportForWeb();

    // Return combined cleanup function
    return () => {
      navCleanup();
      trackingCleanup();
    };
  });

// ============================================================================
// Application Layer (combines all dependencies)
// ============================================================================

export const NavigationModuleLive: Layer.Layer<
  DOMQueryService | ScrollService | NavigationStateService | PlatformService
> = Layer.mergeAll(
  DOMQueryServiceLive,
  ScrollServiceLive,
  PlatformServiceLive,
  NavigationStateServiceLive
);

// ============================================================================
// Convenience function for running with live dependencies
// ============================================================================

export function runNavigationModule(): Promise<() => void> {
  const program = initNavigationModule();
  const runnable = Effect.provide(program, NavigationModuleLive);
  return Effect.runPromise(runnable);
}
