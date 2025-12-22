/**
 * Pattern Learning Engine
 * Learns which signal patterns lead to wins vs losses
 */

import type { TradeMemory } from './trade-history';
import type { TechnicalIndicators, SignalType } from '../../types';
import { logger } from '../../utils/logger';

export interface PatternStats {
  wins: number;
  losses: number;
  winRate: number;
  avgROE: number;
  totalTrades: number;
}

export interface IndicatorPattern {
  pattern: string;
  stats: PatternStats;
}

export interface PatternMemory {
  indicatorCombos: Map<string, PatternStats>;
  confidenceBuckets: Map<number, PatternStats>;
  marketRegimePerformance: Map<string, PatternStats>;
  hourlyWinRates: Map<number, PatternStats>;
  symbolPerformance: Map<string, PatternStats>;
  llmAgreementPerformance: Map<boolean, PatternStats>;
}

export interface PatternBoost {
  confidenceBoost: number;
  scoreBoost: number;
  reason: string;
}

export class PatternLearner {
  private memory: PatternMemory;
  private minTradesForPattern: number;

  constructor(minTradesForPattern: number = 3) {
    this.minTradesForPattern = minTradesForPattern;
    this.memory = {
      indicatorCombos: new Map(),
      confidenceBuckets: new Map(),
      marketRegimePerformance: new Map(),
      hourlyWinRates: new Map(),
      symbolPerformance: new Map(),
      llmAgreementPerformance: new Map(),
    };
  }

  /**
   * Learn from a completed trade
   */
  learnFromTrade(trade: TradeMemory): void {
    const isWin = trade.outcome === 'win';
    const isLoss = trade.outcome === 'loss';

    if (!isWin && !isLoss) {
      return;
    }

    this.updateIndicatorPatterns(trade, isWin);
    this.updateConfidencePatterns(trade, isWin);
    this.updateMarketRegimePatterns(trade, isWin);
    this.updateTimePatterns(trade, isWin);
    this.updateSymbolPatterns(trade, isWin);
    this.updateLLMAgreementPatterns(trade, isWin);
  }

  /**
   * Get pattern-based boost for a signal
   */
  getPatternBoost(
    indicators: TechnicalIndicators,
    confidence: number,
    marketRegime: string,
    symbol: string,
    llmAgreed: boolean,
    timeOfDay: number
  ): PatternBoost {
    let confidenceBoost = 0;
    let scoreBoost = 0;
    const reasons: string[] = [];

    const indicatorPattern = this.getIndicatorPattern(indicators);
    if (indicatorPattern && indicatorPattern.stats.totalTrades >= this.minTradesForPattern) {
      const boost = this.calculateBoost(indicatorPattern.stats);
      confidenceBoost += boost.confidence;
      scoreBoost += boost.score;
      if (boost.confidence > 0) {
        reasons.push(`Pattern: ${indicatorPattern.pattern} (${(indicatorPattern.stats.winRate * 100).toFixed(1)}% win rate)`);
      }
    }

    const confidenceBucket = this.getConfidenceBucket(confidence);
    if (confidenceBucket && confidenceBucket.totalTrades >= this.minTradesForPattern) {
      const boost = this.calculateBoost(confidenceBucket);
      confidenceBoost += boost.confidence * 0.5;
      scoreBoost += boost.score * 0.5;
    }

    const regimeStats = this.memory.marketRegimePerformance.get(marketRegime);
    if (regimeStats && regimeStats.totalTrades >= this.minTradesForPattern) {
      const boost = this.calculateBoost(regimeStats);
      confidenceBoost += boost.confidence * 0.3;
      scoreBoost += boost.score * 0.3;
    }

    const hourStats = this.memory.hourlyWinRates.get(timeOfDay);
    if (hourStats && hourStats.totalTrades >= this.minTradesForPattern) {
      const boost = this.calculateBoost(hourStats);
      confidenceBoost += boost.confidence * 0.2;
      scoreBoost += boost.score * 0.2;
    }

    const symbolStats = this.memory.symbolPerformance.get(symbol);
    if (symbolStats && symbolStats.totalTrades >= this.minTradesForPattern) {
      const boost = this.calculateBoost(symbolStats);
      confidenceBoost += boost.confidence * 0.4;
      scoreBoost += boost.score * 0.4;
    }

    const llmStats = this.memory.llmAgreementPerformance.get(llmAgreed);
    if (llmStats && llmStats.totalTrades >= this.minTradesForPattern) {
      const boost = this.calculateBoost(llmStats);
      confidenceBoost += boost.confidence * 0.3;
      scoreBoost += boost.score * 0.3;
    }

    return {
      confidenceBoost: Math.min(Math.max(confidenceBoost, -10), 10),
      scoreBoost: Math.min(Math.max(scoreBoost, -15), 15),
      reason: reasons.join('; ') || 'No pattern match',
    };
  }

