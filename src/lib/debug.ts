type DebugFn = (msg: string, data?: unknown) => void;

export function createDebugLog(prefix: string): DebugFn {
  return __DEBUG_EMBEDDINGS__
    ? (msg: string, data?: unknown) => console.log(`[${prefix}] ${msg}`, data)
    : (_msg: string, _data?: unknown) => {};
}

export function debugOnly(fn: () => void): void {
  if (__DEBUG_EMBEDDINGS__) {
    fn();
  }
}
