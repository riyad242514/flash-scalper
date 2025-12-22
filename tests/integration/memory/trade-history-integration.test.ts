/**
 * Trade History Integration Tests
 */

import { TradeHistoryMemory } from '../../../src/services/memory/trade-history';
import { MemoryPersistence } from '../../../src/services/memory/memory-persistence';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Position, Trade, TechnicalIndicators } from '../../../src/types';

describe('Trade History Integration', () => {
  let tradeHistory: TradeHistoryMemory;
  let persistence: MemoryPersistence;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(__dirname, '../../../../data/test-memory-integration');
    tradeHistory = new TradeHistoryMemory({
      maxTradesInMemory: 100,
      persistenceEnabled: true,
      persistencePath: testDir,
    });

    persistence = new MemoryPersistence({
      enabled: true,
      basePath: testDir,
      autoSaveInterval: 1000,
      version: '1.0.0',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should store and persist trades', async () => {
    const now = Date.now();
    const position: Position = {
      id: 'pos-1',
      agentId: 'agent-1',
      symbol: 'BTCUSDT',
      side: 'long',
      size: 0.1,
      entryPrice: 100,
      currentPrice: 105,
      leverage: 10,
      marginUsed: 1,
      unrealizedPnl: 0,
      unrealizedROE: 0,
      highestROE: 0,
      lowestROE: 0,
      openedAt: now - 60000,
      updatedAt: now,
    };

    const trade: Trade = {
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
      executedAt: now,
    };

    const indicators: TechnicalIndicators = {
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
    };

    tradeHistory.storeTrade(
      position,
      trade,
      indicators,
      { confidence: 75, score: 80, reasons: ['EMA bullish'], llmAgreed: true },
      'Take profit'
    );

    const trades = tradeHistory.getAllTrades();
    expect(trades.length).toBe(1);

    await persistence.saveTradeHistory(trades);
    const loaded = await persistence.loadTradeHistory();

    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe('trade-1');
  });
});