  /**
   * Get pattern memory for persistence
   */
  getMemory(): PatternMemory {
    return this.memory;
  }

  /**
   * Load pattern memory from persistence
   */
  loadMemory(memory: PatternMemory): void {
    this.memory = {
      indicatorCombos: new Map(memory.indicatorCombos),
      confidenceBuckets: new Map(memory.confidenceBuckets),
      marketRegimePerformance: new Map(memory.marketRegimePerformance),
      hourlyWinRates: new Map(memory.hourlyWinRates),
      symbolPerformance: new Map(memory.symbolPerformance),
      llmAgreementPerformance: new Map(memory.llmAgreementPerformance),
    };
  }

  /**
   * Prune low-utility patterns
   */
  prunePatterns(minTrades: number = 5, minWinRateDiff: number = 0.1): void {
    this.pruneMap(this.memory.indicatorCombos, minTrades, minWinRateDiff);
    this.pruneMap(this.memory.confidenceBuckets, minTrades, minWinRateDiff);
    this.pruneMap(this.memory.marketRegimePerformance, minTrades, minWinRateDiff);
    this.pruneMap(this.memory.hourlyWinRates, minTrades, minWinRateDiff);
    this.pruneMap(this.memory.symbolPerformance, minTrades, minWinRateDiff);
    this.pruneMap(this.memory.llmAgreementPerformance, minTrades, minWinRateDiff);
  }

  private updateIndicatorPatterns(trade: TradeMemory, isWin: boolean): void {
    const patterns = this.extractIndicatorPatterns(trade.entryIndicators);
    
    for (const pattern of patterns) {
      const stats = this.memory.indicatorCombos.get(pattern) || {
        wins: 0,
        losses: 0,
        winRate: 0,
        avgROE: 0,
        totalTrades: 0,
      };

      if (isWin) {
        stats.wins++;
      } else {
        stats.losses++;
      }
      stats.totalTrades = stats.wins + stats.losses;
      stats.winRate = stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0;
      stats.avgROE = ((stats.avgROE * (stats.totalTrades - 1)) + trade.realizedROE) / stats.totalTrades;

      this.memory.indicatorCombos.set(pattern, stats);
    }
  }

  private updateConfidencePatterns(trade: TradeMemory, isWin: boolean): void {
    const bucket = Math.floor(trade.entrySignal.confidence / 5) * 5;
    const stats = this.memory.confidenceBuckets.get(bucket) || {
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
      totalTrades: 0,
    };

    if (isWin) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.totalTrades = stats.wins + stats.losses;
    stats.winRate = stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0;
    stats.avgROE = ((stats.avgROE * (stats.totalTrades - 1)) + trade.realizedROE) / stats.totalTrades;

    this.memory.confidenceBuckets.set(bucket, stats);
  }

  private updateMarketRegimePatterns(trade: TradeMemory, isWin: boolean): void {
    const regime = trade.entryMarketConditions.trend;
    const stats = this.memory.marketRegimePerformance.get(regime) || {
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
      totalTrades: 0,
    };

    if (isWin) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.totalTrades = stats.wins + stats.losses;
    stats.winRate = stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0;
    stats.avgROE = ((stats.avgROE * (stats.totalTrades - 1)) + trade.realizedROE) / stats.totalTrades;

    this.memory.marketRegimePerformance.set(regime, stats);
  }

  private updateTimePatterns(trade: TradeMemory, isWin: boolean): void {
    const hour = trade.entryMarketConditions.timeOfDay;
    const stats = this.memory.hourlyWinRates.get(hour) || {
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
      totalTrades: 0,
    };

    if (isWin) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.totalTrades = stats.wins + stats.losses;
    stats.winRate = stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0;
    stats.avgROE = ((stats.avgROE * (stats.totalTrades - 1)) + trade.realizedROE) / stats.totalTrades;

    this.memory.hourlyWinRates.set(hour, stats);
  }

