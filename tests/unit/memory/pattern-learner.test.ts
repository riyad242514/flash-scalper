/**
 * Pattern Learner Unit Tests
 */

import { PatternLearner, type PatternMemory } from '../../../src/services/memory/pattern-learner';
import type { TradeMemory } from '../../../src/services/memory/trade-history';
import type { TechnicalIndicators } from '../../../src/types';

describe('PatternLearner', () => {
  let learner: PatternLearner;
  let mockTrade: TradeMemory;
  let mockIndicators: TechnicalIndicators;

  beforeEach(() => {
    learner = new PatternLearner(3);

    mockIndicators = {
      price: 100,
      rsi: 30,
      momentum: 0.6,
      volumeRatio: 1.5,
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
      atrPercent: 2,
    };

    mockTrade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      side: 'long',
      entryTime: Date.now() - 60000,
      exitTime: Date.now(),
      entryPrice: 100,
      exitPrice: 105,
      realizedPnl: 0.5,
      realizedROE: 5,
      durationMinutes: 1,
      entryIndicators: mockIndicators,
      entrySignal: {
        confidence: 75,
        score: 80,
        reasons: ['EMA bullish'],
        llmAgreed: true,
      },
      entryMarketConditions: {
        trend: 'UP',
        volatility: 2,
        volumeRatio: 1.5,
        timeOfDay: 12,
      },
      exitReason: 'Take profit',
      outcome: 'win',
      winAmount: 0.5,
    };
  });

  describe('learnFromTrade', () => {
    it('should learn from winning trade', () => {
      learner.learnFromTrade(mockTrade);

      const memory = learner.getMemory();
      expect(memory.indicatorCombos.size).toBeGreaterThan(0);
      expect(memory.confidenceBuckets.size).toBeGreaterThan(0);
    });

    it('should learn from losing trade', () => {
      const losingTrade = { ...mockTrade, outcome: 'loss' as const, realizedPnl: -0.5, realizedROE: -5, winAmount: 0 };
      learner.learnFromTrade(losingTrade);

      const memory = learner.getMemory();
      expect(memory.indicatorCombos.size).toBeGreaterThan(0);
    });

    it('should ignore breakeven trades', () => {
      const breakevenTrade = { ...mockTrade, outcome: 'breakeven' as const, realizedPnl: 0.005, realizedROE: 0.05, winAmount: 0 };
      learner.learnFromTrade(breakevenTrade);

      const memory = learner.getMemory();
      expect(memory.indicatorCombos.size).toBe(0);
    });

    it('should update pattern statistics correctly', () => {
      learner.learnFromTrade(mockTrade);
      learner.learnFromTrade({ ...mockTrade, id: 'trade-2', outcome: 'win' as const });
      learner.learnFromTrade({ ...mockTrade, id: 'trade-3', outcome: 'loss' as const, realizedPnl: -0.5, realizedROE: -5, winAmount: 0 });

      const memory = learner.getMemory();
      expect(memory.indicatorCombos.size).toBeGreaterThan(0);
      
      const anyPattern = Array.from(memory.indicatorCombos.values())[0];
      expect(anyPattern.wins + anyPattern.losses).toBeGreaterThan(0);
    });
  });

  describe('getPatternBoost', () => {
    it('should return zero boost for new patterns', () => {
      const boost = learner.getPatternBoost(mockIndicators, 75, 'UP', 'BTCUSDT', true, 12);

      expect(boost.confidenceBoost).toBe(0);
      expect(boost.scoreBoost).toBe(0);
    });

    it('should return positive boost for winning patterns', () => {
      for (let i = 0; i < 5; i++) {
        learner.learnFromTrade({ ...mockTrade, id: `trade-${i}`, outcome: 'win' as const });
      }

      const boost = learner.getPatternBoost(mockIndicators, 75, 'UP', 'BTCUSDT', true, 12);

      expect(boost.confidenceBoost).toBeGreaterThan(0);
      expect(boost.scoreBoost).toBeGreaterThan(0);
    });

    it('should return negative boost for losing patterns', () => {
      for (let i = 0; i < 10; i++) {
        learner.learnFromTrade({ 
          ...mockTrade, 
          id: `trade-${i}`, 
          outcome: 'loss' as const, 
          realizedPnl: -0.5, 
          realizedROE: -5, 
          winAmount: 0 
        });
      }

      const boost = learner.getPatternBoost(mockIndicators, 75, 'UP', 'BTCUSDT', true, 12);

      expect(boost.confidenceBoost).toBeLessThanOrEqual(0);
      expect(boost.scoreBoost).toBeLessThanOrEqual(0);
    });

    it('should cap boost values', () => {
      for (let i = 0; i < 20; i++) {
        learner.learnFromTrade({ ...mockTrade, id: `trade-${i}`, outcome: 'win' as const, realizedROE: 10 });
      }

      const boost = learner.getPatternBoost(mockIndicators, 75, 'UP', 'BTCUSDT', true, 12);

      expect(boost.confidenceBoost).toBeLessThanOrEqual(10);
      expect(boost.scoreBoost).toBeLessThanOrEqual(15);
    });
  });

  describe('getMemory and loadMemory', () => {
    it('should save and load memory correctly', () => {
      learner.learnFromTrade(mockTrade);
      const savedMemory = learner.getMemory();

      const newLearner = new PatternLearner();
      newLearner.loadMemory(savedMemory);

      const loadedMemory = newLearner.getMemory();
      expect(loadedMemory.indicatorCombos.size).toBe(savedMemory.indicatorCombos.size);
    });
  });

  describe('prunePatterns', () => {
    it('should prune low-utility patterns', () => {
      for (let i = 0; i < 10; i++) {
        learner.learnFromTrade({ ...mockTrade, id: `trade-${i}` });
      }

      const beforePrune = learner.getMemory().indicatorCombos.size;
      learner.prunePatterns(5, 0.1);
      const afterPrune = learner.getMemory().indicatorCombos.size;

      expect(afterPrune).toBeLessThanOrEqual(beforePrune);
    });
  });
});

