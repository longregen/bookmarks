/**
 * Import/Export module refactored to use Effect.ts
 *
 * This module handles bookmark import/export UI interactions using Effect.ts patterns:
 * - Typed errors (ExportError, ImportError, FileError)
 * - Service abstraction (ExportService, ImportService, FileService, UIService)
 * - Effect-based composition for async operations
 * - Layer-based dependency injection
 *
 * Maintains the same public API as the original module (DOM event handlers).
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import type { BookmarkExport, ImportResult } from '../../lib/export';

// ============================================================================
// Typed Errors
// ============================================================================

export class ExportError extends Data.TaggedError('ExportError')<{
  readonly reason: 'no_bookmarks' | 'export_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ImportError extends Data.TaggedError('ImportError')<{
  readonly reason: 'validation_failed' | 'import_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class FileError extends Data.TaggedError('FileError')<{
  readonly reason: 'read_failed' | 'parse_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Service Definitions
// ============================================================================

/**
 * Service for exporting bookmarks to JSON format
 */
export class ExportService extends Context.Tag('ExportService')<
  ExportService,
  {
    readonly exportAll: () => Effect.Effect<BookmarkExport, ExportError>;
    readonly exportSingle: (bookmarkId: string) => Effect.Effect<BookmarkExport, ExportError>;
  }
>() {}

/**
 * Service for importing bookmarks from JSON format
 */
export class ImportService extends Context.Tag('ImportService')<
  ImportService,
  {
    readonly validateData: (data: unknown) => Effect.Effect<BookmarkExport, ImportError>;
    readonly importBookmarks: (data: BookmarkExport, fileName?: string) => Effect.Effect<ImportResult, ImportError>;
  }
>() {}

/**
 * Service for reading files from the file system
 */
export class FileService extends Context.Tag('FileService')<
  FileService,
  {
    readonly readFile: (file: File) => Effect.Effect<BookmarkExport, FileError>;
  }
>() {}

/**
 * Service for UI operations (status messages, downloads, import results)
 */
export class UIService extends Context.Tag('UIService')<
  UIService,
  {
    readonly showStatus: (message: string, type: 'success' | 'error' | 'warning', timeoutMs?: number) => Effect.Effect<void>;
    readonly downloadExport: (data: BookmarkExport, filename?: string) => Effect.Effect<void>;
    readonly showImportResult: (result: ImportResult) => Effect.Effect<void>;
    readonly showImportError: (errorMessage: string) => Effect.Effect<void>;
    readonly clearImportStatus: () => Effect.Effect<void>;
    readonly resetImportFileInput: () => Effect.Effect<void>;
  }
>() {}

// ============================================================================
// Service Implementations (Layers)
// ============================================================================

/**
 * Live implementation of ExportService using lib/export functions
 */
export const ExportServiceLive: Layer.Layer<ExportService> = Layer.succeed(
  ExportService,
  {
    exportAll: () => Effect.gen(function* () {
      const data = yield* Effect.tryPromise({
        try: async () => {
          const { exportAllBookmarks } = await import('../../lib/export');
          return await exportAllBookmarks();
        },
        catch: (error) => new ExportError({
          reason: 'export_failed',
          message: 'Failed to export bookmarks',
          cause: error,
        }),
      });

      if (data.bookmarkCount === 0) {
        return yield* Effect.fail(new ExportError({
          reason: 'no_bookmarks',
          message: 'No bookmarks to export',
        }));
      }

      return data;
    }),

    exportSingle: (bookmarkId: string) => Effect.tryPromise({
      try: async () => {
        const { exportSingleBookmark } = await import('../../lib/export');
        return await exportSingleBookmark(bookmarkId);
      },
      catch: (error) => new ExportError({
        reason: 'export_failed',
        message: `Failed to export bookmark ${bookmarkId}`,
        cause: error,
      }),
    }),
  }
);

/**
 * Live implementation of ImportService using lib/export functions
 */
