import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import type { BookmarkExport } from '../../src/lib/export';

/**
 * Typed error for download operations
 */
export class DownloadError extends Data.TaggedError('DownloadError')<{
  readonly reason:
    | 'blob_creation_failed'
    | 'dom_manipulation_failed'
    | 'url_creation_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Sanitizes a string to be used as a filename
 * Converts to lowercase, replaces non-alphanumeric chars with hyphens,
 * removes leading/trailing hyphens, and limits to 50 characters
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Formats a date for use in filenames (YYYY-MM-DD)
 */
function formatDateForFilename(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Downloads bookmark export data as a JSON file
 *
 * Creates a Blob from the export data, generates an appropriate filename,
 * and triggers a browser download. Ensures proper cleanup of object URLs.
 *
 * @param data - The bookmark export data to download
 * @param filename - Optional custom filename (without extension)
 * @returns Effect that completes when download is triggered
 *
 * @example
 * ```typescript
 * const exportData: BookmarkExport = {
 *   version: 1,
 *   bookmarkCount: 10,
 *   bookmarks: [...],
 * };
 *
 * // Trigger download
 * await Effect.runPromise(downloadExport(exportData));
 *
 * // With custom filename
 * await Effect.runPromise(downloadExport(exportData, 'my-bookmarks'));
 *
 * // Handle errors
 * await Effect.runPromise(
 *   downloadExport(exportData).pipe(
 *     Effect.catchTag('DownloadError', (err) =>
 *       Effect.sync(() => console.error('Download failed:', err.message))
 *     )
 *   )
 * );
 * ```
 */
export function downloadExport(
  data: BookmarkExport,
  filename?: string
): Effect.Effect<void, DownloadError> {
  return Effect.gen(function* () {
    // Serialize to JSON with pretty formatting
    const json = yield* Effect.try({
      try: () => JSON.stringify(data, null, 2),
      catch: (error) =>
        new DownloadError({
          reason: 'blob_creation_failed',
          message: 'Failed to serialize export data to JSON',
          cause: error,
        }),
    });

    // Create blob from JSON string
    const blob = yield* Effect.try({
      try: () => new Blob([json], { type: 'application/json' }),
      catch: (error) =>
        new DownloadError({
          reason: 'blob_creation_failed',
          message: 'Failed to create blob from JSON',
          cause: error,
        }),
    });

    // Create object URL for the blob
    const url = yield* Effect.try({
      try: () => URL.createObjectURL(blob),
      catch: (error) =>
        new DownloadError({
          reason: 'url_creation_failed',
          message: 'Failed to create object URL',
          cause: error,
        }),
    });

    // Generate filename based on export contents
    const defaultFilename =
      data.bookmarkCount === 1
        ? `bookmark-${sanitizeFilename(data.bookmarks[0].title)}-${formatDateForFilename(new Date())}.json`
        : `bookmarks-export-${formatDateForFilename(new Date())}.json`;

    const finalFilename = filename ?? defaultFilename;

    // Trigger download and cleanup
    // All operations are synchronous DOM manipulations wrapped in a single try block
    yield* Effect.try({
      try: () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      catch: (error) =>
        new DownloadError({
          reason: 'dom_manipulation_failed',
          message: 'Failed to trigger download',
          cause: error,
        }),
    });
  });
}
