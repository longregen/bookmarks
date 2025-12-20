import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { FetchError } from './errors';
import { renderPage } from '../../src/lib/tab-renderer';
import { extractTitleFromHtml as extractTitleFromHtmlUtil } from './html-utils';

export interface CapturedPage {
  html: string;
  title: string;
}

export interface BrowserFetchConfig {
  FETCH_TIMEOUT_MS: number;
  FETCH_MAX_HTML_SIZE: number;
}

export class BrowserFetchService extends Context.Tag('BrowserFetchService')<
  BrowserFetchService,
  {
    readonly fetchWithTimeout: (
      url: string,
      timeoutMs?: number
    ) => Effect.Effect<string, FetchError, never>;

    readonly browserFetch: (
      url: string,
      timeoutMs?: number
    ) => Effect.Effect<CapturedPage, FetchError, never>;

    readonly isLocalhostUrl: (url: string) => Effect.Effect<boolean, never, never>;

    readonly extractTitleFromHtml: (html: string) => Effect.Effect<string, never, never>;
  }
>() {}

function isLocalhostUrlSync(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

function extractTitleFromHtmlSync(html: string): string {
  return extractTitleFromHtmlUtil(html);
}

/**
 * Helper to convert caught errors to FetchError
 */
function catchToFetchError(url: string, error: unknown, timeoutMs?: number): FetchError {
  if (error instanceof FetchError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' && timeoutMs !== undefined) {
      return new FetchError({
        url,
        code: 'TIMEOUT',
        message: `Request timeout after ${timeoutMs}ms`,
        originalError: error,
      });
    }

    return new FetchError({
      url,
      code: 'NETWORK_ERROR',
      message: error.message,
      originalError: error,
    });
  }

  return new FetchError({
    url,
    code: 'UNKNOWN',
    message: String(error),
    originalError: error,
  });
}

export const makeBrowserFetchService = (
  config: BrowserFetchConfig
): Effect.Effect<Context.Tag.Service<BrowserFetchService>, never, never> =>
  Effect.sync(() => {
    const isLocalhostUrl = (url: string): Effect.Effect<boolean, never, never> =>
      Effect.sync(() => isLocalhostUrlSync(url));

    const extractTitleFromHtml = (html: string): Effect.Effect<string, never, never> =>
      Effect.sync(() => extractTitleFromHtmlSync(html));

    const fetchWithTimeout = (
      url: string,
      timeoutMs: number = config.FETCH_TIMEOUT_MS
    ): Effect.Effect<string, FetchError, never> =>
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const response = await fetch(url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BookmarkRAG/1.0)',
              },
            });

            if (!response.ok) {
              throw new FetchError({
                url,
                code:
                  response.status === 404
                    ? 'NOT_FOUND'
                    : response.status === 403
                      ? 'FORBIDDEN'
                      : response.status === 429
                        ? 'RATE_LIMITED'
                        : 'NETWORK_ERROR',
                message: `HTTP ${response.status}: ${response.statusText}`,
                status: response.status,
              });
            }

            const html = await response.text();

            if (html.length > config.FETCH_MAX_HTML_SIZE) {
              throw new FetchError({
                url,
                code: 'INVALID_RESPONSE',
                message: `HTML content too large: ${(html.length / 1024 / 1024).toFixed(2)} MB`,
              });
            }

            return html;
          } finally {
            clearTimeout(timeoutId);
          }
        },
        catch: (error) => catchToFetchError(url, error, timeoutMs),
      });

    const browserFetch = (
      url: string,
      timeoutMs: number = config.FETCH_TIMEOUT_MS
    ): Effect.Effect<CapturedPage, FetchError, never> =>
      Effect.gen(function* () {
        const isLocalhost = yield* isLocalhostUrl(url);

        if (!__IS_WEB__ && isLocalhost) {
          const renderEffect = Effect.tryPromise({
            try: () => renderPage(url, timeoutMs),
            catch: (error) => catchToFetchError(url, error),
          });

          const fallbackEffect = Effect.gen(function* () {
            const html = yield* fetchWithTimeout(url, timeoutMs);
            const title = yield* extractTitleFromHtml(html);
            return { html, title };
          });

          return yield* Effect.catchAll(renderEffect, () => fallbackEffect);
        }

        if (!isLocalhost) {
          return yield* Effect.tryPromise({
            try: () => renderPage(url, timeoutMs),
            catch: (error) => catchToFetchError(url, error),
          });
        }

        const html = yield* fetchWithTimeout(url, timeoutMs);
        const title = yield* extractTitleFromHtml(html);
        return { html, title };
      });

    return {
      fetchWithTimeout,
      browserFetch,
      isLocalhostUrl,
      extractTitleFromHtml,
    } as const;
  });

export const BrowserFetchServiceLive = (
  config: BrowserFetchConfig
): Layer.Layer<BrowserFetchService, never, never> =>
  Layer.effect(BrowserFetchService, makeBrowserFetchService(config));

export const fetchWithTimeout = (
  url: string,
  timeoutMs?: number
): Effect.Effect<string, FetchError, BrowserFetchService> =>
  Effect.flatMap(BrowserFetchService, (service) =>
    service.fetchWithTimeout(url, timeoutMs)
  );

export const browserFetch = (
  url: string,
  timeoutMs?: number
): Effect.Effect<CapturedPage, FetchError, BrowserFetchService> =>
  Effect.flatMap(BrowserFetchService, (service) => service.browserFetch(url, timeoutMs));

export const isLocalhostUrl = (
  url: string
): Effect.Effect<boolean, never, BrowserFetchService> =>
  Effect.flatMap(BrowserFetchService, (service) => service.isLocalhostUrl(url));

export const extractTitleFromHtml = (
  html: string
): Effect.Effect<string, never, BrowserFetchService> =>
  Effect.flatMap(BrowserFetchService, (service) => service.extractTitleFromHtml(html));
