import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type {
  SaveBookmarkResponse,
  CapturePageResponse,
  GetPageHtmlResponse
} from '../../src/lib/messages';

// ============================================================================
// Errors
// ============================================================================

export class MessagingError extends Data.TaggedError('MessagingError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DOMError extends Data.TaggedError('DOMError')<{
  readonly operation: 'getUrl' | 'getTitle' | 'getHtml';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

/**
 * Service for accessing page DOM content
 */
export class PageContentService extends Context.Tag('PageContentService')<
  PageContentService,
  {
    readonly getUrl: Effect.Effect<string, DOMError>;
    readonly getTitle: Effect.Effect<string, DOMError>;
    readonly getHtml: Effect.Effect<string, DOMError>;
  }
>() {}

/**
 * Service for Chrome runtime messaging
 */
export class RuntimeMessagingService extends Context.Tag('RuntimeMessagingService')<
  RuntimeMessagingService,
  {
    readonly sendMessage: <T>(message: unknown) => Effect.Effect<T, MessagingError>;
  }
>() {}

// ============================================================================
// Layers
// ============================================================================

/**
 * Production layer for PageContentService
 */
export const PageContentServiceLive = Layer.succeed(PageContentService, {
  getUrl: Effect.try({
    try: () => location.href,
    catch: (error) => new DOMError({
      operation: 'getUrl',
      message: 'Failed to get page URL',
      cause: error
    }),
  }),
  getTitle: Effect.try({
    try: () => document.title,
    catch: (error) => new DOMError({
      operation: 'getTitle',
      message: 'Failed to get page title',
      cause: error
    }),
  }),
  getHtml: Effect.try({
    try: () => document.documentElement.outerHTML,
    catch: (error) => new DOMError({
      operation: 'getHtml',
      message: 'Failed to get page HTML',
      cause: error
    }),
  }),
});

/**
 * Production layer for RuntimeMessagingService
 */
export const RuntimeMessagingServiceLive = Layer.succeed(RuntimeMessagingService, {
  sendMessage: <T>(message: unknown) =>
    Effect.tryPromise({
      try: () => chrome.runtime.sendMessage(message) as Promise<T>,
      catch: (error) => new MessagingError({
        message: 'Failed to send runtime message',
        cause: error
      }),
    }),
});

/**
 * Combined application layer
 */
export const CaptureAppLayer = Layer.mergeAll(
  PageContentServiceLive,
  RuntimeMessagingServiceLive
);

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Captures the current page and saves it as a bookmark
 */
export const capturePage = Effect.gen(function* () {
  const pageContent = yield* PageContentService;
  const messaging = yield* RuntimeMessagingService;

  const url = yield* pageContent.getUrl;
  const title = yield* pageContent.getTitle;
  const html = yield* pageContent.getHtml;

  const response = yield* messaging.sendMessage<SaveBookmarkResponse>({
    type: 'bookmark:save_from_page',
    data: { url, title, html }
  });

  if (response?.success !== true) {
    return yield* Effect.fail(
      new MessagingError({ message: 'Bookmark save failed' })
    );
  }

  yield* Effect.void;
});

/**
 * Gets the current page HTML
 */
export const getCurrentPageHtml = Effect.gen(function* () {
  const pageContent = yield* PageContentService;
  return yield* pageContent.getHtml;
});

/**
 * Handles the capture current tab message
 */
const handleCaptureRequest = capturePage.pipe(
  Effect.map(() => ({ success: true } as CapturePageResponse)),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      console.error('Error capturing page:', error);
      return { success: false } as CapturePageResponse;
    })
  )
);

/**
 * Handles the query current page DOM message
 */
const handleDomQuery = getCurrentPageHtml.pipe(
  Effect.map((html) => ({
    success: true,
    html
  } as GetPageHtmlResponse)),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      console.error('Error getting page HTML:', error);
      return {
        success: false,
        html: ''
      } as GetPageHtmlResponse;
    })
  )
);

/**
 * Handles incoming messages from the extension
 */
const handleMessage = (message: { type?: string }) => {
  if (message.type === 'user_request:capture_current_tab') {
    return handleCaptureRequest;
  } else if (message.type === 'query:current_page_dom') {
    return handleDomQuery;
  }

  return Effect.succeed({ success: false });
};

/**
 * Sets up the Chrome message listener
 */
const setupMessageListener = Effect.sync(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const effect = handleMessage(message).pipe(
      Effect.provide(CaptureAppLayer)
    );

    Effect.runPromise(effect)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        console.error('Message handler error:', error);
        sendResponse({ success: false });
      });

    return true;
  });
});

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * Initialize the capture content script
 */
const program = setupMessageListener;

// Skip during tests to avoid initialization errors
// Check if we're not in a test environment (vitest sets describe globally)
if (!import.meta.vitest && typeof describe === 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
  Effect.runPromise(program).catch((error) => {
    console.error('Failed to initialize capture content script:', error);
  });
}
