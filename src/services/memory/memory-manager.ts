/**
 * Memory Manager
 * Centralized manager for all memory systems
 */

import { TradeHistoryMemory } from './trade-history';
import { MemoryPersistence } from './memory-persistence';
import { PatternLearner } from './pattern-learner';
import { MarketRegimeMemory } from './market-regime';
import { AdaptiveFilters } from './adaptive-filters';
import { ContextualMemory } from './contextual-memory';
import { SymbolIntelligenceMemory } from './symbol-intelligence';
import type { TradeMemory, TradeHistoryConfig } from './trade-history';
import type { MemoryPersistenceConfig } from './memory-persistence';
import type { TechnicalIndicators, SignalType, Position, Trade } from '../../types';
import { logger } from '../../utils/logger';

export interface MemoryManagerConfig {
  tradeHistory: TradeHistoryConfig;
  persistence: MemoryPersistenceConfig;
  enabled: boolean;
}

export class MemoryManager {
  private tradeHistory: TradeHistoryMemory;
  private persistence: MemoryPersistence;
  private patternLearner: PatternLearner;
  private marketRegime: MarketRegimeMemory;
  private adaptiveFilters: AdaptiveFilters;
  private contextualMemory: ContextualMemory;
  private symbolIntelligence: SymbolIntelligenceMemory;
  private enabled: boolean;
  private autoSaveCounter: number = 0;

  constructor(config: MemoryManagerConfig) {
    this.enabled = config.enabled;
    
    if (!this.enabled) {
      this.tradeHistory = new TradeHistoryMemory(config.tradeHistory);
      this.persistence = new MemoryPersistence(config.persistence);
      this.patternLearner = new PatternLearner();
      this.marketRegime = new MarketRegimeMemory();
      this.adaptiveFilters = new AdaptiveFilters({
        minCombinedConfidence: 55,
        minScoreForSignal: 50,
        requireTrendAlignment: false,
        requireVolumeConfirmation: false,
        requireMultiIndicatorConfluence: false,
        minIndicatorConfluence: 3,
        minVolumeSpike: 0.3,
        minTrendStrength: 0.3,
      });
      this.contextualMemory = new ContextualMemory();
      this.symbolIntelligence = new SymbolIntelligenceMemory();
      return;
    }

    this.tradeHistory = new TradeHistoryMemory(config.tradeHistory);
    this.persistence = new MemoryPersistence(config.persistence);
    this.patternLearner = new PatternLearner();
    this.marketRegime = new MarketRegimeMemory();
    this.adaptiveFilters = new AdaptiveFilters({
      minCombinedConfidence: 55,
      minScoreForSignal: 50,
      requireTrendAlignment: false,
      requireVolumeConfirmation: false,
      requireMultiIndicatorConfluence: false,
      minIndicatorConfluence: 3,
      minVolumeSpike: 0.3,
      minTrendStrength: 0.3,
    });
    this.contextualMemory = new ContextualMemory();
    this.symbolIntelligence = new SymbolIntelligenceMemory();
  }

