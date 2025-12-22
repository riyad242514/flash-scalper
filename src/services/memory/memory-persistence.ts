/**
 * Memory Persistence Service
 * Saves and loads memory state for long-term learning
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
import type { TradeMemory } from './trade-history';

export interface PersistedMemory {
  tradeHistory: TradeMemory[];
  lastSaved: number;
  version: string;
}

export interface MemoryPersistenceConfig {
  enabled: boolean;
  basePath: string;
  autoSaveInterval: number;
  version: string;
}

export class MemoryPersistence {
  private config: MemoryPersistenceConfig;
  private tradeHistoryPath: string;
  private patternsPath: string;
  private regimesPath: string;
  private symbolsPath: string;

  constructor(config: MemoryPersistenceConfig) {
    this.config = config;
    this.tradeHistoryPath = path.join(config.basePath, 'trade-history.json');
    this.patternsPath = path.join(config.basePath, 'patterns.json');
    this.regimesPath = path.join(config.basePath, 'regimes.json');
    this.symbolsPath = path.join(config.basePath, 'symbols.json');
  }

  /**
   * Ensure data directory exists
   */
  async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.basePath, { recursive: true });
    } catch (error: any) {
      logger.error({ error: error.message, path: this.config.basePath }, 'Failed to create memory directory');
      throw error;
    }
  }

  /**
   * Save trade history to file
   */
  async saveTradeHistory(trades: TradeMemory[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.ensureDirectory();

      const data: PersistedMemory = {
        tradeHistory: trades,
        lastSaved: Date.now(),
        version: this.config.version,
      };

      const tempPath = `${this.tradeHistoryPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.tradeHistoryPath);

      logger.debug({ count: trades.length, path: this.tradeHistoryPath }, 'Trade history saved');
    } catch (error: any) {
      logger.error({ error: error.message, path: this.tradeHistoryPath }, 'Failed to save trade history');
      throw error;
    }
  }

  /**
   * Load trade history from file
   */
  async loadTradeHistory(): Promise<TradeMemory[]> {
    if (!this.config.enabled) {
      return [];
    }

    try {
      const data = await fs.readFile(this.tradeHistoryPath, 'utf-8');
      const persisted: PersistedMemory = JSON.parse(data);

      if (persisted.version !== this.config.version) {
        logger.warn(
          { savedVersion: persisted.version, currentVersion: this.config.version },
          'Memory version mismatch, clearing old data'
        );
        return [];
      }

      logger.debug({ count: persisted.tradeHistory.length }, 'Trade history loaded');
      return persisted.tradeHistory || [];
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ path: this.tradeHistoryPath }, 'No existing trade history found');
        return [];
      }
      logger.error({ error: error.message, path: this.tradeHistoryPath }, 'Failed to load trade history');
      return [];
    }
  }

  /**
   * Save patterns to file
   */
  async savePatterns(patterns: any): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.ensureDirectory();

      const data = {
        patterns,
        lastSaved: Date.now(),
        version: this.config.version,
      };

      const tempPath = `${this.patternsPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.patternsPath);

      logger.debug({ path: this.patternsPath }, 'Patterns saved');
    } catch (error: any) {
      logger.error({ error: error.message, path: this.patternsPath }, 'Failed to save patterns');
    }
  }

  /**
   * Load patterns from file
   */
  async loadPatterns(): Promise<any> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const data = await fs.readFile(this.patternsPath, 'utf-8');
      const persisted = JSON.parse(data);

      if (persisted.version !== this.config.version) {
        logger.warn({ savedVersion: persisted.version, currentVersion: this.config.version }, 'Pattern version mismatch');
        return null;
      }

      logger.debug({ path: this.patternsPath }, 'Patterns loaded');
      return persisted.patterns || null;
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      logger.error({ error: error.message, path: this.patternsPath }, 'Failed to load patterns');
      return null;
    }
  }

  /**
   * Save market regimes to file
   */
  async saveRegimes(regimes: any): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.ensureDirectory();

      const data = {
        regimes,
        lastSaved: Date.now(),
        version: this.config.version,
      };

      const tempPath = `${this.regimesPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.regimesPath);

      logger.debug({ path: this.regimesPath }, 'Regimes saved');
    } catch (error: any) {
      logger.error({ error: error.message, path: this.regimesPath }, 'Failed to save regimes');
    }
  }

  /**
   * Load market regimes from file
   */
  async loadRegimes(): Promise<any> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const data = await fs.readFile(this.regimesPath, 'utf-8');
      const persisted = JSON.parse(data);

      if (persisted.version !== this.config.version) {
        logger.warn({ savedVersion: persisted.version, currentVersion: this.config.version }, 'Regime version mismatch');
        return null;
      }

      logger.debug({ path: this.regimesPath }, 'Regimes loaded');
      return persisted.regimes || null;
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      logger.error({ error: error.message, path: this.regimesPath }, 'Failed to load regimes');
      return null;
    }
  }

  /**
   * Save symbol intelligence to file
   */
  async saveSymbols(symbols: any): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.ensureDirectory();

      const data = {
        symbols,
        lastSaved: Date.now(),
        version: this.config.version,
      };

      const tempPath = `${this.symbolsPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.symbolsPath);

      logger.debug({ path: this.symbolsPath }, 'Symbols saved');
    } catch (error: any) {
      logger.error({ error: error.message, path: this.symbolsPath }, 'Failed to save symbols');
    }
  }

  /**
   * Load symbol intelligence from file
   */
  async loadSymbols(): Promise<any> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const data = await fs.readFile(this.symbolsPath, 'utf-8');
      const persisted = JSON.parse(data);

      if (persisted.version !== this.config.version) {
        logger.warn({ savedVersion: persisted.version, currentVersion: this.config.version }, 'Symbol version mismatch');
        return null;
      }

      logger.debug({ path: this.symbolsPath }, 'Symbols loaded');
      return persisted.symbols || null;
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      logger.error({ error: error.message, path: this.symbolsPath }, 'Failed to load symbols');
      return null;
    }
  }

  /**
   * Validate persisted memory data
   */
  validateTradeHistory(data: any): data is PersistedMemory {
    if (!data || typeof data !== 'object') {
      return false;
    }
    if (!Array.isArray(data.tradeHistory)) {
      return false;
    }
    if (typeof data.lastSaved !== 'number') {
      return false;
    }
    if (typeof data.version !== 'string') {
      return false;
    }
    return true;
  }
}

