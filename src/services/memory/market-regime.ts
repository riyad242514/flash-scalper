/**
 * Market Regime Memory
 * Tracks and adapts to different market conditions
 */

import type { TechnicalIndicators, TrendDirection } from '../../types';
import { logger } from '../../utils/logger';

export type MarketRegime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'BREAKOUT';

export interface RegimeHistory {
  regime: MarketRegime;
  startTime: number;
  endTime?: number;
  duration: number;
}

export interface RegimePerformance {
  trades: number;
  winRate: number;
  avgROE: number;
  bestStrategy: string;
}

export interface RegimeMemory {
  currentRegime: MarketRegime;
  regimeHistory: RegimeHistory[];
  regimePerformance: Map<MarketRegime, RegimePerformance>;
  lastTransitionTime: number;
}

export class MarketRegimeMemory {
  private memory: RegimeMemory;
  private minDurationForRegime: number;

  constructor(minDurationForRegime: number = 300000) {
    this.minDurationForRegime = minDurationForRegime;
    this.memory = {
      currentRegime: 'RANGING',
      regimeHistory: [],
      regimePerformance: new Map(),
      lastTransitionTime: Date.now(),
    };
  }

  /**
   * Detect current market regime from indicators
   */
  detectRegime(indicators: TechnicalIndicators): MarketRegime {
    const trend = indicators.trend;
    const momentum = indicators.momentum || 0;
    const volatility = indicators.atrPercent || 0;
    const volumeRatio = indicators.volumeRatio || 1;

    const strongTrend = Math.abs(momentum) > 0.5;
    const highVolatility = volatility > 2;
    const highVolume = volumeRatio > 1.5;

    if (trend === 'UP' && strongTrend && momentum > 0) {
      return 'TRENDING_UP';
    }

    if (trend === 'DOWN' && strongTrend && momentum < 0) {
      return 'TRENDING_DOWN';
    }

    if (highVolatility && !strongTrend) {
      return 'VOLATILE';
    }

    if (highVolume && strongTrend) {
      return 'BREAKOUT';
    }

    return 'RANGING';
  }

  /**
   * Update regime based on current indicators
   */
  updateRegime(indicators: TechnicalIndicators): MarketRegime {
    const newRegime = this.detectRegime(indicators);
    const now = Date.now();

    if (newRegime !== this.memory.currentRegime) {
      const timeSinceLastTransition = now - this.memory.lastTransitionTime;

      if (timeSinceLastTransition >= this.minDurationForRegime) {
        this.transitionToRegime(newRegime, now);
      }
    }

    return this.memory.currentRegime;
  }

  /**
   * Record trade outcome for current regime
   */
  recordTradeOutcome(isWin: boolean, roe: number): void {
    const regime = this.memory.currentRegime;
    const performance = this.memory.regimePerformance.get(regime) || {
      trades: 0,
      winRate: 0,
      avgROE: 0,
      bestStrategy: 'default',
    };

    performance.trades++;
    const totalWins = performance.winRate * (performance.trades - 1) + (isWin ? 1 : 0);
    performance.winRate = totalWins / performance.trades;
    performance.avgROE = ((performance.avgROE * (performance.trades - 1)) + roe) / performance.trades;

    this.memory.regimePerformance.set(regime, performance);
  }

  /**
   * Get recommended strategy for current regime
   */
  getRecommendedStrategy(): string {
    const performance = this.memory.regimePerformance.get(this.memory.currentRegime);
    
    if (!performance || performance.trades < 5) {
      return this.getDefaultStrategy(this.memory.currentRegime);
    }

    return performance.bestStrategy;
  }

  /**
   * Get regime-specific adjustments
   */
  getRegimeAdjustments(): {
    confidenceMultiplier: number;
    positionSizeMultiplier: number;
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
  } {
    const performance = this.memory.regimePerformance.get(this.memory.currentRegime);
    const winRate = performance?.winRate || 0.5;

    const confidenceMultiplier = winRate > 0.6 ? 1.1 : winRate < 0.4 ? 0.9 : 1.0;
    
    let positionSizeMultiplier = 1.0;
    let stopLossMultiplier = 1.0;
    let takeProfitMultiplier = 1.0;

    switch (this.memory.currentRegime) {
      case 'TRENDING_UP':
      case 'TRENDING_DOWN':
        positionSizeMultiplier = 1.1;
        takeProfitMultiplier = 1.2;
        break;
      case 'VOLATILE':
        positionSizeMultiplier = 0.8;
        stopLossMultiplier = 1.2;
        break;
      case 'BREAKOUT':
        positionSizeMultiplier = 1.2;
        takeProfitMultiplier = 1.3;
        break;
      case 'RANGING':
        positionSizeMultiplier = 0.9;
        takeProfitMultiplier = 0.8;
        break;
    }

    return {
      confidenceMultiplier,
      positionSizeMultiplier,
      stopLossMultiplier,
      takeProfitMultiplier,
    };
  }

  /**
   * Get regime memory for persistence
   */
  getMemory(): RegimeMemory {
    return this.memory;
  }

  /**
   * Load regime memory from persistence
   */
  loadMemory(memory: RegimeMemory): void {
    this.memory = {
      currentRegime: memory.currentRegime,
      regimeHistory: memory.regimeHistory || [],
      regimePerformance: new Map(memory.regimePerformance),
      lastTransitionTime: memory.lastTransitionTime || Date.now(),
    };
  }

  private transitionToRegime(newRegime: MarketRegime, timestamp: number): void {
    const currentHistory = this.memory.regimeHistory[this.memory.regimeHistory.length - 1];
    
    if (currentHistory && !currentHistory.endTime) {
      currentHistory.endTime = timestamp;
      currentHistory.duration = timestamp - currentHistory.startTime;
    }

    this.memory.regimeHistory.push({
      regime: newRegime,
      startTime: timestamp,
      duration: 0,
    });

    this.memory.currentRegime = newRegime;
    this.memory.lastTransitionTime = timestamp;

    logger.debug(
      { 
        oldRegime: currentHistory?.regime, 
        newRegime, 
        duration: currentHistory?.duration 
      },
      'Market regime transition'
    );
  }

  private getDefaultStrategy(regime: MarketRegime): string {
    switch (regime) {
      case 'TRENDING_UP':
        return 'trend-following';
      case 'TRENDING_DOWN':
        return 'trend-following';
      case 'RANGING':
        return 'mean-reversion';
      case 'VOLATILE':
        return 'scalping';
      case 'BREAKOUT':
        return 'momentum';
      default:
        return 'default';
    }
  }
}