  /**
   * Initialize memory from persisted data
   */
  async initialize(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const persistedTrades = await this.persistence.loadTradeHistory();
      for (const trade of persistedTrades) {
        this.patternLearner.learnFromTrade(trade);
        this.symbolIntelligence.learnFromTrade(trade);
      }

      const persistedPatterns = await this.persistence.loadPatterns();
      if (persistedPatterns) {
        this.patternLearner.loadMemory(persistedPatterns);
      }

      const persistedRegimes = await this.persistence.loadRegimes();
      if (persistedRegimes) {
        this.marketRegime.loadMemory(persistedRegimes);
      }

      const persistedSymbols = await this.persistence.loadSymbols();
      if (persistedSymbols) {
        this.symbolIntelligence.loadIntelligence(persistedSymbols);
      }

      logger.info({ 
        tradesLoaded: persistedTrades.length,
        patternsLoaded: !!persistedPatterns,
        regimesLoaded: !!persistedRegimes,
      }, 'Memory initialized from persistence');
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to load persisted memory - starting fresh');
    }
  }

  /**
   * Store a completed trade
   */
  async storeTrade(
    position: Position,
    trade: Trade,
    entryIndicators: TechnicalIndicators,
    entrySignal: {
      confidence: number;
      score: number;
      reasons: string[];
      llmAgreed: boolean;
    },
    exitReason: string,
    exitIndicators?: TechnicalIndicators
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.tradeHistory.storeTrade(
      position,
      trade,
      entryIndicators,
      entrySignal,
      exitReason,
      exitIndicators
    );

    const tradeMemory = this.tradeHistory.getTrade(trade.id);
    if (tradeMemory) {
      this.patternLearner.learnFromTrade(tradeMemory);
      this.symbolIntelligence.learnFromTrade(tradeMemory);
      
      const isWin = tradeMemory.outcome === 'win';
      this.marketRegime.recordTradeOutcome(isWin, tradeMemory.realizedROE);
      
      this.adaptiveFilters.recordTradeOutcome(
        {
          trendAlignment: entryIndicators.trend === (tradeMemory.side === 'long' ? 'UP' : 'DOWN'),
          volumeConfirmation: (entryIndicators.volumeRatio || 1) > 1.2,
          multiIndicatorConfluence: entrySignal.reasons.length >= 3,
        },
        isWin,
        tradeMemory.realizedROE
      );
    }

    this.autoSaveCounter++;
    if (this.autoSaveCounter >= 10) {
      await this.saveMemory();
      this.autoSaveCounter = 0;
    }
  }

  /**
   * Get pattern boost for a signal
   */
  getPatternBoost(
    indicators: TechnicalIndicators,
    confidence: number,
    symbol: string,
    llmAgreed: boolean,
    timeOfDay: number
  ) {
    if (!this.enabled) {
      return { confidenceBoost: 0, scoreBoost: 0, reason: 'Memory disabled' };
    }

    const currentRegime = this.marketRegime.detectRegime(indicators);
    return this.patternLearner.getPatternBoost(
      indicators,
      confidence,
      currentRegime,
      symbol,
      llmAgreed,
      timeOfDay
    );
  }

  /**
   * Get contextual boost for a signal
   */
  getContextualBoost(symbol: string, signalType: SignalType, confidence: number) {
    if (!this.enabled) {
      return { confidenceBoost: 0, scoreBoost: 0, reason: 'Memory disabled' };
    }

    return this.contextualMemory.getContextualBoost(symbol, signalType, confidence);
  }

  /**
   * Get adaptive filter adjustments
   */
  getAdaptiveFilters() {
    if (!this.enabled) {
      return {
        minCombinedConfidence: 55,
        minScoreForSignal: 50,
        requireTrendAlignment: false,
        requireVolumeConfirmation: false,
        requireMultiIndicatorConfluence: false,
        minIndicatorConfluence: 3,
        minVolumeSpike: 0.3,
        minTrendStrength: 0.3,
      };
    }

    return this.adaptiveFilters.getAdjustedFilters();
  }

  /**
   * Get market regime adjustments
   */
  getRegimeAdjustments(indicators: TechnicalIndicators) {
    if (!this.enabled) {
      return {
        confidenceMultiplier: 1.0,
        positionSizeMultiplier: 1.0,
        stopLossMultiplier: 1.0,
        takeProfitMultiplier: 1.0,
      };
    }

    this.marketRegime.updateRegime(indicators);
    return this.marketRegime.getRegimeAdjustments();
  }

  /**
   * Get symbol priority
   */
  getSymbolPriority(symbol: string, conditions: string[]): number {
    if (!this.enabled) {
      return 0.5;
    }

    return this.symbolIntelligence.getSymbolPriority(symbol, conditions);
  }

  /**
   * Get ranked symbols
   */
  getRankedSymbols(conditions: string[] = []): string[] {
    if (!this.enabled) {
      return [];
    }

    return this.symbolIntelligence.getRankedSymbols(conditions);
  }

  /**
   * Store market context
   */
  storeContext(
    symbol: string,
    indicators: TechnicalIndicators,
    recentSignals: Array<{ type: SignalType; confidence: number; outcome?: 'win' | 'loss' }>
  ): void {
    if (!this.enabled) {
      return;
    }

    this.contextualMemory.storeContext(symbol, indicators, recentSignals);
  }

  /**
   * Update signal outcome in context
   */
  updateSignalOutcome(symbol: string, signalType: SignalType, outcome: 'win' | 'loss'): void {
    if (!this.enabled) {
      return;
    }

    this.contextualMemory.updateSignalOutcome(symbol, signalType, outcome);
  }

  /**
   * Save memory to persistence
   */
  async saveMemory(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const trades = this.tradeHistory.getAllTrades();
      await this.persistence.saveTradeHistory(trades);
      await this.persistence.savePatterns(this.patternLearner.getMemory());
      await this.persistence.saveRegimes(this.marketRegime.getMemory());
      await this.persistence.saveSymbols(this.symbolIntelligence.getIntelligence());
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to save memory');
    }
  }

  /**
   * Get trade history statistics
   */
  getStatistics() {
    if (!this.enabled) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,
        avgROE: 0,
        totalPnL: 0,
      };
    }

    return this.tradeHistory.getStatistics();
  }
}

