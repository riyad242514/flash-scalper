/**
 * Contextual Memory Unit Tests
 */

import { ContextualMemory } from '../../../src/services/memory/contextual-memory';
import type { TechnicalIndicators, SignalType } from '../../../src/types';

describe('ContextualMemory', () => {
  let contextualMemory: ContextualMemory;
  let mockIndicators: TechnicalIndicators;

  beforeEach(() => {
    contextualMemory = new ContextualMemory();

    mockIndicators = {
      price: 100,
      rsi: 50,
      momentum: 0.5,
      volumeRatio: 1.2,
      trend: 'UP',
      ema9: 99,
      ema21: 98,
      ema50: 97,
      macd: 0.1,
      macdSignal: 0.05,
      macdHistogram: 0.05,
      macdCrossUp: true,
      macdCrossDown: false,
      bbUpper: 105,
      bbMiddle: 100,
      bbLower: 95,
      bbPercentB: 0.5,
      stochK: 50,
      stochD: 50,
      roc: 0.5,
      williamsR: -50,
      atr: 2,
      atrPercent: 1.5,
    };
  });

  describe('storeContext', () => {
    it('should store market context', () => {
      contextualMemory.storeContext('BTCUSDT', mockIndicators, []);

      const boost = contextualMemory.getContextualBoost('BTCUSDT', 'LONG', 75);
      expect(boost).toBeDefined();
    });
  });

  describe('getContextualBoost', () => {
    it('should return zero boost for new symbol', () => {
      const boost = contextualMemory.getContextualBoost('ETHUSDT', 'LONG', 75);

      expect(boost.confidenceBoost).toBe(0);
      expect(boost.scoreBoost).toBe(0);
    });

    it('should return positive boost for winning patterns', () => {
      contextualMemory.storeContext('BTCUSDT', mockIndicators, [
        { type: 'LONG', confidence: 75, outcome: 'win' },
      ]);

      const boost = contextualMemory.getContextualBoost('BTCUSDT', 'LONG', 75);

      expect(boost.confidenceBoost).toBeGreaterThan(0);
    });

    it('should return negative boost for losing patterns', () => {
      contextualMemory.storeContext('BTCUSDT', mockIndicators, [
        { type: 'LONG', confidence: 75, outcome: 'loss' },
      ]);

      const boost = contextualMemory.getContextualBoost('BTCUSDT', 'LONG', 75);

      expect(boost.confidenceBoost).toBeLessThan(0);
    });
  });

  describe('updateSignalOutcome', () => {
    it('should update signal outcome in context', () => {
      contextualMemory.storeContext('BTCUSDT', mockIndicators, [
        { type: 'LONG', confidence: 75 },
      ]);

      contextualMemory.updateSignalOutcome('BTCUSDT', 'LONG', 'win');

      const boost = contextualMemory.getContextualBoost('BTCUSDT', 'LONG', 75);
      expect(boost.confidenceBoost).toBeGreaterThan(0);
    });
  });

  describe('clearContexts', () => {
    it('should clear contexts for a symbol', () => {
      contextualMemory.storeContext('BTCUSDT', mockIndicators, []);
      contextualMemory.clearContexts('BTCUSDT');

      const boost = contextualMemory.getContextualBoost('BTCUSDT', 'LONG', 75);
      expect(boost.confidenceBoost).toBe(0);
    });
  });
});

