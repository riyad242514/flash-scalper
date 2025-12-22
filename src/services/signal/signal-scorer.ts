/**
 * Signal Scoring System
 * Multi-indicator confluence scoring for high-probability trades
 */

import type {
  TechnicalIndicators,
  CandlePattern,
  SignalType,
  ScalperConfig,
  Kline,
} from '../../types';
import {
  detectCandlePattern,
  detectBounce,
  calculateStochastic,
  calculateWilliamsR,
  BounceDetection,
  DivergenceDetection,
} from './technical-analysis';
import { signalLogger } from '../../utils/logger';

// =============================================================================
// SCORING WEIGHTS
// =============================================================================

const SCORE_WEIGHTS = {
  // EMA alignment (strong trend indicator)
  EMA_BULLISH_STACK: 15,
  EMA_BEARISH_STACK: 15,
  PRICE_ABOVE_EMA9: 5,
  PRICE_BELOW_EMA9: 5,

  // MACD
  MACD_BULLISH_CROSS: 20,
  MACD_BEARISH_CROSS: 20,
  MACD_HISTOGRAM_RISING: 8,
  MACD_HISTOGRAM_FALLING: 8,

  // RSI
  RSI_OVERSOLD: 12,
  RSI_OVERBOUGHT: 12,
  RSI_MODERATE_LOW: 5,
  RSI_MODERATE_HIGH: 5,

  // Bollinger Bands
  BB_LOWER: 10,
  BB_UPPER: 10,

  // Stochastic
  STOCH_OVERSOLD: 15,
  STOCH_OVERBOUGHT: 15,
  STOCH_BULLISH_DIVERGENCE: 5,
  STOCH_BEARISH_DIVERGENCE: 5,

  // ROC (Rate of Change)
  ROC_STRONG_BULLISH: 12,
  ROC_STRONG_BEARISH: 12,
  ROC_MODERATE_BULLISH: 5,
  ROC_MODERATE_BEARISH: 5,

  // Williams %R
  WILLIAMS_OVERSOLD: 12,
  WILLIAMS_OVERBOUGHT: 12,

  // Volume
  VOLUME_SPIKE_BULLISH: 8,
  VOLUME_SPIKE_BEARISH: 8,

  // Candle Patterns
  CANDLE_BULLISH: 10,
  CANDLE_BEARISH: 10,

  // Bounce Detection
  BOUNCE_BONUS: 20,
  
  // Divergence (strong signal)
  DIVERGENCE_BULLISH: 25,
  DIVERGENCE_BEARISH: 25,
  
  // Trend Alignment Bonus
  TREND_ALIGNMENT_BONUS: 15,
  
  // Multi-Indicator Confluence Bonus
  CONFLUENCE_BONUS: 10, // Per additional indicator beyond minimum
};

// =============================================================================
// SIGNAL SCORE RESULT
// =============================================================================

export interface SignalScore {
  direction: SignalType;
  longScore: number;
  shortScore: number;
  totalScore: number;
  confidence: number;
  reasons: string[];
  candlePattern?: CandlePattern;
  bounce?: BounceDetection;
}

// =============================================================================
// SCORING FUNCTIONS
// =============================================================================

/**
 * Score EMA alignment
 */
function scoreEMA(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { price, ema9, ema21, ema50 } = indicators;

  // Full bullish stack: price > ema9 > ema21 > ema50
  if (price > ema9 && ema9 > ema21 && ema21 > ema50) {
    longScore += SCORE_WEIGHTS.EMA_BULLISH_STACK;
    reasons.push('EMA bullish stack (9>21>50)');
  }
  // Full bearish stack
  else if (price < ema9 && ema9 < ema21 && ema21 < ema50) {
    shortScore += SCORE_WEIGHTS.EMA_BEARISH_STACK;
    reasons.push('EMA bearish stack (9<21<50)');
  }

  // Price vs EMA9
  if (price > ema9) {
    longScore += SCORE_WEIGHTS.PRICE_ABOVE_EMA9;
  } else {
    shortScore += SCORE_WEIGHTS.PRICE_BELOW_EMA9;
  }

  return { longScore, shortScore };
}

/**
 * Score MACD signals
 */
