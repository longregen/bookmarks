// Debug utilities that compile away when __DEBUG_EMBEDDINGS__ is false

type DebugFn = (msg: string, data?: unknown) => void;

/**
 * Creates a debug logger with a specific prefix.
 * Compiles away to a no-op when __DEBUG_EMBEDDINGS__ is false.
 */
export function createDebugLog(prefix: string): DebugFn {
  return __DEBUG_EMBEDDINGS__
    ? (msg: string, data?: unknown) => console.log(`[${prefix}] ${msg}`, data)
    : (_msg: string, _data?: unknown) => {};
}

/**
 * Execute a callback only when debug mode is enabled.
 * Use this for complex debug logging that involves computations.
 */
export function debugOnly(fn: () => void): void {
  if (__DEBUG_EMBEDDINGS__) {
    fn();
  }
}
