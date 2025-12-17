/**
 * Centralized configuration constants
 *
 * This file re-exports the configuration system. Use the `config` object
 * for accessing configurable values that respect user overrides from the
 * Advanced Config page.
 *
 * Example:
 *   import { config } from './constants';
 *   const timeout = config.FETCH_TIMEOUT_MS;
 *
 * For tests that need predictable values, use CONFIG_DEFAULTS instead:
 *   import { CONFIG_DEFAULTS } from './constants';
 *   expect(result).toBe(CONFIG_DEFAULTS.FETCH_TIMEOUT_MS);
 */

// Re-export config object and defaults from the registry
export { config, CONFIG_DEFAULTS } from './config-registry';

// ============================================================================
// NON-CONFIGURABLE TIME CONSTANTS
// ============================================================================
// These are mathematical constants that don't need user customization

/** Time-related constants grouped for better organization */
export const TIME = {
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  MS_PER_DAY: 86400000,
} as const;
