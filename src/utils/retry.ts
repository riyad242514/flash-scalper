/**
 * Retry Utility with Exponential Backoff
 * Handles transient failures with configurable retry logic
 */

import { logger } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  retryable?: (error: any) => boolean;
}

export class RetryableError extends Error {
  constructor(message: string, public readonly retryable: boolean = true) {
    super(message);
    this.name = 'RetryableError';
  }
}

// =============================================================================
// RETRY LOGIC
// =============================================================================

/**
 * Retry a function with exponential backoff
 * 
 * @param fn - Function to retry
 * @param options - Retry configuration
 * @returns Result of the function
 * @throws Last error if all retries fail
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    jitter = true,
    retryable = defaultRetryable,
  } = options;

  let lastError: any;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const result = await fn();
      
      // Log retry success if this was a retry
      if (attempt > 0) {
        logger.debug(
          { attempt, maxRetries },
          `Retry succeeded after ${attempt} attempts`
        );
      }
      
      return result;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      if (!retryable(error)) {
        logger.debug(
          { error: error.message, attempt },
          'Error is not retryable, failing immediately'
        );
        throw error;
      }

      // If we've exhausted retries, throw the last error
      if (attempt >= maxRetries) {
        logger.warn(
          { error: error.message, attempts: attempt + 1, maxRetries },
          'Max retries exceeded'
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
      const delay = Math.min(baseDelay, maxDelayMs);
      
      // Add jitter to prevent thundering herd
      const jitterAmount = jitter ? Math.random() * 0.3 * delay : 0;
      const finalDelay = delay + jitterAmount;

      logger.debug(
        {
          attempt: attempt + 1,
          maxRetries,
          delayMs: Math.round(finalDelay),
          error: error.message,
        },
        `Retrying after ${Math.round(finalDelay)}ms`
      );

      // Wait before retrying
      await sleep(finalDelay);
      attempt++;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Default retryable check
 * Retries on: network errors, 5xx status codes, timeout errors
 * Doesn't retry on: 4xx (client errors), validation errors
 */
function defaultRetryable(error: any): boolean {
  // Network errors (fetch failed, connection refused, etc.)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return true;
  }

  // 5xx server errors (retryable)
  if (error.status >= 500 && error.status < 600) {
    return true;
  }

  // 4xx client errors (not retryable)
  if (error.status >= 400 && error.status < 500) {
    return false;
  }

  // RetryableError with explicit retryable flag
  if (error instanceof RetryableError) {
    return error.retryable;
  }

  // Default: retry on unknown errors (conservative approach)
  return true;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  retryWithBackoff,
  RetryableError,
};

