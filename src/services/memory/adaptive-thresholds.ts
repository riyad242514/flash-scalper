/**
 * Adaptive Threshold System
 * Dynamically adjusts signal thresholds based on recent win rate performance
 * Goal: Maximize wins over losses by tightening when losing, loosening when winning
 */

import { logger } from '../../utils/logger';
import { ScalperConfig } from '../../types';

export interface ThresholdAdjustments {
  minCombinedConfidence: number;
  minConfidenceWithoutLLM: number;
  minScoreForSignal: number;
  minVolumeRatio: number;
  directionThreshold: number;
  adjustmentReason: string;
}

export interface AdaptiveThresholdConfig {
  enabled: boolean;
  minTradesForAdjustment: number; // Minimum trades before adjusting
  recentTradesWindow: number; // Number of recent trades to consider
  smoothingFactor: number; // Moving average smoothing (0-1)
  maxAdjustmentPercent: number; // Maximum ± adjustment (e.g., 0.20 = ±20%)
  
  // Win rate thresholds
  highWinRateThreshold: number; // 0.60 = 60%+
  lowWinRateThreshold: number; // 0.45 = <45%
  targetWinRateMin: number; // 0.50 = 50%
  targetWinRateMax: number; // 0.60 = 60%
  
  // Adjustment multipliers
  highWinRateConfidenceMultiplier: number; // 0.95 = 5% lower confidence
  highWinRateScoreMultiplier: number; // 0.90 = 10% lower score
  lowWinRateConfidenceMultiplier: number; // 1.10 = 10% higher confidence
  lowWinRateScoreMultiplier: number; // 1.15 = 15% higher score
}

export class AdaptiveThresholds {
  private config: AdaptiveThresholdConfig;
  private recentWinRates: number[] = [];
  private recentTrades: number = 0;
  private recentWins: number = 0;
  private smoothedWinRate: number = 0.5; // Start at 50%

