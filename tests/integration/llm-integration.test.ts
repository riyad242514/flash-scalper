/**
 * LLM Integration Tests
 * Tests end-to-end LLM integration with retry, circuit breaker, and rate limiting
 */

import { analyzeEntry, analyzeExit } from '../../src/services/signal/llm-analyzer';
import type { TechnicalIndicators, Position, Kline } from '../../src/types';

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
        timeoutMs: 1000, // Fast timeout for tests
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

describe('LLM Integration', () => {
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

  const mockPosition: Position = {
    id: 'test-position',
    agentId: 'test-agent',
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: 43250,
    currentPrice: 43500,
    size: 0.1,
    leverage: 10,
    marginUsed: 432.5,
    openedAt: Date.now() - 600000,
    updatedAt: Date.now(),
    unrealizedPnl: 25,
    unrealizedROE: 5.8,
    highestROE: 6.2,
    lowestROE: -0.5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('End-to-end entry analysis', () => {
    it('should generate signal with LLM confirmation', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"action": "LONG", "confidence": 75, "reason": "Strong bullish setup"}',
            },
          }],
        }),
      });

      const result = await analyzeEntry('BTCUSDT', 'LONG', mockIndicators, ['EMA bullish stack'], mockKlines);

      expect(result.action).toBe('LONG');
      expect(result.confidence).toBe(75);
      expect(result.agrees).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('End-to-end exit analysis', () => {
    it('should close position based on LLM recommendation', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"action": "EXIT", "confidence": 80, "reason": "Take profit"}',
            },
          }],
        }),
      });

      const result = await analyzeExit(mockPosition, mockIndicators, mockKlines);

      expect(result.action).toBe('EXIT');
      expect(result.confidence).toBe(80);
      expect(result.agrees).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error recovery flow', () => {
    it('should recover after retry on network error', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: '{"action": "LONG", "confidence": 70, "reason": "Recovered after retry"}',
              },
            }],
          }),
        });

      const result = await analyzeEntry('BTCUSDT', 'LONG', mockIndicators, ['EMA bullish stack'], mockKlines);

      expect(result.action).toBe('LONG');
      expect(result.confidence).toBe(70);
      expect(global.fetch).toHaveBeenCalledTimes(2); // Initial + retry
    });
  });

  describe('Circuit breaker recovery flow', () => {
    it('should fast-fail when circuit is OPEN, then recover', async () => {
      // Fail 5 times to open circuit
      for (let i = 0; i < 5; i++) {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Service error'));
      }

      // Try to execute - should fast-fail
      const result1 = await analyzeEntry('BTCUSDT', 'LONG', mockIndicators, ['EMA bullish stack'], mockKlines);
      expect(result1.action).toBe('HOLD');
      expect(result1.agrees).toBe(false);

      // Wait for circuit to transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Success should close circuit
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"action": "LONG", "confidence": 75, "reason": "Circuit recovered"}',
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