  private updateSymbolPatterns(trade: TradeMemory, isWin: boolean): void {
    const stats = this.memory.symbolPerformance.get(trade.symbol) || {
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
      totalTrades: 0,
    };

    if (isWin) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.totalTrades = stats.wins + stats.losses;
    stats.winRate = stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0;
    stats.avgROE = ((stats.avgROE * (stats.totalTrades - 1)) + trade.realizedROE) / stats.totalTrades;

    this.memory.symbolPerformance.set(trade.symbol, stats);
  }

  private updateLLMAgreementPatterns(trade: TradeMemory, isWin: boolean): void {
    const stats = this.memory.llmAgreementPerformance.get(trade.entrySignal.llmAgreed) || {
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
      totalTrades: 0,
    };

    if (isWin) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.totalTrades = stats.wins + stats.losses;
    stats.winRate = stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0;
    stats.avgROE = ((stats.avgROE * (stats.totalTrades - 1)) + trade.realizedROE) / stats.totalTrades;

    this.memory.llmAgreementPerformance.set(trade.entrySignal.llmAgreed, stats);
  }

  private extractIndicatorPatterns(indicators: TechnicalIndicators): string[] {
    const patterns: string[] = [];

    if (indicators.rsi < 35) patterns.push('RSI_OVERSOLD');
    if (indicators.rsi > 65) patterns.push('RSI_OVERBOUGHT');
    if (indicators.momentum > 0.5) patterns.push('HIGH_MOMENTUM');
    if (indicators.momentum < -0.5) patterns.push('NEGATIVE_MOMENTUM');
    if (indicators.volumeRatio > 1.5) patterns.push('HIGH_VOLUME');
    if (indicators.volumeRatio < 0.5) patterns.push('LOW_VOLUME');
    if (indicators.trend === 'UP') patterns.push('UPTREND');
    if (indicators.trend === 'DOWN') patterns.push('DOWNTREND');
    if (indicators.macdCrossUp) patterns.push('MACD_CROSS_UP');
    if (indicators.macdCrossDown) patterns.push('MACD_CROSS_DOWN');
    if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
      patterns.push('EMA_BULLISH_STACK');
    }
    if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
      patterns.push('EMA_BEARISH_STACK');
    }

    return patterns;
  }

  private getIndicatorPattern(indicators: TechnicalIndicators): IndicatorPattern | null {
    const patterns = this.extractIndicatorPatterns(indicators);
    if (patterns.length === 0) {
      return null;
    }

    const patternKey = patterns.sort().join('_');
    const stats = this.memory.indicatorCombos.get(patternKey);
    
    if (!stats) {
      return null;
    }

    return {
      pattern: patternKey,
      stats,
    };
  }

  private getConfidenceBucket(confidence: number): PatternStats | null {
    const bucket = Math.floor(confidence / 5) * 5;
    return this.memory.confidenceBuckets.get(bucket) || null;
  }

  private calculateBoost(stats: PatternStats): { confidence: number; score: number } {
    if (stats.totalTrades < this.minTradesForPattern) {
      return { confidence: 0, score: 0 };
    }

    const winRateDiff = stats.winRate - 0.5;
    const roeMultiplier = stats.avgROE > 0 ? Math.min(stats.avgROE / 5, 1) : 0;

    const confidence = winRateDiff * 20 * roeMultiplier;
    const score = winRateDiff * 30 * roeMultiplier;

    return { confidence, score };
  }

  private pruneMap(
    map: Map<string | number | boolean, PatternStats>,
    minTrades: number,
    minWinRateDiff: number
  ): void {
    const keysToDelete: (string | number | boolean)[] = [];

    for (const [key, stats] of map.entries()) {
      if (stats.totalTrades < minTrades) {
        keysToDelete.push(key);
        continue;
      }

      const winRateDiff = Math.abs(stats.winRate - 0.5);
      if (winRateDiff < minWinRateDiff && stats.totalTrades < minTrades * 2) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      map.delete(key);
    }
  }
}

