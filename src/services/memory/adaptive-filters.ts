/**
 * Adaptive Signal Filtering
 * Dynamically adjusts signal filters based on recent performance
 */

import { logger } from '../../utils/logger';

export interface FilterPerformance {
  filterName: string;
  enabled: boolean;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgROE: number;
}

export interface AdaptiveFilterConfig {
  minCombinedConfidence: number;
  minScoreForSignal: number;
  requireTrendAlignment: boolean;
  requireVolumeConfirmation: boolean;
  requireMultiIndicatorConfluence: boolean;
  minIndicatorConfluence: number;
  minVolumeSpike: number;
  minTrendStrength: number;
}

export interface FilterAdjustments {
  minCombinedConfidence: number;
  minScoreForSignal: number;
  requireTrendAlignment: boolean;
  requireVolumeConfirmation: boolean;
  requireMultiIndicatorConfluence: boolean;
  minIndicatorConfluence: number;
  minVolumeSpike: number;
  minTrendStrength: number;
}

export class AdaptiveFilters {
  private filterPerformance: Map<string, FilterPerformance> = new Map();
  private recentWinRate: number = 0.5;
  private recentTrades: number = 0;
  private config: AdaptiveFilterConfig;
  private adjustmentHistory: Array<{ timestamp: number; adjustments: FilterAdjustments }> = [];

  constructor(initialConfig: AdaptiveFilterConfig) {
    this.config = { ...initialConfig };
    this.initializeFilterPerformance();
  }

  /**
   * Update filter performance based on trade outcome
   */
  recordTradeOutcome(
    filtersUsed: {
      trendAlignment: boolean;
      volumeConfirmation: boolean;
      multiIndicatorConfluence: boolean;
    },
    isWin: boolean,
    roe: number
  ): void {
    this.recentTrades++;
    const totalWins = this.recentWinRate * (this.recentTrades - 1) + (isWin ? 1 : 0);
    this.recentWinRate = totalWins / this.recentTrades;

    this.updateFilterPerformance('trendAlignment', filtersUsed.trendAlignment, isWin, roe);
    this.updateFilterPerformance('volumeConfirmation', filtersUsed.volumeConfirmation, isWin, roe);
    this.updateFilterPerformance('multiIndicatorConfluence', filtersUsed.multiIndicatorConfluence, isWin, roe);
  }

  /**
   * Get adjusted filter configuration
   */
  getAdjustedFilters(): FilterAdjustments {
    if (this.recentTrades < 10) {
      return { ...this.config };
    }

    const adjustments = this.calculateAdjustments();
    this.adjustmentHistory.push({
      timestamp: Date.now(),
      adjustments,
    });

    if (this.adjustmentHistory.length > 100) {
      this.adjustmentHistory.shift();
    }

    return adjustments;
  }

  /**
   * Get current filter configuration
   */
  getCurrentConfig(): AdaptiveFilterConfig {
    return { ...this.config };
  }

  /**
   * Update base configuration
   */
  updateBaseConfig(config: Partial<AdaptiveFilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get filter performance statistics
   */
  getFilterPerformance(): Map<string, FilterPerformance> {
    return new Map(this.filterPerformance);
  }

  /**
   * Reset filter performance
   */
  reset(): void {
    this.recentWinRate = 0.5;
    this.recentTrades = 0;
    this.filterPerformance.clear();
    this.initializeFilterPerformance();
  }

  private initializeFilterPerformance(): void {
    this.filterPerformance.set('trendAlignment', {
      filterName: 'trendAlignment',
      enabled: this.config.requireTrendAlignment,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
    });

    this.filterPerformance.set('volumeConfirmation', {
      filterName: 'volumeConfirmation',
      enabled: this.config.requireVolumeConfirmation,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
    });

    this.filterPerformance.set('multiIndicatorConfluence', {
      filterName: 'multiIndicatorConfluence',
      enabled: this.config.requireMultiIndicatorConfluence,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
    });
  }

  private updateFilterPerformance(
    filterName: string,
    wasUsed: boolean,
    isWin: boolean,
    roe: number
  ): void {
    if (!wasUsed) {
      return;
    }

    const performance = this.filterPerformance.get(filterName);
    if (!performance) {
      return;
    }

    performance.trades++;
    if (isWin) {
      performance.wins++;
    } else {
      performance.losses++;
    }
    performance.winRate = performance.trades > 0 ? performance.wins / performance.trades : 0;
    performance.avgROE = ((performance.avgROE * (performance.trades - 1)) + roe) / performance.trades;

    this.filterPerformance.set(filterName, performance);
  }

  private calculateAdjustments(): FilterAdjustments {
    const adjustments: FilterAdjustments = { ...this.config };

    if (this.recentWinRate < 0.4) {
      adjustments.minCombinedConfidence = Math.min(this.config.minCombinedConfidence + 5, 80);
      adjustments.minScoreForSignal = Math.min(this.config.minScoreForSignal + 5, 80);
      
      const trendPerf = this.filterPerformance.get('trendAlignment');
      if (trendPerf && trendPerf.trades >= 5 && trendPerf.winRate > 0.55) {
        adjustments.requireTrendAlignment = true;
      }

      const volumePerf = this.filterPerformance.get('volumeConfirmation');
      if (volumePerf && volumePerf.trades >= 5 && volumePerf.winRate > 0.55) {
        adjustments.requireVolumeConfirmation = true;
      }

      const confluencePerf = this.filterPerformance.get('multiIndicatorConfluence');
      if (confluencePerf && confluencePerf.trades >= 5 && confluencePerf.winRate > 0.55) {
        adjustments.requireMultiIndicatorConfluence = true;
        adjustments.minIndicatorConfluence = Math.min(this.config.minIndicatorConfluence + 1, 6);
      }
    } else if (this.recentWinRate > 0.6) {
      adjustments.minCombinedConfidence = Math.max(this.config.minCombinedConfidence - 3, 45);
      adjustments.minScoreForSignal = Math.max(this.config.minScoreForSignal - 3, 45);

      const trendPerf = this.filterPerformance.get('trendAlignment');
      if (trendPerf && trendPerf.trades >= 5 && trendPerf.winRate < 0.45) {
        adjustments.requireTrendAlignment = false;
      }

      const volumePerf = this.filterPerformance.get('volumeConfirmation');
      if (volumePerf && volumePerf.trades >= 5 && volumePerf.winRate < 0.45) {
        adjustments.requireVolumeConfirmation = false;
      }
    }

    adjustments.minVolumeSpike = this.config.minVolumeSpike;
    adjustments.minTrendStrength = this.config.minTrendStrength;

    logger.debug(
      {
        recentWinRate: this.recentWinRate,
        recentTrades: this.recentTrades,
        adjustments,
      },
      'Filter adjustments calculated'
    );

    return adjustments;
  }
}