export const ImportServiceLive: Layer.Layer<ImportService> = Layer.succeed(
  ImportService,
  {
    validateData: (data: unknown) => Effect.gen(function* () {
      const { validateImportData } = yield* Effect.promise(() => import('../../lib/export'));

      if (!validateImportData(data)) {
        return yield* Effect.fail(new ImportError({
          reason: 'validation_failed',
          message: 'Invalid bookmark export file format',
        }));
      }

      return data as BookmarkExport;
    }),

    importBookmarks: (data: BookmarkExport, fileName?: string) => Effect.tryPromise({
      try: async () => {
        const { importBookmarks } = await import('../../lib/export');
        return await importBookmarks(data, fileName);
      },
      catch: (error) => new ImportError({
        reason: 'import_failed',
        message: 'Failed to import bookmarks',
        cause: error,
      }),
    }),
  }
);

/**
 * Live implementation of FileService using FileReader API
 */
export const FileServiceLive: Layer.Layer<FileService> = Layer.succeed(
  FileService,
  {
    readFile: (file: File) => Effect.gen(function* () {
      // Read file as text
      const text = yield* Effect.async<string, FileError>((resume) => {
        const reader = new FileReader();

        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            resume(Effect.succeed(result));
          } else {
            resume(Effect.fail(new FileError({
              reason: 'read_failed',
              message: 'File read result was not a string',
            })));
          }
        };

        reader.onerror = () => {
          resume(Effect.fail(new FileError({
            reason: 'read_failed',
            message: 'Failed to read file',
          })));
        };

        reader.readAsText(file);
      });

      // Parse JSON
      const data = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (error) => new FileError({
          reason: 'parse_failed',
          message: 'Failed to parse JSON file',
          cause: error,
        }),
      });

      // Validate format
      const { validateImportData } = yield* Effect.promise(() => import('../../lib/export'));

      if (!validateImportData(data)) {
        return yield* Effect.fail(new FileError({
          reason: 'parse_failed',
          message: 'Invalid bookmark export file format',
        }));
      }

      return data;
    }),
  }
);

/**
 * Live implementation of UIService bound to specific DOM elements
 */
export const UIServiceLive = (
  statusDiv: HTMLDivElement,
  importStatus: HTMLDivElement,
  importFile: HTMLInputElement,
  importFileName: HTMLSpanElement
): Layer.Layer<UIService> => Layer.succeed(
  UIService,
  {
    showStatus: (message: string, type: 'success' | 'error' | 'warning', timeoutMs = 3000) =>
      Effect.sync(() => {
        const { showStatusMessage } = require('../../ui/dom');
        showStatusMessage(statusDiv, message, type, timeoutMs);
      }),

    downloadExport: (data: BookmarkExport, filename?: string) =>
      Effect.sync(() => {
        const { downloadExport } = require('../../ui/export-download');
        downloadExport(data, filename);
      }),

    showImportResult: (result: ImportResult) =>
      Effect.sync(() => {
        const { createElement } = require('../../ui/dom');

        let message = `Imported ${result.imported} bookmark(s)`;
        if (result.skipped > 0) {
          message += `, skipped ${result.skipped} duplicate(s)`;
        }

        importStatus.textContent = '';
        const resultDiv = createElement('div', {
          className: `import-result ${result.success ? 'success' : 'warning'}`
        });
        resultDiv.appendChild(createElement('strong', { textContent: message }));

        if (result.errors.length > 0) {
          const errorList = createElement('ul', { className: 'import-errors' });
          const fragment = document.createDocumentFragment();
          for (const err of result.errors) {
            fragment.appendChild(createElement('li', { textContent: err }));
          }
          errorList.appendChild(fragment);
          resultDiv.appendChild(errorList);
        }

        importStatus.appendChild(resultDiv);
        importStatus.classList.remove('hidden');
      }),

    showImportError: (errorMessage: string) =>
      Effect.sync(() => {
        const { createElement } = require('../../ui/dom');

        importStatus.textContent = '';
        const errorDiv = createElement('div', { className: 'import-result error' });
        errorDiv.appendChild(createElement('strong', { textContent: 'Import failed: ' }));
        errorDiv.appendChild(document.createTextNode(errorMessage));
        importStatus.appendChild(errorDiv);
        importStatus.classList.remove('hidden');
      }),

    clearImportStatus: () =>
      Effect.sync(() => {
        importStatus.classList.add('hidden');
      }),

    resetImportFileInput: () =>
      Effect.sync(() => {
        importFile.value = '';
        importFileName.textContent = '';
      }),
  }
);

