/**
 * Retry Utility Unit Tests
 */

import { retryWithBackoff, RetryableError } from '../../src/utils/retry';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful request (no retry)', () => {
    it('should return result immediately on first success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Retry on network error (succeeds after retry)', () => {
    it('should retry on network error and succeed', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce('success');
      
      const result = await retryWithBackoff(fn, { maxRetries: 3, initialDelayMs: 10 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Retry on 5xx error (succeeds after retry)', () => {
    it('should retry on 5xx error and succeed', async () => {
      const error500 = new Error('Server error');
      (error500 as any).status = 500;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce('success');
      
      const result = await retryWithBackoff(fn, { maxRetries: 3, initialDelayMs: 10 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Max retries exceeded', () => {
    it('should throw error after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
      
      await expect(
        retryWithBackoff(fn, { maxRetries: 3, initialDelayMs: 10 })
      ).rejects.toThrow('fetch failed');
      
      expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe('No retry on 4xx error', () => {
    it('should not retry on 4xx error', async () => {
      const error401 = new Error('Unauthorized');
      (error401 as any).status = 401;
      
      const fn = jest.fn().mockRejectedValue(error401);
      
      await expect(
        retryWithBackoff(fn, { maxRetries: 3, initialDelayMs: 10 })
      ).rejects.toThrow('Unauthorized');
      
      expect(fn).toHaveBeenCalledTimes(1); // No retry
    });
  });

  describe('Exponential backoff timing', () => {
    it('should apply exponential backoff with jitter', async () => {
      const delays: number[] = [];
      const startTime = Date.now();
      
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, delay);
      }) as any;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce('success');
      
      await retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitter: true,
      });
      
      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
      
      expect(fn).toHaveBeenCalledTimes(4);
      expect(delays.length).toBe(3); // 3 retries
      
      // Check exponential backoff (with jitter variance)
      // Expected: ~100ms, ~200ms, ~400ms (with jitter)
      expect(delays[0]).toBeGreaterThanOrEqual(100);
      expect(delays[0]).toBeLessThan(130); // 100 + 30% jitter
      
      expect(delays[1]).toBeGreaterThanOrEqual(200);
      expect(delays[1]).toBeLessThan(260); // 200 + 30% jitter
      
      expect(delays[2]).toBeGreaterThanOrEqual(400);
      expect(delays[2]).toBeLessThan(520); // 400 + 30% jitter
    });
  });

  describe('Jitter application', () => {
    it('should apply jitter when enabled', async () => {
      const delays: number[] = [];
      
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, delay);
      }) as any;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce('success');
      
      await retryWithBackoff(fn, {
        maxRetries: 1,
        initialDelayMs: 100,
        jitter: true,
      });
      
      global.setTimeout = originalSetTimeout;
      
      // With jitter, delay should be between 100ms and 130ms (100 + 30%)
      expect(delays[0]).toBeGreaterThanOrEqual(100);
      expect(delays[0]).toBeLessThan(130);
    });

    it('should not apply jitter when disabled', async () => {
      const delays: number[] = [];
      
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, delay);
      }) as any;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce('success');
      
      await retryWithBackoff(fn, {
        maxRetries: 1,
        initialDelayMs: 100,
        jitter: false,
      });
      
      global.setTimeout = originalSetTimeout;
      
      // Without jitter, delay should be exactly 100ms
      expect(delays[0]).toBe(100);
    });
  });

  describe('Custom retryable function', () => {
    it('should use custom retryable function', async () => {
      const customError = new Error('Custom error');
      
      const fn = jest.fn().mockRejectedValue(customError);
      
      const retryable = jest.fn().mockReturnValue(false);
      
      await expect(
        retryWithBackoff(fn, { maxRetries: 3, retryable })
      ).rejects.toThrow('Custom error');
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(retryable).toHaveBeenCalledWith(customError);
    });
  });

  describe('RetryableError', () => {
    it('should respect RetryableError retryable flag', async () => {
      const retryableError = new RetryableError('Retryable', true);
      const nonRetryableError = new RetryableError('Not retryable', false);
      
      const fn1 = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce('success');
      
      const result1 = await retryWithBackoff(fn1, { maxRetries: 1, initialDelayMs: 10 });
      expect(result1).toBe('success');
      expect(fn1).toHaveBeenCalledTimes(2);
      
      const fn2 = jest.fn().mockRejectedValue(nonRetryableError);
      await expect(
        retryWithBackoff(fn2, { maxRetries: 3, initialDelayMs: 10 })
      ).rejects.toThrow('Not retryable');
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Max delay cap', () => {
    it('should cap delay at maxDelayMs', async () => {
      const delays: number[] = [];
      
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, delay);
      }) as any;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce('success');
      
      await retryWithBackoff(fn, {
        maxRetries: 1,
        initialDelayMs: 1000,
        maxDelayMs: 500,
        backoffMultiplier: 2,
        jitter: false, // Disable jitter for precise test
      });
      
      global.setTimeout = originalSetTimeout;
      
      // Delay should be capped at 500ms, not 2000ms
      expect(delays[0]).toBeLessThanOrEqual(500);
    });
  });
});

