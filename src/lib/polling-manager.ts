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

  const start = () => {
    // Clear any existing interval before starting a new one
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // Execute immediately if requested
    if (options?.immediate) {
      // Execute callback and handle potential promise
      const result = callback();
      if (result instanceof Promise) {
        result.catch(error => {
          console.error('Error in poller callback:', error);
        });
      }
    }

    // Start the interval
    intervalId = window.setInterval(() => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch(error => {
          console.error('Error in poller callback:', error);
        });
      }
    }, intervalMs);
  };

  const stop = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const isRunning = () => {
    return intervalId !== null;
  };

  return {
    start,
    stop,
    isRunning,
  };
}
