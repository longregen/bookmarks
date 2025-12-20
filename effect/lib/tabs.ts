import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeEffectLayer, accessService } from './effect-utils';

export class TabError extends Data.TaggedError('TabError')<{
  readonly operation: 'query' | 'update' | 'create' | 'focus_window';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TabsService extends Context.Tag('TabsService')<
  TabsService,
  {
    readonly getExtensionUrl: (path: string) => Effect.Effect<string, never, never>;
    readonly isExtensionUrl: (url: string | undefined) => Effect.Effect<boolean, never, never>;
    readonly findExtensionTab: () => Effect.Effect<chrome.tabs.Tab | null, TabError, never>;
    readonly openExtensionPage: (pagePath: string) => Effect.Effect<void, TabError, never>;
  }
>() {}

const makeTabsService = (): Effect.Effect<
  Context.Tag.Service<TabsService>,
  never,
  never
> =>
  Effect.sync(() => {
    const getExtensionUrl = (path: string): Effect.Effect<string, never, never> =>
      Effect.sync(() => chrome.runtime.getURL(path));

    const isExtensionUrl = (url: string | undefined): Effect.Effect<boolean, never, never> =>
      Effect.gen(function* () {
        if (url === undefined || url === '') {
          return false;
        }
        const extensionUrlPrefix = yield* getExtensionUrl('');
        return url.startsWith(extensionUrlPrefix);
      });

    const findExtensionTab = (): Effect.Effect<chrome.tabs.Tab | null, TabError, never> =>
      Effect.gen(function* () {
        const tabs = yield* Effect.tryPromise({
          try: () => chrome.tabs.query({}),
          catch: (error) =>
            new TabError({
              operation: 'query',
              message: 'Failed to query tabs',
              cause: error,
            }),
        });

        for (const tab of tabs) {
          const isExtension = yield* isExtensionUrl(tab.url);
          if (isExtension) {
            return tab;
          }
        }

        return null;
      });

    const openExtensionPage = (pagePath: string): Effect.Effect<void, TabError, never> =>
      Effect.gen(function* () {
        const targetUrl = yield* getExtensionUrl(pagePath);
        const existingTab = yield* findExtensionTab();

        if (existingTab?.id !== undefined) {
          yield* Effect.tryPromise({
            try: () =>
              chrome.tabs.update(existingTab.id, {
                active: true,
                url: targetUrl,
              }),
            catch: (error) =>
              new TabError({
                operation: 'update',
                message: 'Failed to update tab',
                cause: error,
              }),
          });

          if (existingTab.windowId !== undefined) {
            yield* Effect.tryPromise({
              try: () =>
                chrome.windows.update(existingTab.windowId, { focused: true }),
              catch: () => {
                // `chrome.windows` might be available but `.update` not (e.g., Firefox Android)
                // Swallow error as this is a best-effort operation
              },
            }).pipe(
              Effect.catchAll(() => Effect.void)
            );
          }
        } else {
          yield* Effect.tryPromise({
            try: () => chrome.tabs.create({ url: targetUrl }),
            catch: (error) =>
              new TabError({
                operation: 'create',
                message: 'Failed to create tab',
                cause: error,
              }),
          });
        }
      });

    return {
      getExtensionUrl,
      isExtensionUrl,
      findExtensionTab,
      openExtensionPage,
    } as const;
  });

export const TabsServiceLive: Layer.Layer<TabsService, never, never> =
  makeEffectLayer(TabsService, makeTabsService());

export const tabsService = TabsService.pipe(Effect.map((service) => service));

export const getExtensionUrl = (path: string): Effect.Effect<string, never, TabsService> =>
  accessService(TabsService, (service) => service.getExtensionUrl(path));

export const isExtensionUrl = (
  url: string | undefined
): Effect.Effect<boolean, never, TabsService> =>
  accessService(TabsService, (service) => service.isExtensionUrl(url));

export const findExtensionTab = (): Effect.Effect<
  chrome.tabs.Tab | null,
  TabError,
  TabsService
> => accessService(TabsService, (service) => service.findExtensionTab());

export const openExtensionPage = (
  pagePath: string
): Effect.Effect<void, TabError, TabsService> =>
  accessService(TabsService, (service) => service.openExtensionPage(pagePath));
