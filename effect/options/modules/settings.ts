import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from '../../lib/effect-utils';
import { DOMService, DOMServiceLive } from '../shared/dom-service';
import { ServiceError } from '../shared/errors';

// ============================================================================
// Types
// ============================================================================

interface Settings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
}

interface TestConnectionSettings {
  apiBaseUrl: string;
  apiKey: string;
  embeddingModel: string;
}

// ============================================================================
// Errors
// ============================================================================

export class SettingsError extends Data.TaggedError('SettingsError')<{
  operation: 'load' | 'save';
  key?: string;
  message: string;
  cause?: unknown;
}> {}

export class ApiError extends Data.TaggedError('ApiError')<{
  endpoint: string;
  message: string;
  statusCode?: number;
  cause?: unknown;
}> {}

export class FormError extends Data.TaggedError('FormError')<{
  formId: string;
  message: string;
  cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

export class SettingsService extends Context.Tag('SettingsService')<
  SettingsService,
  {
    getSettings(): Effect.Effect<Settings, SettingsError>;
    saveSetting(key: keyof Settings, value: string): Effect.Effect<void, SettingsError>;
  }
>() {}

export class ApiService extends Context.Tag('ApiService')<
  ApiService,
  {
    makeRequest(
      endpoint: string,
      payload: unknown,
      settings: TestConnectionSettings
    ): Effect.Effect<unknown, ApiError>;
  }
>() {}

export class FormHelperService extends Context.Tag('FormHelperService')<
  FormHelperService,
  {
    initSettingsForm(config: {
      formId: string;
      statusId: string;
      onLoad: () => Promise<void>;
      onSave: () => Promise<void>;
      saveButtonText: {
        default: string;
        saving: string;
      };
    }): Effect.Effect<void, FormError>;
    withButtonState<A>(
      button: HTMLButtonElement,
      text: string,
      fn: () => Promise<A>
    ): Effect.Effect<A, never>;
  }
>() {}

// ============================================================================
// Constants
// ============================================================================

const TEST_BTN_DEFAULT = 'Test Connection';
const TEST_BTN_VERIFIED = 'Access verified';

// ============================================================================
// Element IDs
// ============================================================================

const ELEMENT_IDS = {
  testBtn: 'testBtn',
  testConnectionStatus: 'testConnectionStatus',
  apiBaseUrl: 'apiBaseUrl',
  apiKey: 'apiKey',
  chatModel: 'chatModel',
  embeddingModel: 'embeddingModel',
  settingsForm: 'settingsForm',
  status: 'status',
} as const;

// ============================================================================
// Effects
// ============================================================================

/**
 * Reset the test button to its default state
 */
function resetTestButton(): Effect.Effect<
  void,
  never,
  DOMService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;

    const testBtn = yield* dom.getElementById<HTMLButtonElement>(ELEMENT_IDS.testBtn);
    const testConnectionStatus = yield* dom.getElementById<HTMLDivElement>(
      ELEMENT_IDS.testConnectionStatus
    );

    const currentText = yield* dom.getTextContent(testBtn);

    if (currentText !== TEST_BTN_DEFAULT) {
      yield* dom.setTextContent(testBtn, TEST_BTN_DEFAULT);
      yield* dom.setClassName(testConnectionStatus, 'test-connection-status hidden');
      yield* dom.setTextContent(testConnectionStatus, '');
    }
  });
}

/**
 * Load settings from storage and populate form inputs
 */
function loadSettings(): Effect.Effect<
  void,
  SettingsError,
  SettingsService | DOMService
> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    const dom = yield* DOMService;

    const settings = yield* settingsService.getSettings();

    const apiBaseUrlInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiBaseUrl);
    const apiKeyInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiKey);
    const chatModelInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.chatModel);
    const embeddingModelInput = yield* dom.getElementById<HTMLInputElement>(
      ELEMENT_IDS.embeddingModel
    );

    yield* dom.setValue(apiBaseUrlInput, settings.apiBaseUrl);
    yield* dom.setValue(apiKeyInput, settings.apiKey);
    yield* dom.setValue(chatModelInput, settings.chatModel);
    yield* dom.setValue(embeddingModelInput, settings.embeddingModel);
  });
}

/**
 * Save settings from form inputs to storage
 */
function saveSettings(): Effect.Effect<
  void,
  SettingsError,
  SettingsService | DOMService
> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    const dom = yield* DOMService;

    const apiBaseUrlInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiBaseUrl);
    const apiKeyInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiKey);
    const chatModelInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.chatModel);
    const embeddingModelInput = yield* dom.getElementById<HTMLInputElement>(
      ELEMENT_IDS.embeddingModel
    );

    const apiBaseUrl = yield* dom.getValue(apiBaseUrlInput);
    const apiKey = yield* dom.getValue(apiKeyInput);
    const chatModel = yield* dom.getValue(chatModelInput);
    const embeddingModel = yield* dom.getValue(embeddingModelInput);

    yield* settingsService.saveSetting('apiBaseUrl', apiBaseUrl.trim());
    yield* settingsService.saveSetting('apiKey', apiKey.trim());
    yield* settingsService.saveSetting('chatModel', chatModel.trim());
    yield* settingsService.saveSetting('embeddingModel', embeddingModel.trim());
  });
}

/**
 * Test the API connection with current settings
 */
function testConnection(): Effect.Effect<
  void,
  ApiError,
  ApiService | DOMService | FormHelperService
> {
  return Effect.gen(function* () {
    const apiService = yield* ApiService;
    const dom = yield* DOMService;
    const formHelper = yield* FormHelperService;

    const testBtn = yield* dom.getElementById<HTMLButtonElement>(ELEMENT_IDS.testBtn);
    const testConnectionStatus = yield* dom.getElementById<HTMLDivElement>(
      ELEMENT_IDS.testConnectionStatus
    );
    const apiBaseUrlInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiBaseUrl);
    const apiKeyInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiKey);
    const embeddingModelInput = yield* dom.getElementById<HTMLInputElement>(
      ELEMENT_IDS.embeddingModel
    );

    yield* dom.setClassName(testConnectionStatus, 'test-connection-status testing');
    yield* dom.setTextContent(testConnectionStatus, 'Testing connection...');

    const apiBaseUrl = yield* dom.getValue(apiBaseUrlInput);
    const apiKey = yield* dom.getValue(apiKeyInput);
    const embeddingModel = yield* dom.getValue(embeddingModelInput);

    const settings: TestConnectionSettings = {
      apiBaseUrl: apiBaseUrl.trim(),
      apiKey: apiKey.trim(),
      embeddingModel: embeddingModel.trim(),
    };

    yield* formHelper.withButtonState(testBtn, 'Testing...', async () => {
      await Effect.runPromise(
        apiService.makeRequest('/embeddings', {
          model: settings.embeddingModel,
          input: ['test'],
        }, settings)
      );
    });

    yield* dom.setTextContent(testBtn, TEST_BTN_VERIFIED);
    yield* dom.setClassName(testConnectionStatus, 'test-connection-status success');
    yield* dom.setTextContent(
      testConnectionStatus,
      '✓ Connection successful! API is working correctly.'
    );
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const dom = yield* DOMService;

        const testBtn = yield* dom.getElementById<HTMLButtonElement>(ELEMENT_IDS.testBtn);
        const testConnectionStatus = yield* dom.getElementById<HTMLDivElement>(
          ELEMENT_IDS.testConnectionStatus
        );

        yield* Effect.sync(() => console.error('Error testing connection:', error));

        yield* dom.setTextContent(testBtn, TEST_BTN_DEFAULT);
        yield* dom.setClassName(testConnectionStatus, 'test-connection-status error');

        const errorMessage =
          error._tag === 'ApiError'
            ? error.message
            : error._tag === 'DOMError'
            ? error.message
            : 'Unknown error';

        yield* dom.setTextContent(
          testConnectionStatus,
          `✗ Connection failed: ${errorMessage}`
        );
      })
    )
  );
}

/**
 * Set up event listeners for input changes to reset test button
 */
function setupInputListeners(): Effect.Effect<
  void,
  never,
  DOMService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;

    const apiBaseUrlInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiBaseUrl);
    const apiKeyInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.apiKey);
    const chatModelInput = yield* dom.getElementById<HTMLInputElement>(ELEMENT_IDS.chatModel);
    const embeddingModelInput = yield* dom.getElementById<HTMLInputElement>(
      ELEMENT_IDS.embeddingModel
    );

    const resetHandler = () => {
      Effect.runPromise(resetTestButton().pipe(Effect.provide(DOMServiceLive)));
    };

    yield* dom.addEventListener(apiBaseUrlInput, 'input', resetHandler);
    yield* dom.addEventListener(apiKeyInput, 'input', resetHandler);
    yield* dom.addEventListener(chatModelInput, 'input', resetHandler);
    yield* dom.addEventListener(embeddingModelInput, 'input', resetHandler);
  });
}

/**
 * Set up test button click listener
 */
