/**
 * Memory Persistence Unit Tests
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryPersistence } from '../../../src/services/memory/memory-persistence';
import type { TradeMemory } from '../../../src/services/memory/trade-history';

describe('MemoryPersistence', () => {
  let persistence: MemoryPersistence;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(__dirname, '../../../../data/test-memory');
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

  describe('ensureDirectory', () => {
    it('should create directory if it does not exist', async () => {
      await persistence.ensureDirectory();
      
      const stats = await fs.stat(testDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should not throw if directory already exists', async () => {
      await persistence.ensureDirectory();
      await expect(persistence.ensureDirectory()).resolves.not.toThrow();
    });
  });

  describe('saveTradeHistory', () => {
    it('should save trade history to file', async () => {
      const trades: TradeMemory[] = [
        {
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
            atrPercent: 2,
          },
          entrySignal: {
            confidence: 75,
            score: 80,
            reasons: ['EMA bullish'],
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
        },
      ];

      await persistence.saveTradeHistory(trades);

      const filePath = path.join(testDir, 'trade-history.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      expect(parsed.tradeHistory).toHaveLength(1);
      expect(parsed.tradeHistory[0].id).toBe('trade-1');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.lastSaved).toBeDefined();
    });

    it('should not save if persistence is disabled', async () => {
      const disabled = new MemoryPersistence({
        enabled: false,
        basePath: testDir,
        autoSaveInterval: 1000,
        version: '1.0.0',
      });

      await disabled.saveTradeHistory([]);
      
      const filePath = path.join(testDir, 'trade-history.json');
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should use atomic write (temp file then rename)', async () => {
      const trades: TradeMemory[] = [];
      await persistence.saveTradeHistory(trades);

      const filePath = path.join(testDir, 'trade-history.json');
      const tempPath = `${filePath}.tmp`;
      
      await expect(fs.access(tempPath)).rejects.toThrow();
      await expect(fs.access(filePath)).resolves.not.toThrow();
    });
  });

  describe('loadTradeHistory', () => {
    it('should load trade history from file', async () => {
      const trades: TradeMemory[] = [
        {
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
            atrPercent: 2,
          },
          entrySignal: {
            confidence: 75,
            score: 80,
            reasons: ['EMA bullish'],
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
        },
      ];

      await persistence.saveTradeHistory(trades);
      const loaded = await persistence.loadTradeHistory();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('trade-1');
    });

    it('should return empty array if file does not exist', async () => {
      const loaded = await persistence.loadTradeHistory();
      expect(loaded).toEqual([]);
    });

    it('should return empty array on version mismatch', async () => {
      const trades: TradeMemory[] = [];
      await persistence.saveTradeHistory(trades);

      const oldPersistence = new MemoryPersistence({
        enabled: true,
        basePath: testDir,
        autoSaveInterval: 1000,
        version: '2.0.0',
      });

      const loaded = await oldPersistence.loadTradeHistory();
      expect(loaded).toEqual([]);
    });

    it('should handle corrupted JSON gracefully', async () => {
      const filePath = path.join(testDir, 'trade-history.json');
      await persistence.ensureDirectory();
      await fs.writeFile(filePath, 'invalid json', 'utf-8');

      const loaded = await persistence.loadTradeHistory();
      expect(loaded).toEqual([]);
    });

    it('should not load if persistence is disabled', async () => {
      const disabled = new MemoryPersistence({
        enabled: false,
        basePath: testDir,
        autoSaveInterval: 1000,
        version: '1.0.0',
      });

      const loaded = await disabled.loadTradeHistory();
      expect(loaded).toEqual([]);
    });
  });

  describe('savePatterns', () => {
    it('should save patterns to file', async () => {
      const patterns = { indicatorCombos: new Map() };
      await persistence.savePatterns(patterns);

      const filePath = path.join(testDir, 'patterns.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      expect(parsed.patterns).toBeDefined();
      expect(parsed.version).toBe('1.0.0');
    });
  });

  describe('loadPatterns', () => {
    it('should load patterns from file', async () => {
      const patterns = { test: 'data' };
      await persistence.savePatterns(patterns);

      const loaded = await persistence.loadPatterns();
      expect(loaded).toEqual(patterns);
    });

    it('should return null if file does not exist', async () => {
      const loaded = await persistence.loadPatterns();
      expect(loaded).toBeNull();
    });
  });

  describe('saveRegimes', () => {
    it('should save regimes to file', async () => {
      const regimes = { current: 'trending_up' };
      await persistence.saveRegimes(regimes);

      const filePath = path.join(testDir, 'regimes.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      expect(parsed.regimes).toEqual(regimes);
    });
  });

  describe('loadRegimes', () => {
    it('should load regimes from file', async () => {
      const regimes = { current: 'trending_up' };
      await persistence.saveRegimes(regimes);

      const loaded = await persistence.loadRegimes();
      expect(loaded).toEqual(regimes);
    });
  });

  describe('saveSymbols', () => {
    it('should save symbols to file', async () => {
      const symbols = { BTCUSDT: { winRate: 0.7 } };
      await persistence.saveSymbols(symbols);

      const filePath = path.join(testDir, 'symbols.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      expect(parsed.symbols).toEqual(symbols);
    });
  });

  describe('loadSymbols', () => {
    it('should load symbols from file', async () => {
      const symbols = { BTCUSDT: { winRate: 0.7 } };
      await persistence.saveSymbols(symbols);

      const loaded = await persistence.loadSymbols();
      expect(loaded).toEqual(symbols);
    });
  });

  describe('validateTradeHistory', () => {
    it('should validate correct trade history structure', () => {
      const valid = {
        tradeHistory: [],
        lastSaved: Date.now(),
        version: '1.0.0',
      };

      expect(persistence.validateTradeHistory(valid)).toBe(true);
    });

    it('should reject invalid structures', () => {
      expect(persistence.validateTradeHistory(null)).toBe(false);
      expect(persistence.validateTradeHistory({})).toBe(false);
      expect(persistence.validateTradeHistory({ tradeHistory: 'invalid' })).toBe(false);
      expect(persistence.validateTradeHistory({ tradeHistory: [], lastSaved: 'invalid' })).toBe(false);
    });
  });
});

