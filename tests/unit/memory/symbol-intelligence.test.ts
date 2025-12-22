/**
 * Symbol Intelligence Unit Tests
 */

import { SymbolIntelligenceMemory } from '../../../src/services/memory/symbol-intelligence';
import type { TradeMemory } from '../../../src/services/memory/trade-history';

describe('SymbolIntelligenceMemory', () => {
  let intelligence: SymbolIntelligenceMemory;
  let mockTrade: TradeMemory;

  beforeEach(() => {
    intelligence = new SymbolIntelligenceMemory();

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
      entryIndicators: {
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
      },
      entrySignal: {
        confidence: 75,
        score: 80,
        reasons: [],
        llmAgreed: true,
      },
      entryMarketConditions: {
        trend: 'UP',
        volatility: 2,
        volumeRatio: 1.2,
        timeOfDay: 12,
      },
      exitReason: 'Take profit',
      outcome: 'win',
      winAmount: 0.5,
    };
  });

  describe('learnFromTrade', () => {
    it('should learn from winning trade', () => {
      intelligence.learnFromTrade(mockTrade);

      const performance = intelligence.getSymbolPerformance('BTCUSDT');
      expect(performance).toBeDefined();
      expect(performance!.wins).toBe(1);
      expect(performance!.winRate).toBe(1);
    });

    it('should learn from losing trade', () => {
      const losingTrade = { ...mockTrade, outcome: 'loss' as const, realizedPnl: -0.5, realizedROE: -5, winAmount: 0 };
      intelligence.learnFromTrade(losingTrade);

      const performance = intelligence.getSymbolPerformance('BTCUSDT');
      expect(performance).toBeDefined();
      expect(performance!.losses).toBe(1);
      expect(performance!.winRate).toBe(0);
    });
  });

  describe('getSymbolPriority', () => {
    it('should return neutral priority for new symbol', () => {
      const priority = intelligence.getSymbolPriority('ETHUSDT', []);

      expect(priority).toBe(0.5);
    });

    it('should return higher priority for winning symbols', () => {
      for (let i = 0; i < 5; i++) {
        intelligence.learnFromTrade({ ...mockTrade, id: `trade-${i}`, outcome: 'win' as const });
      }

      const priority = intelligence.getSymbolPriority('BTCUSDT', ['UP', 'high_volume']);

      expect(priority).toBeGreaterThan(0.5);
    });
  });

  describe('getRankedSymbols', () => {
    it('should rank symbols by performance', () => {
      intelligence.learnFromTrade(mockTrade);
      intelligence.learnFromTrade({ ...mockTrade, symbol: 'ETHUSDT', id: 'trade-2', outcome: 'loss' as const, realizedPnl: -0.5, realizedROE: -5, winAmount: 0 });

      const ranked = intelligence.getRankedSymbols();

      expect(ranked[0]).toBe('BTCUSDT');
    });
  });

  describe('getIntelligence and loadIntelligence', () => {
    it('should save and load intelligence correctly', () => {
      intelligence.learnFromTrade(mockTrade);
      const saved = intelligence.getIntelligence();

      const newIntelligence = new SymbolIntelligenceMemory();
      newIntelligence.loadIntelligence(saved);

      const performance = newIntelligence.getSymbolPerformance('BTCUSDT');
      expect(performance).toBeDefined();
      expect(performance!.wins).toBe(1);
    });
  });
});

