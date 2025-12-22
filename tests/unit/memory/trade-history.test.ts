/**
 * Trade History Memory Unit Tests
 */

import { TradeHistoryMemory, type TradeMemory } from '../../../src/services/memory/trade-history';
import type { Position, Trade, TechnicalIndicators } from '../../../src/types';

describe('TradeHistoryMemory', () => {
  let memory: TradeHistoryMemory;
  let mockPosition: Position;
  let mockTrade: Trade;
  let mockIndicators: TechnicalIndicators;

  beforeEach(() => {
    memory = new TradeHistoryMemory({
      maxTradesInMemory: 100,
      persistenceEnabled: false,
    });

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
      atrPercent: 2,
      divergence: undefined,
    };

    const now = Date.now();
    mockPosition = {
      id: 'pos-1',
      agentId: 'agent-1',
      userId: 'user-1',
      symbol: 'BTCUSDT',
      side: 'long',
      size: 0.1,
      entryPrice: 100,
      currentPrice: 100,
      leverage: 10,
      marginUsed: 1,
      unrealizedPnl: 0,
      unrealizedROE: 0,
      highestROE: 0,
      lowestROE: 0,
      openedAt: now - 60000,
      updatedAt: now,
      exitTime: now,
      realizedPnl: 0.5,
      realizedROE: 5,
      exitPrice: 105,
    } as Position;

    mockTrade = {
      id: 'trade-1',
      positionId: 'pos-1',
      agentId: 'agent-1',
      userId: 'user-1',
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'close',
      quantity: 0.1,
      price: 105,
      realizedPnl: 0.5,
      fees: 0.01,
      reason: 'Take profit',
      executedAt: Date.now(),
    };
  });

  describe('storeTrade', () => {
    it('should store a trade in memory', () => {
      memory.storeTrade(
        mockPosition,
        mockTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: ['EMA bullish'], llmAgreed: true },
        'Take profit'
      );

      expect(memory.getSize()).toBe(1);
      const stored = memory.getTrade('trade-1');
      expect(stored).toBeDefined();
      expect(stored?.symbol).toBe('BTCUSDT');
      expect(stored?.outcome).toBe('win');
    });

    it('should categorize trade as win when PnL > 0.01', () => {
      const position = { ...mockPosition, realizedPnl: 0.5 };
      const trade = { ...mockTrade, realizedPnl: 0.5 };
      memory.storeTrade(
        position,
        trade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Take profit'
      );

      const stored = memory.getTrade('trade-1');
      expect(stored?.outcome).toBe('win');
      expect(stored?.winAmount).toBe(0.5);
    });

    it('should categorize trade as loss when PnL < -0.01', () => {
      const position = { ...mockPosition, realizedPnl: -0.5 };
      const trade = { ...mockTrade, realizedPnl: -0.5 };
      memory.storeTrade(
        position,
        trade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Stop loss'
      );

      const stored = memory.getTrade('trade-1');
      expect(stored?.outcome).toBe('loss');
      expect(stored?.winAmount).toBe(0);
    });

    it('should categorize trade as breakeven when PnL is near zero', () => {
      const position = { ...mockPosition, realizedPnl: 0.005 };
      const trade = { ...mockTrade, realizedPnl: 0.005 };
      memory.storeTrade(
        position,
        trade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Time exit'
      );

      const stored = memory.getTrade('trade-1');
      expect(stored?.outcome).toBe('breakeven');
    });

    it('should store entry market conditions', () => {
      memory.storeTrade(
        mockPosition,
        mockTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Take profit'
      );

      const stored = memory.getTrade('trade-1');
      expect(stored?.entryMarketConditions.trend).toBe('UP');
      expect(stored?.entryMarketConditions.volumeRatio).toBe(1.2);
      expect(stored?.entryMarketConditions.volatility).toBe(2);
    });
  });

  describe('getTrade', () => {
    it('should retrieve trade by ID', () => {
      memory.storeTrade(
        mockPosition,
        mockTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Take profit'
      );

      const trade = memory.getTrade('trade-1');
      expect(trade).toBeDefined();
      expect(trade?.id).toBe('trade-1');
    });

    it('should return undefined for non-existent trade', () => {
      const trade = memory.getTrade('non-existent');
      expect(trade).toBeUndefined();
    });
  });

  describe('getTradesBySymbol', () => {
    it('should return all trades for a symbol', () => {
      memory.storeTrade(
        mockPosition,
        mockTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Take profit'
      );

      const trades = memory.getTradesBySymbol('BTCUSDT');
      expect(trades.length).toBe(1);
      expect(trades[0].symbol).toBe('BTCUSDT');
    });

    it('should return empty array for symbol with no trades', () => {
      const trades = memory.getTradesBySymbol('ETHUSDT');
      expect(trades).toEqual([]);
    });
  });

  describe('getRecentTrades', () => {
    it('should return recent trades in descending order', () => {
      const now = Date.now();
      
      for (let i = 0; i < 5; i++) {
        const position = { ...mockPosition, entryTime: now - (i + 1) * 60000, exitTime: now - i * 60000 };
        const trade = { ...mockTrade, id: `trade-${i}`, executedAt: now - i * 60000 };
        memory.storeTrade(
          position,
          trade,
          mockIndicators,
          { confidence: 75, score: 80, reasons: [], llmAgreed: true },
          'Take profit'
        );
      }

      const recent = memory.getRecentTrades(3);
      expect(recent.length).toBe(3);
      expect(recent[0].id).toBe('trade-0');
      expect(recent[1].id).toBe('trade-1');
      expect(recent[2].id).toBe('trade-2');
    });
  });

  describe('getTradesByOutcome', () => {
    it('should filter trades by outcome', () => {
      const winPosition = { ...mockPosition, realizedPnl: 0.5 };
      const lossPosition = { ...mockPosition, realizedPnl: -0.5, id: 'pos-2' };
      const winTrade = { ...mockTrade, realizedPnl: 0.5 };
      const lossTrade = { ...mockTrade, id: 'trade-2', realizedPnl: -0.5 };
      
      memory.storeTrade(
        winPosition,
        winTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Take profit'
      );

      memory.storeTrade(
        lossPosition,
        lossTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Stop loss'
      );

      const wins = memory.getTradesByOutcome('win');
      const losses = memory.getTradesByOutcome('loss');

      expect(wins.length).toBe(1);
      expect(losses.length).toBe(1);
    });
  });

  describe('getStatistics', () => {
    it('should calculate correct statistics', () => {
      for (let i = 0; i < 10; i++) {
        const pnl = i < 7 ? 0.5 : -0.5;
        const position = { ...mockPosition, id: `pos-${i}`, realizedPnl: pnl };
        const trade = { ...mockTrade, id: `trade-${i}`, realizedPnl: pnl };
        memory.storeTrade(
          position,
          trade,
          mockIndicators,
          { confidence: 75, score: 80, reasons: [], llmAgreed: true },
          pnl > 0 ? 'Take profit' : 'Stop loss'
        );
      }

      const stats = memory.getStatistics();
      expect(stats.totalTrades).toBe(10);
      expect(stats.wins).toBe(7);
      expect(stats.losses).toBe(3);
      expect(stats.winRate).toBe(0.7);
    });

    it('should handle empty memory', () => {
      const stats = memory.getStatistics();
      expect(stats.totalTrades).toBe(0);
      expect(stats.winRate).toBe(0);
    });
  });

  describe('pruneOldTrades', () => {
    it('should prune trades when limit exceeded', () => {
      const config = { maxTradesInMemory: 5, persistenceEnabled: false };
      const limitedMemory = new TradeHistoryMemory(config);

      for (let i = 0; i < 10; i++) {
        const position = { ...mockPosition, id: `pos-${i}` };
        const trade = { ...mockTrade, id: `trade-${i}` };
        limitedMemory.storeTrade(
          position,
          trade,
          mockIndicators,
          { confidence: 75, score: 80, reasons: [], llmAgreed: true },
          'Take profit'
        );
      }

      expect(limitedMemory.getSize()).toBe(5);
    });

    it('should maintain most recent trades', () => {
      const config = { maxTradesInMemory: 3, persistenceEnabled: false };
      const limitedMemory = new TradeHistoryMemory(config);

      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        const position = { ...mockPosition, id: `pos-${i}`, entryTime: now - (i + 1) * 60000, exitTime: now - i * 60000 };
        const trade = { ...mockTrade, id: `trade-${i}`, executedAt: now - i * 60000 };
        limitedMemory.storeTrade(
          position,
          trade,
          mockIndicators,
          { confidence: 75, score: 80, reasons: [], llmAgreed: true },
          'Take profit'
        );
      }

      expect(limitedMemory.getSize()).toBe(3);
      const recent = limitedMemory.getRecentTrades(3);
      expect(recent.map(t => t.id)).toEqual(['trade-0', 'trade-1', 'trade-2']);
    });
  });

  describe('clear', () => {
    it('should clear all trades', () => {
      memory.storeTrade(
        mockPosition,
        mockTrade,
        mockIndicators,
        { confidence: 75, score: 80, reasons: [], llmAgreed: true },
        'Take profit'
      );

      expect(memory.getSize()).toBe(1);
      memory.clear();
      expect(memory.getSize()).toBe(0);
    });
  });
});