function scoreMACD(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { macdCrossUp, macdCrossDown, macdHistogram } = indicators;

  // MACD crossover (strong signal)
  if (macdCrossUp) {
    longScore += SCORE_WEIGHTS.MACD_BULLISH_CROSS;
    reasons.push('MACD bullish cross');
  } else if (macdCrossDown) {
    shortScore += SCORE_WEIGHTS.MACD_BEARISH_CROSS;
    reasons.push('MACD bearish cross');
  }

  // MACD histogram momentum
  // Note: We need previous histogram for this, simplified version
  if (macdHistogram > 0) {
    longScore += SCORE_WEIGHTS.MACD_HISTOGRAM_RISING;
    reasons.push('MACD histogram positive');
  } else if (macdHistogram < 0) {
    shortScore += SCORE_WEIGHTS.MACD_HISTOGRAM_FALLING;
    reasons.push('MACD histogram negative');
  }

  return { longScore, shortScore };
}

/**
 * Score RSI signals
 */
function scoreRSI(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { rsi } = indicators;

  if (rsi < 30) {
    longScore += SCORE_WEIGHTS.RSI_OVERSOLD;
    reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
  } else if (rsi > 70) {
    shortScore += SCORE_WEIGHTS.RSI_OVERBOUGHT;
    reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
  } else if (rsi < 40) {
    longScore += SCORE_WEIGHTS.RSI_MODERATE_LOW;
  } else if (rsi > 60) {
    shortScore += SCORE_WEIGHTS.RSI_MODERATE_HIGH;
  }

  return { longScore, shortScore };
}

/**
 * Score Bollinger Bands position
 */
function scoreBollingerBands(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { bbPercentB } = indicators;

  if (bbPercentB < 0.2) {
    longScore += SCORE_WEIGHTS.BB_LOWER;
    reasons.push('Price at lower BB');
  } else if (bbPercentB > 0.8) {
    shortScore += SCORE_WEIGHTS.BB_UPPER;
    reasons.push('Price at upper BB');
  }

  return { longScore, shortScore };
}

/**
 * Score Stochastic Oscillator
 */
function scoreStochastic(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { stochK, stochD } = indicators;

  // Oversold/Overbought
  if (stochK < 20) {
    longScore += SCORE_WEIGHTS.STOCH_OVERSOLD;
    reasons.push(`Stoch oversold (K=${stochK.toFixed(0)})`);
  } else if (stochK > 80) {
    shortScore += SCORE_WEIGHTS.STOCH_OVERBOUGHT;
    reasons.push(`Stoch overbought (K=${stochK.toFixed(0)})`);
  }

  // Divergence (K crossing D)
  if (stochK > stochD && stochK < 50) {
    longScore += SCORE_WEIGHTS.STOCH_BULLISH_DIVERGENCE;
    reasons.push('Stoch K>D bullish');
  } else if (stochK < stochD && stochK > 50) {
    shortScore += SCORE_WEIGHTS.STOCH_BEARISH_DIVERGENCE;
    reasons.push('Stoch K<D bearish');
  }

  return { longScore, shortScore };
}

/**
 * Score Rate of Change (ROC)
 */
function scoreROC(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { roc } = indicators;

  if (roc > 2) {
    longScore += SCORE_WEIGHTS.ROC_STRONG_BULLISH;
    reasons.push(`ROC +${roc.toFixed(1)}% bullish`);
  } else if (roc < -2) {
    shortScore += SCORE_WEIGHTS.ROC_STRONG_BEARISH;
    reasons.push(`ROC ${roc.toFixed(1)}% bearish`);
  } else if (roc > 0.5) {
    longScore += SCORE_WEIGHTS.ROC_MODERATE_BULLISH;
  } else if (roc < -0.5) {
    shortScore += SCORE_WEIGHTS.ROC_MODERATE_BEARISH;
  }

  return { longScore, shortScore };
}

/**
 * Score Williams %R
 */
function scoreWilliamsR(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { williamsR } = indicators;

  // -80 to -100 = oversold (bullish)
  // 0 to -20 = overbought (bearish)
  if (williamsR < -80) {
    longScore += SCORE_WEIGHTS.WILLIAMS_OVERSOLD;
    reasons.push(`Williams %R oversold (${williamsR.toFixed(0)})`);
  } else if (williamsR > -20) {
    shortScore += SCORE_WEIGHTS.WILLIAMS_OVERBOUGHT;
    reasons.push(`Williams %R overbought (${williamsR.toFixed(0)})`);
  }

  return { longScore, shortScore };
}

/**
 * Score volume spikes
 */
function scoreVolume(
  indicators: TechnicalIndicators,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  const { volumeRatio, momentum } = indicators;

  // Volume spike with momentum direction
  if (volumeRatio > 1.5) {
    if (momentum > 0) {
      longScore += SCORE_WEIGHTS.VOLUME_SPIKE_BULLISH;
      reasons.push(`Volume spike (${(volumeRatio * 100).toFixed(0)}%)`);
    } else {
      shortScore += SCORE_WEIGHTS.VOLUME_SPIKE_BEARISH;
      reasons.push(`Volume spike (${(volumeRatio * 100).toFixed(0)}%)`);
    }
  }

  return { longScore, shortScore };
}

