/**
 * Constants module for the Effect.ts architecture.
 *
 * This module exports pure constants and re-exports configuration-related
 * types and utilities. Configuration values are accessed through ConfigService
 * in the Effect architecture rather than direct property access.
 */

import type { ConfigValues, ConfigEntry, ConfigEntryWithMetadata } from './config-registry';

export type { ConfigValues, ConfigEntry, ConfigEntryWithMetadata };

export {
  CONFIG_CATEGORIES,
  CONFIG_REGISTRY,
  ConfigService,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigStorageError,
  makeConfigService,
  ConfigServiceLive,
} from './config-registry';

/**
 * Time-related constants for date/time calculations.
 * These are pure values and don't require Effect wrapping.
 */
export const TIME = {
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  MS_PER_DAY: 86400000,
} as const;

/**
 * Migration Guide: Configuration Access
 *
 * OLD APPROACH (non-Effect):
 * ```typescript
 * import { config } from './constants';
 * const timeout = config.FETCH_TIMEOUT_MS;
 * ```
 *
 * NEW APPROACH (Effect.ts):
 * ```typescript
 * import * as Effect from 'effect/Effect';
 * import { ConfigService } from './constants';
 *
 * const program = Effect.gen(function* () {
 *   const configService = yield* ConfigService;
 *   const timeout = yield* configService.getValue('FETCH_TIMEOUT_MS');
 *   // Use timeout...
 * });
 * ```
 *
 * For synchronous access in legacy non-Effect code, you can create a proxy:
 * ```typescript
 * import { makeConfigProxy } from './config-registry';
 * import { Effect, Layer } from 'effect';
 *
 * // Create runtime with storage layer
 * const runtime = Layer.toRuntime(yourStorageLayer);
 * const configService = Effect.runSync(
 *   Effect.gen(function* () {
 *     return yield* ConfigService;
 *   }).pipe(Effect.provide(runtime))
 * );
 * const config = makeConfigProxy(configService);
 * const timeout = config.FETCH_TIMEOUT_MS;
 * ```
 */
