/**
 * State Manager for Service Worker Operations
 *
 * Provides robust state management with:
 * - Session ID tracking to detect service worker restarts
 * - Timeout-based recovery to prevent stuck flags
 * - Thread-safe flag management
 */

// Generate a unique session ID when the module loads (service worker starts)
const SESSION_ID = crypto.randomUUID();

interface StateManagerOptions {
  /** Operation name for logging purposes */
  name: string;
  /** Timeout in milliseconds after which the operation is considered stuck */
  timeoutMs: number;
}

interface OperationState {
  isActive: boolean;
  startTime: number;
  sessionId: string;
}

/**
 * Manages a boolean flag with timeout and session validation
 */
export class StateManager {
  private state: OperationState = {
    isActive: false,
    startTime: 0,
    sessionId: SESSION_ID,
  };

  private readonly options: StateManagerOptions;

  constructor(options: StateManagerOptions) {
    this.options = options;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return SESSION_ID;
  }

  /**
   * Check if the operation is currently active
   * Returns false if:
   * - Not currently active
   * - Timeout exceeded (automatically resets)
   * - Session changed (service worker restarted)
   */
  isActive(): boolean {
    if (!this.state.isActive) {
      return false;
    }

    // Check if session changed (service worker restarted)
    if (this.state.sessionId !== SESSION_ID) {
      console.warn(
        `[${this.options.name}] Session changed (service worker restarted), resetting state`
      );
      this.reset();
      return false;
    }

    const elapsed = Date.now() - this.state.startTime;
    if (elapsed > this.options.timeoutMs) {
      console.warn(
        `[${this.options.name}] Operation timeout exceeded (${elapsed}ms > ${this.options.timeoutMs}ms), resetting state`
      );
      this.reset();
      return false;
    }

    return true;
  }

  /**
   * Start the operation
   * Returns false if already active (with valid session and not timed out)
   */
  start(): boolean {
    // Check if already active (this will auto-reset if timed out or session changed)
    if (this.isActive()) {
      console.log(`[${this.options.name}] Already active, skipping`);
      return false;
    }

    this.state = {
      isActive: true,
      startTime: Date.now(),
      sessionId: SESSION_ID,
    };

    console.log(`[${this.options.name}] Operation started`);
    return true;
  }

  /**
   * Reset the operation state
   */
  reset(): void {
    if (this.state.isActive) {
      const duration = Date.now() - this.state.startTime;
      console.log(`[${this.options.name}] Operation completed in ${duration}ms`);
    }

    this.state = {
      isActive: false,
      startTime: 0,
      sessionId: SESSION_ID,
    };
  }

  /**
   * Get the current state (for debugging/testing)
   */
  getState(): Readonly<OperationState> {
    return { ...this.state };
  }

  /**
   * Get elapsed time since operation started (in milliseconds)
   * Returns 0 if not active
   */
  getElapsedTime(): number {
    if (!this.state.isActive) {
      return 0;
    }
    return Date.now() - this.state.startTime;
  }

  /**
   * Check if the operation is close to timing out
   * Returns true if more than 80% of timeout has elapsed
   */
  isNearTimeout(): boolean {
    if (!this.state.isActive) {
      return false;
    }
    const elapsed = this.getElapsedTime();
    return elapsed > this.options.timeoutMs * 0.8;
  }
}

/**
 * Create a state manager with the given options
 */
export function createStateManager(options: StateManagerOptions): StateManager {
  return new StateManager(options);
}