/**
 * Score candlestick patterns
 */
function scoreCandlePattern(
  candlePattern: CandlePattern | null,
  longScore: number,
  shortScore: number,
  reasons: string[]
): { longScore: number; shortScore: number } {
  if (!candlePattern) return { longScore, shortScore };

  if (candlePattern.bullish) {
    longScore += SCORE_WEIGHTS.CANDLE_BULLISH;
    reasons.push(`${candlePattern.pattern} (bullish)`);
  } else {
    shortScore += SCORE_WEIGHTS.CANDLE_BEARISH;
    reasons.push(`${candlePattern.pattern} (bearish)`);
  }

  return { longScore, shortScore };
}

// =============================================================================
// MAIN SCORING FUNCTION
// =============================================================================

/**
 * Calculate complete signal score with all indicators
 */
export function calculateSignalScore(
  indicators: TechnicalIndicators,
  klines: Kline[],
  config: ScalperConfig
): SignalScore {
  let longScore = 0;
  let shortScore = 0;
  const reasons: string[] = [];

  // Core indicators only (EMA, MACD, RSI, Volume, Divergence)
  ({ longScore, shortScore } = scoreEMA(indicators, longScore, shortScore, reasons));
  ({ longScore, shortScore } = scoreMACD(indicators, longScore, shortScore, reasons));
  ({ longScore, shortScore } = scoreRSI(indicators, longScore, shortScore, reasons));
  ({ longScore, shortScore } = scoreVolume(indicators, longScore, shortScore, reasons));
  

  // Candlestick patterns
  const candlePattern = detectCandlePattern(klines);
  ({ longScore, shortScore } = scoreCandlePattern(candlePattern, longScore, shortScore, reasons));

  // Bounce detection
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);

  const stoch = { k: indicators.stochK, d: indicators.stochD };
  const bounce = detectBounce(klines, indicators.rsi, stoch, indicators.williamsR, config);

  if (bounce.isBounce) {
    longScore += bounce.strength;
    reasons.push(...bounce.reasons);
  }

  // Divergence detection (strong signal)
  if (config.divergenceDetectionEnabled && indicators.divergence?.hasDivergence) {
    const div = indicators.divergence;
    if (div.type === 'bullish') {
      longScore += SCORE_WEIGHTS.DIVERGENCE_BULLISH + (div.strength / 10);
      reasons.push(`BULLISH DIVERGENCE (${div.strength.toFixed(0)}% strength)`);
    } else if (div.type === 'bearish') {
      shortScore += SCORE_WEIGHTS.DIVERGENCE_BEARISH + (div.strength / 10);
      reasons.push(`BEARISH DIVERGENCE (${div.strength.toFixed(0)}% strength)`);
    }
  }

  // Trend alignment bonus
  if (config.requireTrendAlignment) {
    if (longScore > shortScore && indicators.trend === 'UP') {
      longScore += SCORE_WEIGHTS.TREND_ALIGNMENT_BONUS;
      reasons.push('Trend alignment: LONG in UPTREND');
    } else if (shortScore > longScore && indicators.trend === 'DOWN') {
      shortScore += SCORE_WEIGHTS.TREND_ALIGNMENT_BONUS;
      reasons.push('Trend alignment: SHORT in DOWNTREND');
    }
  }

  // Multi-indicator confluence bonus
  if (config.requireMultiIndicatorConfluence) {
    const minConfluence = config.minIndicatorConfluence || 2;
    const indicatorCount = reasons.length;
    
    if (indicatorCount >= minConfluence) {
      const extraIndicators = indicatorCount - minConfluence;
      const confluenceBonus = extraIndicators * SCORE_WEIGHTS.CONFLUENCE_BONUS;
      
      if (longScore > shortScore) {
        longScore += confluenceBonus;
        reasons.push(`Multi-confluence: ${indicatorCount} indicators (${extraIndicators} extra)`);
      } else if (shortScore > longScore) {
        shortScore += confluenceBonus;
        reasons.push(`Multi-confluence: ${indicatorCount} indicators (${extraIndicators} extra)`);
      }
    }
  }

  // Determine direction
  let direction: SignalType = 'NONE';
  const scoreDiff = Math.abs(longScore - shortScore);

  if (longScore >= config.minScoreForSignal && longScore > shortScore * 1.1) {
    direction = 'LONG';
  } else if (shortScore >= config.minScoreForSignal && shortScore > longScore * 1.1) {
    direction = 'SHORT';
  } else if (Math.max(longScore, shortScore) >= config.minScoreForSignal * 0.8) {
    direction = 'WAIT';
  }

  const totalScore = direction === 'LONG' ? longScore : shortScore;
  const maxPossibleScore = 110;
  const confidence = Math.min(100, Math.round((totalScore / maxPossibleScore) * 100));

  return {
    direction,
    longScore,
    shortScore,
    totalScore,
    confidence,
    reasons,
    candlePattern: candlePattern || undefined,
    bounce: bounce.isBounce ? bounce : undefined,
  };
}

