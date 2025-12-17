// Generate a unique session ID when the module loads (service worker starts)
const SESSION_ID = crypto.randomUUID();

interface StateManagerOptions {
  name: string;
  timeoutMs: number;
}

interface OperationState {
  isActive: boolean;
  startTime: number;
  sessionId: string;
}

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

  getSessionId(): string {
    return SESSION_ID;
  }

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

  getState(): Readonly<OperationState> {
    return { ...this.state };
  }

  getElapsedTime(): number {
    if (!this.state.isActive) {
      return 0;
    }
    return Date.now() - this.state.startTime;
  }

  isNearTimeout(): boolean {
    if (!this.state.isActive) {
      return false;
    }
    const elapsed = this.getElapsedTime();
    return elapsed > this.options.timeoutMs * 0.8;
  }
}

export function createStateManager(options: StateManagerOptions): StateManager {
  return new StateManager(options);
}
