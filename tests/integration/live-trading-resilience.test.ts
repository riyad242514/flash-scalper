/**
 * Live Trading Resilience Tests
 * Tests system behavior under LLM failures
 */

import { analyzeEntry, resetCircuitBreakers } from '../../src/services/signal/llm-analyzer';
import type { TechnicalIndicators, Kline } from '../../src/types';

// Mock fetch
global.fetch = jest.fn();

// Mock config
jest.mock('../../src/config', () => ({
  config: {
    llm: {
      enabled: true,
      apiKey: 'test-key',
      model: 'test-model',
      timeout: 5000,
      retry: {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      },
      circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 1000,
        halfOpenTimeoutMs: 500,
      },
      rateLimit: {
        requestsPerMinute: 60,
        burstSize: 60,
      },
    },
  },
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  signalLogger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock metrics
jest.mock('../../src/utils/metrics', () => ({
  llmRequests: {
    inc: jest.fn(),
  },
  llmLatency: {
    observe: jest.fn(),
  },
  llmRateLimitHits: {
    inc: jest.fn(),
  },
  llmStructuredOutputFailures: {
    inc: jest.fn(),
  },
  llmCircuitBreakerState: {
    set: jest.fn(),
  },
}));

describe('Live Trading Resilience', () => {
  const mockIndicators: TechnicalIndicators = {
    price: 43250,
    rsi: 45.2,
    macd: 0.001,
    macdSignal: 0.0005,
    macdHistogram: 0.001234,
    macdCrossUp: true,
    macdCrossDown: false,
    volumeRatio: 1.5,
    trend: 'UP',
    ema9: 43200,
    ema21: 43100,
    ema50: 43000,
    atr: 500,
    atrPercent: 1.2,
    momentum: 0.5,
    bbUpper: 44000,
    bbMiddle: 43250,
    bbLower: 42500,
    bbPercentB: 0.5,
    stochK: 50,
    stochD: 50,
    roc: 0.5,
    williamsR: -50,
  };

  const mockKlines: Kline[] = Array.from({ length: 100 }, (_, i) => {
    const timestamp = Date.now() - (100 - i) * 60000;
    return {
      open: 43000 + i * 10,
      high: 43100 + i * 10,
      low: 42900 + i * 10,
      close: 43050 + i * 10,
      volume: 1000 + i * 100,
      openTime: timestamp,
      closeTime: timestamp + 60000,
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    resetCircuitBreakers(); // Reset circuit breaker state between tests
  });

  describe('System continues trading with LLM failures', () => {
    it('should handle 10% failure rate gracefully', async () => {
      const results = [];
      const totalRequests = 20;
      let failures = 0;

      for (let i = 0; i < totalRequests; i++) {
        // 10% failure rate (2 failures out of 20)
        if (i % 10 === 0) {
          failures++;
          (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network error'));
        } else {
          (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  content: `{"action": "LONG", "confidence": 70, "reason": "Request ${i}"}`,
                },
              }],
            }),
          });
        }

        try {
          const result = await analyzeEntry('BTCUSDT', 'LONG', mockIndicators, ['EMA bullish stack'], mockKlines);
          results.push(result);
        } catch (error) {
          // Should not throw - errors are handled gracefully
          results.push({ action: 'HOLD', confidence: 0, agrees: false });
        }
      }

      // System should continue processing (no crashes)
      expect(results.length).toBe(totalRequests);
      
      // Most requests should succeed (with retries)
      const successfulResults = results.filter(r => r.agrees !== false || r.confidence > 0);
      expect(successfulResults.length).toBeGreaterThan(totalRequests * 0.8); // At least 80% success
    });
  });

  describe('System recovers when LLM API returns', () => {
    it('should resume LLM calls after API recovery', async () => {
      // Simulate API down (5 failures to open circuit)
      for (let i = 0; i < 5; i++) {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Service error'));
      }

      // First request should fail
      const result1 = await analyzeEntry('BTCUSDT', 'LONG', mockIndicators, ['EMA bullish stack'], mockKlines);
      expect(result1.agrees).toBe(false);

      // Wait for circuit to transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 1100));

      // API recovers - should succeed
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"action": "LONG", "confidence": 75, "reason": "API recovered"}',
            },
          }],
        }),
      });

      const result2 = await analyzeEntry('BTCUSDT', 'LONG', mockIndicators, ['EMA bullish stack'], mockKlines);
      expect(result2.action).toBe('LONG');
      expect(result2.agrees).toBe(true);
    });
  });
});

