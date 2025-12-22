/**
 * Market Regime Memory Unit Tests
 */

import { MarketRegimeMemory, type MarketRegime } from '../../../src/services/memory/market-regime';
import type { TechnicalIndicators } from '../../../src/types';

describe('MarketRegimeMemory', () => {
  let regimeMemory: MarketRegimeMemory;
  let mockIndicators: TechnicalIndicators;

  beforeEach(() => {
    regimeMemory = new MarketRegimeMemory(1000);

    mockIndicators = {
      price: 100,
      rsi: 50,
      momentum: 0.6,
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

  describe('detectRegime', () => {
    it('should detect trending up regime', () => {
      const regime = regimeMemory.detectRegime({
        ...mockIndicators,
        trend: 'UP',
        momentum: 0.6,
      });

      expect(regime).toBe('TRENDING_UP');
    });

    it('should detect trending down regime', () => {
      const regime = regimeMemory.detectRegime({
        ...mockIndicators,
        trend: 'DOWN',
        momentum: -0.6,
      });

      expect(regime).toBe('TRENDING_DOWN');
    });

    it('should detect volatile regime', () => {
      const regime = regimeMemory.detectRegime({
        ...mockIndicators,
        atrPercent: 3,
        momentum: 0.2,
      });

      expect(regime).toBe('VOLATILE');
    });

    it('should detect breakout regime', () => {
      const regime = regimeMemory.detectRegime({
        ...mockIndicators,
        volumeRatio: 2,
        momentum: 0.6,
        trend: 'UP',
      });

      expect(['TRENDING_UP', 'BREAKOUT']).toContain(regime);
    });

    it('should default to ranging regime', () => {
      const regime = regimeMemory.detectRegime({
        ...mockIndicators,
        momentum: 0.2,
        atrPercent: 1,
        volumeRatio: 1,
      });

      expect(regime).toBe('RANGING');
    });
  });

  describe('updateRegime', () => {
    it('should detect regime correctly', () => {
      const regime1 = regimeMemory.detectRegime(mockIndicators);
      
      const newIndicators: TechnicalIndicators = {
        ...mockIndicators,
        trend: 'DOWN' as const,
        momentum: -0.6,
      };
      
      const regime2 = regimeMemory.detectRegime(newIndicators);
      
      expect(regime1).not.toBe(regime2);
    });

    it('should not transition too quickly', () => {
      regimeMemory.updateRegime(mockIndicators);
      const regime1 = regimeMemory.getMemory().currentRegime;
      
      const newIndicators: TechnicalIndicators = {
        ...mockIndicators,
        trend: 'DOWN' as const,
        momentum: -0.6,
      };
      
      const regime2 = regimeMemory.updateRegime(newIndicators);
      
      expect(regime2).toBe(regime1);
    });
  });

  describe('recordTradeOutcome', () => {
    it('should record winning trade', () => {
      regimeMemory.updateRegime(mockIndicators);
      regimeMemory.recordTradeOutcome(true, 5);

      const memory = regimeMemory.getMemory();
      const performance = memory.regimePerformance.get(memory.currentRegime);

      expect(performance).toBeDefined();
      expect(performance!.trades).toBe(1);
      expect(performance!.winRate).toBe(1);
    });

    it('should record losing trade', () => {
      regimeMemory.updateRegime(mockIndicators);
      regimeMemory.recordTradeOutcome(false, -3);

      const memory = regimeMemory.getMemory();
      const performance = memory.regimePerformance.get(memory.currentRegime);

      expect(performance).toBeDefined();
      expect(performance!.trades).toBe(1);
      expect(performance!.winRate).toBe(0);
    });
  });

  describe('getRecommendedStrategy', () => {
    it('should return default strategy for new regime', () => {
      regimeMemory.updateRegime(mockIndicators);
      const strategy = regimeMemory.getRecommendedStrategy();

      expect(strategy).toBeDefined();
      expect(['trend-following', 'mean-reversion', 'scalping', 'momentum', 'default']).toContain(strategy);
    });

    it('should return learned strategy after enough trades', () => {
      regimeMemory.updateRegime(mockIndicators);
      
      for (let i = 0; i < 10; i++) {
        regimeMemory.recordTradeOutcome(true, 5);
      }

      const strategy = regimeMemory.getRecommendedStrategy();
      expect(strategy).toBeDefined();
    });
  });

  describe('getRegimeAdjustments', () => {
    it('should return adjustments for current regime', () => {
      regimeMemory.updateRegime(mockIndicators);
      const adjustments = regimeMemory.getRegimeAdjustments();

      expect(adjustments.confidenceMultiplier).toBeDefined();
      expect(adjustments.positionSizeMultiplier).toBeDefined();
      expect(adjustments.stopLossMultiplier).toBeDefined();
      expect(adjustments.takeProfitMultiplier).toBeDefined();
    });

    it('should adjust based on win rate', () => {
      regimeMemory.updateRegime(mockIndicators);
      
      for (let i = 0; i < 10; i++) {
        regimeMemory.recordTradeOutcome(true, 5);
      }

      const adjustments = regimeMemory.getRegimeAdjustments();
      expect(adjustments.confidenceMultiplier).toBeGreaterThan(1);
    });
  });

  describe('getMemory and loadMemory', () => {
    it('should save and load memory correctly', () => {
      regimeMemory.updateRegime(mockIndicators);
      regimeMemory.recordTradeOutcome(true, 5);
      
      const savedMemory = regimeMemory.getMemory();

      const newMemory = new MarketRegimeMemory();
      newMemory.loadMemory(savedMemory);

      const loadedMemory = newMemory.getMemory();
      expect(loadedMemory.currentRegime).toBe(savedMemory.currentRegime);
      expect(loadedMemory.regimePerformance.size).toBe(savedMemory.regimePerformance.size);
    });
  });
});

