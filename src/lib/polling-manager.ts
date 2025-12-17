export interface Poller {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface PollerOptions {
  immediate?: boolean;
}

/**
 * Creates a poller that executes a callback at a specified interval.
 *
 * @param callback - The function to execute on each interval
 * @param intervalMs - The interval in milliseconds between executions
 * @param options - Optional configuration
 * @param options.immediate - If true, execute callback immediately on start (default: false)
 * @returns A Poller object with start/stop/isRunning methods
 */
export function createPoller(
  callback: () => Promise<void> | void,
  intervalMs: number,
  options?: PollerOptions
): Poller {
  let intervalId: number | null = null;

  const start = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    if (options?.immediate === true) {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error('Error in poller callback:', error);
        });
      }
    }

    intervalId = window.setInterval(() => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error('Error in poller callback:', error);
        });
      }
    }, intervalMs);
  };

  const stop = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const isRunning = (): boolean => intervalId !== null;

  return {
    start,
    stop,
    isRunning,
  };
}
