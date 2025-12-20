import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { ConfigError } from '../lib/errors';

/**
 * Service for accessing configuration values in an Effect context
 */
export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  {
    /**
     * Get a configuration value by key
     * @param key - Configuration key
     * @returns Effect that yields the config value or fails with ConfigError
     */
    readonly get: <T>(key: string) => Effect.Effect<T, ConfigError, never>;
  }
>() {}