// =============================================================================
// SIGNAL VALIDATION
// =============================================================================

export interface ValidationResult {
  isValid: boolean;
  reasons: string[];
}

/**
 * Validate signal against filters
 */
export function validateSignal(
  score: SignalScore,
  indicators: TechnicalIndicators,
  config: ScalperConfig
): ValidationResult {
  const reasons: string[] = [];
  let isValid = true;

  // Check minimum score
  if (score.totalScore < config.minScoreForSignal) {
    isValid = false;
    reasons.push(`Score too low (${score.totalScore} < ${config.minScoreForSignal})`);
  }

  // Check volume ratio
  if (indicators.volumeRatio < config.minVolumeRatio) {
    isValid = false;
    reasons.push(
      `Volume too low (${(indicators.volumeRatio * 100).toFixed(0)}% < ${config.minVolumeRatio * 100}%)`
    );
  }

  // Check momentum range (allow negative for counter-trend)
  // RELAXED: Only reject if momentum is EXACTLY 0 or too high (chasing)
  // Low momentum is fine - we have other indicators for confirmation
  const absMomentum = Math.abs(indicators.momentum);
  if (absMomentum > config.maxMomentum) {
    isValid = false;
    reasons.push(
      `Momentum too high - chasing (${indicators.momentum.toFixed(2)}% > ${config.maxMomentum}%)`
    );
  }
  // Note: minMomentum check removed - it was rejecting too many good signals
  // The signal scoring already accounts for momentum strength

  // Market regime filter (only warn if enabled, don't reject)
  if (config.marketRegimeFilter && indicators.trendStrength !== undefined) {
    const minStrength = config.minTrendStrength || 0.2;
    if (indicators.trendStrength < minStrength) {
      // Only warn, don't reject - allow trades in choppy markets if score is good
      reasons.push(`Market ranging/choppy (strength: ${(indicators.trendStrength * 100).toFixed(0)}% < ${(minStrength * 100).toFixed(0)}%) - allowing due to score`);
    }
  }

  // Volume confirmation (only warn if enabled, don't reject)
  if (config.requireVolumeConfirmation) {
    const minSpike = config.minVolumeSpike || 0.2;
    if (indicators.volumeRatio < 1 + minSpike) {
      // Only warn, don't reject - allow trades with lower volume if score is good
      reasons.push(`Volume low (${((indicators.volumeRatio - 1) * 100).toFixed(0)}% < ${(minSpike * 100).toFixed(0)}%) - allowing due to score`);
    }
  }

  // Check counter-trend trades (only reject if enabled AND score is weak)
  if (config.requireTrendAlignment) {
    if (score.direction === 'LONG' && indicators.trend === 'DOWN') {
      // Only reject if no strong signals (divergence, bounce) AND low confidence
      if (!score.bounce && !indicators.divergence?.hasDivergence && score.confidence < 60) {
        isValid = false;
        reasons.push(`Counter-trend LONG in DOWNTREND (trend alignment required)`);
      }
    }
    if (score.direction === 'SHORT' && indicators.trend === 'UP') {
      // Only reject if no strong signals AND low confidence
      if (!indicators.divergence?.hasDivergence && score.confidence < 60) {
        isValid = false;
        reasons.push(`Counter-trend SHORT in UPTREND (trend alignment required)`);
      }
    }
  }

  return { isValid, reasons };
}

/**
 * Format signal for logging
 */
export function formatSignalLog(
  symbol: string,
  score: SignalScore,
  indicators: TechnicalIndicators,
  validation: ValidationResult
): string {
  const parts = [
    `${symbol}: ${score.direction} (${score.totalScore}/100)`,
    `Mom ${indicators.momentum.toFixed(2)}%`,
    `RSI ${indicators.rsi.toFixed(0)}`,
    `Trend ${indicators.trend}`,
  ];

  if (!validation.isValid) {
    parts.push(`REJECTED: ${validation.reasons.join(', ')}`);
  }

  return parts.join(' | ');
}
