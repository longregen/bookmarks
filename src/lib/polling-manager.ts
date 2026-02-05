export interface Poller {
  start(): void;
  stop(): void;
}

export interface PollerOptions {
  immediate?: boolean;
}

export function createPoller(
  callback: () => Promise<void> | void,
  intervalMs: number,
  options?: PollerOptions
): Poller {
  let timeoutId: number | null = null;
  let running = false;

  const scheduleNext = (): void => {
    if (!running) return;
    timeoutId = window.setTimeout(tick, intervalMs);
  };

  const tick = (): void => {
    if (!running) return;
    const result = callback();
    if (result instanceof Promise) {
      result
        .catch((error: unknown) => {
          console.error('Error in poller callback:', error);
        })
        .finally(() => scheduleNext());
    } else {
      scheduleNext();
    }
  };

  const start = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    running = true;

    if (options?.immediate === true) {
      const result = callback();
      if (result instanceof Promise) {
        result
          .catch((error: unknown) => {
            console.error('Error in poller callback:', error);
          })
          .finally(() => scheduleNext());
      } else {
        scheduleNext();
      }
    } else {
      scheduleNext();
    }
  };

  const stop = (): void => {
    running = false;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return {
    start,
    stop,
  };
}