// ============================================================================
// Effect Programs (Business Logic)
// ============================================================================

/**
 * Export all bookmarks program
 * Handles the complete export flow: export data -> download -> show status
 */
const handleExportProgram = Effect.gen(function* () {
  const exportService = yield* ExportService;
  const uiService = yield* UIService;

  const exportData = yield* exportService.exportAll();
  yield* uiService.downloadExport(exportData);
  yield* uiService.showStatus(
    `Exported ${exportData.bookmarkCount} bookmark(s) successfully!`,
    'success',
    5000
  );

  return exportData;
});

/**
 * Import bookmarks program
 * Handles the complete import flow: read file -> validate -> import -> show result
 */
const handleImportProgram = (file: File) => Effect.gen(function* () {
  const fileService = yield* FileService;
  const importService = yield* ImportService;
  const uiService = yield* UIService;

  const exportData = yield* fileService.readFile(file);
  const result = yield* importService.importBookmarks(exportData, file.name);
  yield* uiService.showImportResult(result);
  yield* uiService.resetImportFileInput();

  return result;
});

// ============================================================================
// DOM Event Handlers
// ============================================================================

const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFileName = document.getElementById('importFileName') as HTMLSpanElement;
const importStatus = document.getElementById('importStatus') as HTMLDivElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let selectedFile: File | null = null;

// Compose all service layers
const AppLayer = Layer.mergeAll(
  ExportServiceLive,
  ImportServiceLive,
  FileServiceLive,
  UIServiceLive(statusDiv, importStatus, importFile, importFileName)
);

/**
 * Helper to run an Effect program with the app layer
 */
function runEffect<A, E>(
  program: Effect.Effect<A, E, ExportService | ImportService | FileService | UIService>
): Promise<A> {
  return Effect.runPromise(Effect.provide(program, AppLayer));
}

/**
 * Export button click handler
 */
exportBtn.addEventListener('click', async () => {
  try {
    const { withButtonState } = await import('../../ui/form-helper');

    await withButtonState(exportBtn, 'Exporting...', async () => {
      await runEffect(handleExportProgram);
    });
  } catch (error) {
    console.error('Error exporting bookmarks:', error);

    // Handle typed errors
    if (error instanceof ExportError && error.reason === 'no_bookmarks') {
      const { showStatusMessage } = require('../../ui/dom');
      showStatusMessage(statusDiv, error.message, 'error', 5000);
    } else {
      const { showStatusMessage } = require('../../ui/dom');
      showStatusMessage(statusDiv, 'Failed to export bookmarks', 'error', 5000);
    }
  }
});

/**
 * Import file selection handler
 */
importFile.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file) {
    selectedFile = file;
    importFileName.textContent = file.name;
    importBtn.disabled = false;
  } else {
    selectedFile = null;
    importFileName.textContent = '';
    importBtn.disabled = true;
  }

  importStatus.classList.add('hidden');
});

/**
 * Import button click handler
 */
importBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  const file = selectedFile;

  try {
    const { withButtonState } = await import('../../ui/form-helper');

    await withButtonState(importBtn, 'Importing...', async () => {
      await runEffect(handleImportProgram(file));
    });
  } catch (error) {
    console.error('Error importing bookmarks:', error);

    // Handle typed errors
    const { getErrorMessage } = require('../../lib/errors');
    const { createElement } = require('../../ui/dom');

    const errorMessage = error instanceof ImportError || error instanceof FileError
      ? error.message
      : getErrorMessage(error);

    importStatus.textContent = '';
    const errorDiv = createElement('div', { className: 'import-result error' });
    errorDiv.appendChild(createElement('strong', { textContent: 'Import failed: ' }));
    errorDiv.appendChild(document.createTextNode(errorMessage));
    importStatus.appendChild(errorDiv);
    importStatus.classList.remove('hidden');
  }
});
