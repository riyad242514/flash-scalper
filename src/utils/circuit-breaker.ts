/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by stopping requests when service is down
 */

import { logger } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation, requests pass through
  OPEN = 'OPEN',         // Service is down, requests fail immediately
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;      // Number of failures to open circuit (default: 5)
  successThreshold?: number;      // Number of successes to close circuit (default: 2)
  timeoutMs?: number;             // Time before transitioning OPEN → HALF_OPEN (default: 60000)
  halfOpenTimeoutMs?: number;     // Time before transitioning HALF_OPEN → OPEN on failure (default: 30000)
  onStateChange?: (state: CircuitState) => void; // Callback for state changes
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string = 'Circuit breaker is OPEN') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenStartTime: number = 0;
  
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeoutMs: number;
  private readonly halfOpenTimeoutMs: number;
  private readonly onStateChange?: (state: CircuitState) => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.halfOpenTimeoutMs = options.halfOpenTimeoutMs ?? 30000;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailures(): number {
    return this.failures;
  }

  /**
   * Get success count (in HALF_OPEN state)
   */
  getSuccesses(): number {
    return this.successes;
  }

  /**
   * Execute a function with circuit breaker protection
   * 
   * @param fn - Function to execute
   * @returns Result of the function
   * @throws CircuitBreakerOpenError if circuit is OPEN
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.timeoutMs) {
        this.transitionToHalfOpen();
      } else {
        // Circuit is still OPEN, fail fast
        throw new CircuitBreakerOpenError(
          `Circuit breaker is OPEN. Retry after ${Math.ceil((this.timeoutMs - timeSinceFailure) / 1000)}s`
        );
      }
    }

    // Execute the function
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful execution
   */
  private recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      // If we've had enough successes, close the circuit
      if (this.successes >= this.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success (optional: could keep rolling window)
      // For now, we keep failures until timeout
    }
  }

  /**
   * Record a failed execution
   */
  private recordFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN immediately opens the circuit
      this.transitionToOpen();
    } else if (this.state === CircuitState.CLOSED) {
      this.failures++;
      
      // If we've exceeded the failure threshold, open the circuit
      if (this.failures >= this.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    const oldState = this.state;
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    
    logger.info(
      { oldState, newState: this.state, failures: this.failures },
      'Circuit breaker CLOSED (service recovered)'
    );
    
    this.onStateChange?.(this.state);
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    const oldState = this.state;
    this.state = CircuitState.OPEN;
    this.successes = 0;
    
    logger.warn(
      { oldState, newState: this.state, failures: this.failures },
      `Circuit breaker OPEN (${this.failures} failures, will retry in ${this.timeoutMs / 1000}s)`
    );
    
    this.onStateChange?.(this.state);
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    const oldState = this.state;
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenStartTime = Date.now();
    this.successes = 0;
    
    logger.info(
      { oldState, newState: this.state },
      'Circuit breaker HALF_OPEN (testing service recovery)'
    );
    
    this.onStateChange?.(this.state);
  }

  /**
   * Reset circuit breaker (for testing or manual recovery)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.halfOpenStartTime = 0;
    
    logger.info('Circuit breaker reset to CLOSED');
    this.onStateChange?.(this.state);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
};

