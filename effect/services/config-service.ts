import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { ConfigError } from '../lib/errors';

export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  {
    readonly get: <T>(key: string) => Effect.Effect<T, ConfigError, never>;
  }
>() {}