function setupTestButtonListener(): Effect.Effect<
  void,
  never,
  DOMService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;

    const testBtn = yield* dom.getElementById<HTMLButtonElement>(ELEMENT_IDS.testBtn);

    yield* dom.addEventListener(testBtn, 'click', () => {
      Effect.runPromise(
        testConnection().pipe(
          Effect.provide(
            Layer.mergeAll(ApiServiceLive, DOMServiceLive, FormHelperServiceLive)
          )
        )
      );
    });
  });
}

/**
 * Initialize the settings module
 */
export function initSettingsModule(): Effect.Effect<
  void,
  SettingsError | FormError,
  SettingsService | DomService | FormHelperService
> {
  return Effect.gen(function* () {
    const formHelper = yield* FormHelperService;

    yield* setupInputListeners();
    yield* setupTestButtonListener();

    yield* formHelper.initSettingsForm({
      formId: ELEMENT_IDS.settingsForm,
      statusId: ELEMENT_IDS.status,
      onLoad: async () => {
        await Effect.runPromise(
          loadSettings().pipe(
            Effect.provide(Layer.mergeAll(SettingsServiceLive, DOMServiceLive))
          )
        );
      },
      onSave: async () => {
        await Effect.runPromise(
          saveSettings().pipe(
            Effect.provide(Layer.mergeAll(SettingsServiceLive, DOMServiceLive))
          )
        );
      },
      saveButtonText: {
        default: 'Save Settings',
        saving: 'Saving...',
      },
    });
  });
}

// ============================================================================
// Layer Implementations
// ============================================================================

export const SettingsServiceLive: Layer.Layer<SettingsService, never> = makeEffectLayer(
  SettingsService,
  Effect.sync(() => ({
    getSettings: () =>
      Effect.tryPromise({
        try: async () => {
          const { getSettings: _getSettings } = await import('../../lib/settings');
          return _getSettings();
        },
        catch: (error) =>
          new SettingsError({
            operation: 'load',
            message: 'Failed to load settings',
            cause: error,
          }),
      }),

    saveSetting: (key: keyof Settings, value: string) =>
      Effect.tryPromise({
        try: async () => {
          const { saveSetting: _saveSetting } = await import('../../lib/settings');
          await _saveSetting(key, value);
        },
        catch: (error) =>
          new SettingsError({
            operation: 'save',
            key,
            message: `Failed to save setting: ${key}`,
            cause: error,
          }),
      }),
  }))
);

export const ApiServiceLive: Layer.Layer<ApiService, never> = makeEffectLayer(
  ApiService,
  Effect.sync(() => ({
    makeRequest: (
      endpoint: string,
      payload: unknown,
      settings: TestConnectionSettings
    ) =>
      Effect.tryPromise({
        try: async () => {
          const { makeApiRequest } = await import('../../lib/api');
          return makeApiRequest(endpoint, payload, settings);
        },
        catch: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          const statusCode =
            error && typeof error === 'object' && 'status' in error
              ? (error.status as number)
              : undefined;

          return new ApiError({
            endpoint,
            message,
            statusCode,
            cause: error,
          });
        },
      }),
  }))
);


export const FormHelperServiceLive: Layer.Layer<FormHelperService, never> = makeEffectLayer(
  FormHelperService,
  Effect.sync(() => ({
    initSettingsForm: (config) =>
      Effect.tryPromise({
        try: async () => {
          const { initSettingsForm: _initSettingsForm } = await import('../../ui/form-helper');
          _initSettingsForm(config);
        },
        catch: (error) =>
          new FormError({
            formId: config.formId,
            message: 'Failed to initialize settings form',
            cause: error,
          }),
      }),

    withButtonState: <A>(
      button: HTMLButtonElement,
      text: string,
      fn: () => Promise<A>
    ) =>
      Effect.tryPromise({
        try: async () => {
          const { withButtonState: _withButtonState } = await import('../../ui/form-helper');
          return _withButtonState(button, text, fn);
        },
        catch: () => {
          // withButtonState doesn't throw, so this shouldn't happen
          // But we need to satisfy the type system
          throw new Error('Unexpected error in withButtonState');
        },
      }),
  }))
);

export const SettingsModuleLive = Layer.mergeAll(
  SettingsServiceLive,
  ApiServiceLive,
  DOMServiceLive,
  FormHelperServiceLive
);

// ============================================================================
// Public API (compatible with original)
// ============================================================================

/**
 * Initialize the settings module (compatible with original API)
 * This can be called from non-Effect code
 */
export function initSettingsModuleCompat(): void {
  Effect.runPromise(
    initSettingsModule().pipe(Effect.provide(SettingsModuleLive))
  ).catch((error) => {
    console.error('Failed to initialize settings module:', error);
  });
}
