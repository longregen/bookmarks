import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';

/**
 * Typed error for HTML extraction failures
 */
export class HtmlExtractionError extends Data.TaggedError('HtmlExtractionError')<{
  readonly reason: 'timeout' | 'observer_failed' | 'dom_unavailable';
  readonly message: string;
}> {}

/**
 * Wait for DOM to settle using MutationObserver with guaranteed cleanup
 *
 * Uses Effect.async to wrap the Promise-based MutationObserver pattern,
 * ensuring the observer is properly disconnected even if the effect is interrupted.
 */
function waitForSettle(settleTimeMs = 2000): Effect.Effect<void, HtmlExtractionError> {
  return Effect.async<void, HtmlExtractionError>((resume) => {
    // Check if document is available
    if (typeof document === 'undefined' || (!document.body && !document.documentElement)) {
      resume(Effect.fail(new HtmlExtractionError({
        reason: 'dom_unavailable',
        message: 'Document is not available'
      })));
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    let observer: MutationObserver | null = null;

    try {
      observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          observer?.disconnect();
          resume(Effect.void);
        }, settleTimeMs);
      });

      const targetNode = (document.body as Node | null) ?? document.documentElement;
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      timeout = setTimeout(() => {
        observer?.disconnect();
        resume(Effect.void);
      }, settleTimeMs);

      // Cleanup function - called when effect completes or is interrupted
      return Effect.sync(() => {
        clearTimeout(timeout);
        observer?.disconnect();
      });
    } catch (error) {
      resume(Effect.fail(new HtmlExtractionError({
        reason: 'observer_failed',
        message: error instanceof Error ? error.message : 'Failed to create MutationObserver'
      })));
    }
  });
}

/**
 * Extract HTML from the current document after DOM settles
 *
 * @param settleTimeMs - Time in milliseconds to wait for DOM to settle (default: 2000)
 * @returns Effect that produces the document's HTML or fails with HtmlExtractionError
 */
export function extractHtml(settleTimeMs = 2000): Effect.Effect<string, HtmlExtractionError> {
  return Effect.gen(function* () {
    // Wait for DOM to settle
    yield* waitForSettle(settleTimeMs);

    // Extract HTML
    if (typeof document === 'undefined' || !document.documentElement) {
      return yield* Effect.fail(new HtmlExtractionError({
        reason: 'dom_unavailable',
        message: 'Document element is not available'
      }));
    }

    return document.documentElement.outerHTML;
  });
}

/**
 * Install extractHtml on window object for backward compatibility
 *
 * This maintains the same API as the original implementation,
 * exposing an async function that returns a Promise<string>.
 */
export function installExtractHtml(): Effect.Effect<void, never> {
  return Effect.sync(() => {
    (window as { extractHtml?: (settleTimeMs?: number) => Promise<string> }).extractHtml =
      (settleTimeMs = 2000) => Effect.runPromise(extractHtml(settleTimeMs));
  });
}
