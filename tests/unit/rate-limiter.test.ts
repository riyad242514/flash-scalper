/**
 * Rate Limiter Unit Tests
 */

import { RateLimiter, RateLimiterManager, RateLimitError } from '../../src/utils/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Allow requests under limit', () => {
    it('should allow requests within rate limit', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Make 60 requests (at limit)
      for (let i = 0; i < 60; i++) {
        const canMake = limiter.canMakeRequest();
        expect(canMake).toBe(true);
        limiter.tryAcquireToken();
      }
      
      expect(limiter.getAvailableTokens()).toBe(0);
    });

    it('should allow requests after refill', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquireToken();
      }
      
      expect(limiter.canMakeRequest()).toBe(false);
      
      // Advance time by 1 second (should refill 1 token)
      jest.advanceTimersByTime(1000);
      
      expect(limiter.canMakeRequest()).toBe(true);
    });
  });

  describe('Reject requests over limit', () => {
    it('should reject requests over limit', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquireToken();
      }
      
      // 61st request should fail
      expect(limiter.canMakeRequest()).toBe(false);
      expect(limiter.tryAcquireToken()).toBe(false);
    });

    it('should throw RateLimitError when acquiring token over limit', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquireToken();
      }
      
      // 61st request should throw (with short wait time)
      const promise = limiter.acquireToken(100);
      
      // Advance timers to trigger timeout
      jest.advanceTimersByTime(200);
      
      await expect(promise).rejects.toThrow(RateLimitError);
    });
  });

  describe('Token bucket refill', () => {
    it('should refill tokens over time', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquireToken();
      }
      
      expect(limiter.getAvailableTokens()).toBe(0);
      
      // Advance time by 1 minute (should refill all tokens)
      jest.advanceTimersByTime(60000);
      
      expect(limiter.getAvailableTokens()).toBe(60);
    });

    it('should cap tokens at maxTokens', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60, burstSize: 60 });
      
      // Advance time by 2 minutes (should only have 60 tokens, not 120)
      jest.advanceTimersByTime(120000);
      
      expect(limiter.getAvailableTokens()).toBe(60);
    });
  });

  describe('Per-model rate limiting', () => {
    it('should track rate limiters per model', () => {
      const manager = new RateLimiterManager();
      
      const limiter1 = manager.getLimiter('model1', { requestsPerMinute: 60 });
      const limiter2 = manager.getLimiter('model2', { requestsPerMinute: 30 });
      
      expect(limiter1).not.toBe(limiter2);
      
      // Exhaust model1 tokens
      for (let i = 0; i < 60; i++) {
        limiter1.tryAcquireToken();
      }
      
      // model2 should still have tokens
      expect(limiter1.canMakeRequest()).toBe(false);
      expect(limiter2.canMakeRequest()).toBe(true);
    });

    it('should return same limiter for same model', () => {
      const manager = new RateLimiterManager();
      
      const limiter1 = manager.getLimiter('model1');
      const limiter2 = manager.getLimiter('model1');
      
      expect(limiter1).toBe(limiter2);
    });
  });

  describe('getTimeUntilNextToken', () => {
    it('should return 0 when tokens available', () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      expect(limiter.getTimeUntilNextToken()).toBe(0);
    });

    it('should return time until next token when exhausted', () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquireToken();
      }
      
      const timeUntilNext = limiter.getTimeUntilNextToken();
      expect(timeUntilNext).toBeGreaterThan(0);
      expect(timeUntilNext).toBeLessThanOrEqual(1000); // Should be ~1000ms (1 token per second)
    });
  });

  describe('Reset', () => {
    it('should reset limiter to full tokens', () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60 });
      
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquireToken();
      }
      
      expect(limiter.getAvailableTokens()).toBe(0);
      
      // Reset
      limiter.reset();
      
      expect(limiter.getAvailableTokens()).toBe(60);
    });
  });

  describe('Burst size', () => {
    it('should respect burst size', () => {
      const limiter = new RateLimiter({ requestsPerMinute: 60, burstSize: 30 });
      
      // Should only allow 30 tokens (burst size), not 60
      for (let i = 0; i < 30; i++) {
        expect(limiter.tryAcquireToken()).toBe(true);
      }
      
      expect(limiter.tryAcquireToken()).toBe(false);
    });
  });
});