  constructor(config?: Partial<AdaptiveThresholdConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      minTradesForAdjustment: config?.minTradesForAdjustment ?? 10,
      recentTradesWindow: config?.recentTradesWindow ?? 20,
      smoothingFactor: config?.smoothingFactor ?? 0.3, // 30% weight for new value
      maxAdjustmentPercent: config?.maxAdjustmentPercent ?? 0.20, // ±20% max
      
      highWinRateThreshold: config?.highWinRateThreshold ?? 0.60,
      lowWinRateThreshold: config?.lowWinRateThreshold ?? 0.45,
      targetWinRateMin: config?.targetWinRateMin ?? 0.50,
      targetWinRateMax: config?.targetWinRateMax ?? 0.60,
      
      highWinRateConfidenceMultiplier: config?.highWinRateConfidenceMultiplier ?? 0.95,
      highWinRateScoreMultiplier: config?.highWinRateScoreMultiplier ?? 0.90,
      lowWinRateConfidenceMultiplier: config?.lowWinRateConfidenceMultiplier ?? 1.10,
      lowWinRateScoreMultiplier: config?.lowWinRateScoreMultiplier ?? 1.15,
    };
  }

  /**
   * Record a trade outcome
   */
  recordTradeOutcome(isWin: boolean): void {
    if (!this.config.enabled) {
      return;
    }

    this.recentTrades++;
    if (isWin) {
      this.recentWins++;
    }

    // Calculate current win rate
    const currentWinRate = this.recentTrades > 0 
      ? this.recentWins / this.recentTrades 
      : 0.5;

    // Update smoothed win rate (exponential moving average)
    this.smoothedWinRate = (this.config.smoothingFactor * currentWinRate) + 
                          ((1 - this.config.smoothingFactor) * this.smoothedWinRate);

    // Keep window of recent win rates
    this.recentWinRates.push(currentWinRate);
    if (this.recentWinRates.length > this.config.recentTradesWindow) {
      this.recentWinRates.shift();
    }

    // Reset if we've exceeded the window
    if (this.recentTrades > this.config.recentTradesWindow) {
      // Keep only recent window
      const recentWinsInWindow = this.recentWinRates
        .slice(-this.config.recentTradesWindow)
        .reduce((sum, wr) => sum + wr, 0) * this.config.recentTradesWindow;
      this.recentWins = Math.round(recentWinsInWindow);
      this.recentTrades = this.config.recentTradesWindow;
    }
  }

  /**
   * Get adjusted thresholds based on recent performance
   */
  getAdjustedThresholds(baseConfig: ScalperConfig): ThresholdAdjustments {
    if (!this.config.enabled) {
      return {
        minCombinedConfidence: baseConfig.minCombinedConfidence,
        minConfidenceWithoutLLM: baseConfig.minConfidenceWithoutLLM,
        minScoreForSignal: baseConfig.minScoreForSignal,
        minVolumeRatio: baseConfig.minVolumeRatio,
        directionThreshold: 1.10, // Use current direction threshold
        adjustmentReason: 'Adaptive thresholds disabled',
      };
    }

    // Need minimum trades before adjusting
    if (this.recentTrades < this.config.minTradesForAdjustment) {
      return {
        minCombinedConfidence: baseConfig.minCombinedConfidence,
        minConfidenceWithoutLLM: baseConfig.minConfidenceWithoutLLM,
        minScoreForSignal: baseConfig.minScoreForSignal,
        minVolumeRatio: baseConfig.minVolumeRatio,
        directionThreshold: 1.10,
        adjustmentReason: `Insufficient trades (${this.recentTrades}/${this.config.minTradesForAdjustment})`,
      };
    }

    const winRate = this.smoothedWinRate;
    let adjustmentReason = '';
    let confidenceMultiplier = 1.0;
    let scoreMultiplier = 1.0;
    let volumeMultiplier = 1.0;
    let directionThreshold = 1.10; // Base direction threshold

    // Determine adjustment based on win rate
    if (winRate >= this.config.highWinRateThreshold) {
      // High win rate - can be slightly more aggressive
      confidenceMultiplier = this.config.highWinRateConfidenceMultiplier;
      scoreMultiplier = this.config.highWinRateScoreMultiplier;
      volumeMultiplier = 0.9; // Slightly lower volume requirement
      directionThreshold = 1.08; // Slightly lower direction threshold
      adjustmentReason = `High win rate (${(winRate * 100).toFixed(1)}%) - being more aggressive`;
    } else if (winRate < this.config.lowWinRateThreshold) {
      // Low win rate - be more selective
      confidenceMultiplier = this.config.lowWinRateConfidenceMultiplier;
      scoreMultiplier = this.config.lowWinRateScoreMultiplier;
      volumeMultiplier = 1.1; // Higher volume requirement
      directionThreshold = 1.12; // Higher direction threshold
      adjustmentReason = `Low win rate (${(winRate * 100).toFixed(1)}%) - being more selective`;
    } else {
      // Target range - use base thresholds
      adjustmentReason = `Target win rate (${(winRate * 100).toFixed(1)}%) - using base thresholds`;
    }

    // Apply bounds to prevent extreme adjustments
    const maxAdjustment = 1 + this.config.maxAdjustmentPercent;
    const minAdjustment = 1 - this.config.maxAdjustmentPercent;
    
    confidenceMultiplier = Math.max(minAdjustment, Math.min(maxAdjustment, confidenceMultiplier));
    scoreMultiplier = Math.max(minAdjustment, Math.min(maxAdjustment, scoreMultiplier));
    volumeMultiplier = Math.max(minAdjustment, Math.min(maxAdjustment, volumeMultiplier));

    // Calculate adjusted thresholds
    const adjustedConfidence = Math.round(baseConfig.minCombinedConfidence * confidenceMultiplier);
    const adjustedConfidenceWithoutLLM = Math.round(baseConfig.minConfidenceWithoutLLM * confidenceMultiplier);
    const adjustedScore = Math.round(baseConfig.minScoreForSignal * scoreMultiplier);
    const adjustedVolume = Math.max(0.1, Math.min(1.0, baseConfig.minVolumeRatio * volumeMultiplier));

    return {
      minCombinedConfidence: adjustedConfidence,
      minConfidenceWithoutLLM: adjustedConfidenceWithoutLLM,
      minScoreForSignal: adjustedScore,
      minVolumeRatio: adjustedVolume,
      directionThreshold,
      adjustmentReason,
    };
  }

  /**
   * Get current win rate statistics
   */
  getStats(): {
    recentTrades: number;
    recentWins: number;
    winRate: number;
    smoothedWinRate: number;
    canAdjust: boolean;
  } {
    return {
      recentTrades: this.recentTrades,
      recentWins: this.recentWins,
      winRate: this.recentTrades > 0 ? this.recentWins / this.recentTrades : 0,
      smoothedWinRate: this.smoothedWinRate,
      canAdjust: this.recentTrades >= this.config.minTradesForAdjustment,
    };
  }

  /**
   * Reset statistics (e.g., on daily reset)
   */
  reset(): void {
    this.recentWinRates = [];
    this.recentTrades = 0;
    this.recentWins = 0;
    this.smoothedWinRate = 0.5;
  }
}

