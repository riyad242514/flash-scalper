/**
 * Signal Service - Main Entry Point
 * Combines technical analysis, LLM analysis, and signal scoring
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Signal,
  SignalAnalysis,
  TechnicalIndicators,
  Kline,
  ScalperConfig,
  CoinConfig,
} from '../../types';
import {
  calculateAllIndicators,
  parseKlines,
  calculateSupportResistance,
} from './technical-analysis';
import {
  calculateSignalScore,
  validateSignal,
  formatSignalLog,
  SignalScore,
  ValidationResult,
} from './signal-scorer';
import { analyzeEntry, llmAnalyzer } from './llm-analyzer';
import { signalLogger, logSignal } from '../../utils/logger';
import { recordSignal, recordSignalRejection } from '../../utils/metrics';

// =============================================================================
// SIGNAL GENERATION
// =============================================================================

export interface GenerateSignalResult {
  signal: Signal | null;
  analysis: SignalAnalysis;
  score: SignalScore;
  validation: ValidationResult;
  rejected: boolean;
  rejectionReason?: string;
}

/**
 * Generate trading signal for a symbol
 */
export async function generateSignal(
  symbol: string,
  rawKlines: any[],
  config: ScalperConfig,
  coinConfig?: CoinConfig,
  agentId: string = 'default',
  memoryManager?: any // MemoryManager for pattern boosts and adaptive filters
): Promise<GenerateSignalResult> {
  // Parse klines
  const klines = parseKlines(rawKlines);

  // Time-of-day filter - only trade during high liquidity hours
  if (config.timeOfDayFilter === true) {
    const currentHour = new Date().getUTCHours();
    const startHour = config.timeOfDayStartHourUTC ?? 13;
    const endHour = config.timeOfDayEndHourUTC ?? 21;
    const isHighLiquidity = (currentHour >= startHour && currentHour <= endHour);
    
    if (!isHighLiquidity) {
      signalLogger.debug(
        { symbol, currentHour, isHighLiquidity, startHour, endHour },
        'Signal rejected: Low liquidity period'
      );
      return createRejectedResult(
        symbol,
        `Low liquidity period (hour: ${currentHour}, need ${startHour}-${endHour} UTC)`,
        config
      );
    }
  }

  // Calculate all technical indicators
  const indicators = calculateAllIndicators(klines, config);
  if (!indicators) {
    return createRejectedResult(symbol, 'Insufficient kline data', config);
  }

  // Get adaptive filter adjustments from memory if enabled
  let adaptiveConfig = config;
  if (memoryManager) {
    const adjustments = memoryManager.getAdaptiveFilters();
    adaptiveConfig = {
      ...config,
      minCombinedConfidence: adjustments.minCombinedConfidence,
      minScoreForSignal: adjustments.minScoreForSignal,
      requireTrendAlignment: adjustments.requireTrendAlignment,
      requireVolumeConfirmation: adjustments.requireVolumeConfirmation,
      requireMultiIndicatorConfluence: adjustments.requireMultiIndicatorConfluence,
      minIndicatorConfluence: adjustments.minIndicatorConfluence,
      minVolumeSpike: adjustments.minVolumeSpike,
      minTrendStrength: adjustments.minTrendStrength,
    };
  }

  // Calculate signal score
  const score = calculateSignalScore(indicators, klines, adaptiveConfig);

  // If no clear direction, return early
  if (score.direction === 'NONE' || score.direction === 'WAIT') {
    signalLogger.debug(
      { symbol, longScore: score.longScore, shortScore: score.shortScore, totalScore: score.totalScore, confidence: score.confidence, minScore: config.minScoreForSignal },
      `No signal direction (Long: ${score.longScore}, Short: ${score.shortScore}, need ${config.minScoreForSignal}+)`
    );
    return createRejectedResult(
      symbol,
      `No signal (Long: ${score.longScore}, Short: ${score.shortScore})`,
      config,
      indicators,
      score
    );
  }

  // Block counter-trend SHORTS in uptrend - but allow with strong signals
  const isCounterTrendShort = score.direction === 'SHORT' && indicators.trend === 'UP';
  if (isCounterTrendShort) {
    // Allow if there's strong divergence OR high confidence (70%+) OR strong bounce
    const hasStrongSignal = (indicators.divergence?.hasDivergence && indicators.divergence.type === 'bearish') ||
                            score.confidence >= 75 ||
                            (score.bounce && score.bounce.strength >= 15);
    
    if (!hasStrongSignal) {
      signalLogger.debug(
        { symbol, direction: score.direction, trend: indicators.trend, confidence: score.confidence },
        `Signal BLOCKED: Counter-trend SHORT in UPTREND (need strong signal)`
      );
      recordSignalRejection(agentId, symbol, 'counter_trend_short');
      return createRejectedResult(
        symbol,
        'Counter-trend SHORT in UPTREND blocked (need divergence/75%+ confidence)',
        config,
        indicators,
        score
      );
    }
    // Allow with warning
    score.reasons.push(`COUNTER-TREND SHORT in UPTREND (allowed due to strong signal)`);
  }

  // Block LONG when RSI is overbought
  if (score.direction === 'LONG' && indicators.rsi > config.rsiOverbought) {
    signalLogger.debug(
      { symbol, rsi: indicators.rsi, threshold: config.rsiOverbought },
      `Signal rejected: RSI overbought for LONG`
    );
    recordSignalRejection(agentId, symbol, 'rsi_overbought');
    return createRejectedResult(
      symbol,
      `RSI overbought (${indicators.rsi.toFixed(0)} > ${config.rsiOverbought}) for LONG`,
      config,
      indicators,
      score
    );
  }

  // Block SHORT in oversold unless momentum confirms or trend is down
  if (score.direction === 'SHORT' && indicators.rsi < config.rsiOversold) {
    const hasNegativeMomentum = indicators.momentum < -0.1; // Relaxed from -0.5
    const trendConfirms = indicators.trend === 'DOWN';

    if (!hasNegativeMomentum && !trendConfirms) {
      signalLogger.debug(
        { symbol, rsi: indicators.rsi, momentum: indicators.momentum, trend: indicators.trend },
        `Signal rejected: SHORT in oversold without momentum/trend confirmation`
      );
      recordSignalRejection(agentId, symbol, 'short_in_oversold');
      return createRejectedResult(
        symbol,
        `SHORT blocked in oversold (RSI ${indicators.rsi.toFixed(0)}) - need negative momentum or downtrend`,
        config,
        indicators,
        score
      );
    }
    score.reasons.push(`Momentum override: shorting oversold (RSI ${indicators.rsi.toFixed(0)}) with momentum ${indicators.momentum.toFixed(2)}%`);
  }

  // Validate signal against filters (use adaptive filters if available)
  const validation = validateSignal(score, indicators, adaptiveConfig);
  
  // Only reject if confidence is too low or critical RSI filter fails
  const criticalRejection = !validation.isValid && (
    validation.reasons.some(r => r.includes('confidence')) ||
    validation.reasons.some(r => r.includes('RSI overbought')) ||
    validation.reasons.some(r => r.includes('RSI oversold'))
  );
  
  if (criticalRejection) {
    signalLogger.debug(
      { symbol, direction: score.direction, reasons: validation.reasons },
      `Signal rejected: ${validation.reasons.join(', ')}`
    );
    recordSignalRejection(agentId, symbol, validation.reasons[0] || 'unknown');
    return {
      signal: null,
      analysis: createAnalysis(symbol, indicators, score, 0),
      score,
      validation,
      rejected: true,
      rejectionReason: validation.reasons.join(', '),
    };
  }
  
  // Log non-critical filter warnings but allow trade
  if (!validation.isValid && !criticalRejection) {
    signalLogger.debug(
      { symbol, reasons: validation.reasons },
      `Signal warning (allowing): ${validation.reasons.join(', ')}`
    );
  }

  // LLM confirmation (if enabled)
  let llmConfidence = 50;
  let llmAgreed = false;
  let combinedConfidence = score.confidence;

  if (adaptiveConfig.llmEnabled && llmAnalyzer.isEnabled()) {
    const direction = score.direction as 'LONG' | 'SHORT';
    const llmResult = await analyzeEntry(symbol, direction, indicators, score.reasons, klines);

    llmConfidence = llmResult.confidence;
    llmAgreed = llmResult.agrees;

    if (llmResult.agrees) {
      combinedConfidence = Math.min(100, score.confidence + adaptiveConfig.llmConfidenceBoost);
      score.reasons.push(`LLM agrees (${llmResult.confidence}%)`);
    } else {
      // LLM disagrees
      if (adaptiveConfig.requireLLMAgreement) {
        signalLogger.info(
          { symbol, direction: score.direction, llmConfidence },
          `Signal rejected: LLM disagrees (${llmResult.confidence}%)`
        );

        recordSignalRejection(agentId, symbol, 'llm_disagreement');

        return {
          signal: null,
          analysis: createAnalysis(symbol, indicators, score, llmConfidence),
          score,
          validation,
          rejected: true,
          rejectionReason: `LLM disagrees (${llmResult.confidence}%): ${llmResult.reason}`,
        };
      }
      score.reasons.push(`LLM disagrees (${llmResult.confidence}%)`);
    }
  }

  // Apply memory boosts if memory system is enabled
  if (memoryManager) {
    const timeOfDay = new Date().getUTCHours();
    const patternBoost = memoryManager.getPatternBoost(
      indicators,
      combinedConfidence,
      symbol,
      llmAgreed,
      timeOfDay
    );
    const contextualBoost = memoryManager.getContextualBoost(
      symbol,
      score.direction,
      combinedConfidence
    );
    const regimeAdjustments = memoryManager.getRegimeAdjustments(indicators);

    // AGENTIC: Block signals that match losing patterns (loss prevention)
    if (patternBoost.confidenceBoost < -5) {
      signalLogger.debug(
        { symbol, patternBoost: patternBoost.reason, confidenceBoost: patternBoost.confidenceBoost },
        'Signal blocked: Matches losing pattern from memory'
      );
      recordSignalRejection(agentId, symbol, 'losing_pattern');
      return {
        signal: null,
        analysis: createAnalysis(symbol, indicators, score, llmConfidence),
        score,
        validation,
        rejected: true,
        rejectionReason: `Blocked: Matches losing pattern (${patternBoost.reason})`,
      };
    }

    // Apply boosts
    combinedConfidence += patternBoost.confidenceBoost + contextualBoost.confidenceBoost;
    combinedConfidence *= regimeAdjustments.confidenceMultiplier;
    score.totalScore += patternBoost.scoreBoost + contextualBoost.scoreBoost;

    if (patternBoost.confidenceBoost !== 0 || contextualBoost.confidenceBoost !== 0) {
      score.reasons.push(`Memory boost: ${patternBoost.reason}; ${contextualBoost.reason}`);
    }
  }

  // Check minimum combined confidence (use adaptive filters if available)
  const minConfidence = adaptiveConfig.llmEnabled
    ? adaptiveConfig.minCombinedConfidence
    : adaptiveConfig.minConfidenceWithoutLLM;

  if (combinedConfidence < minConfidence) {
    signalLogger.debug(
      { symbol, combinedConfidence, minConfidence },
      `Signal rejected: Low confidence`
    );

    recordSignalRejection(agentId, symbol, 'low_confidence');

    return {
      signal: null,
      analysis: createAnalysis(symbol, indicators, score, llmConfidence),
      score,
      validation,
      rejected: true,
      rejectionReason: `Confidence too low (${combinedConfidence}% < ${minConfidence}%)`,
    };
  }

  // Apply coin boost if configured
  let finalConfidence = combinedConfidence;
  if (coinConfig && coinConfig.boost !== 1.0) {
    finalConfidence = Math.min(100, Math.round(combinedConfidence * coinConfig.boost));
  }

  // PHASE 2: Calculate support/resistance for optimal entry
  const srLevels = calculateSupportResistance(klines, 20);

  // Create signal with support/resistance levels
  const signal: Signal = {
    id: uuidv4(),
    symbol,
    type: score.direction,
    confidence: finalConfidence,
    source: 'combined',
    reasons: score.reasons,
    indicators: {
      price: indicators.price,
      rsi: indicators.rsi,
      momentum: indicators.momentum,
      volumeRatio: indicators.volumeRatio,
      trend: indicators.trend,
      stochK: indicators.stochK,
      macdHistogram: indicators.macdHistogram,
    },
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000, // 1 minute expiry
    // PHASE 2: Add support/resistance for limit order placement
    supportResistance: srLevels,
  };

  // Log and record metrics
  logSignal(agentId, {
    symbol,
    direction: score.direction,
    confidence: finalConfidence,
    score: score.totalScore,
    reasons: score.reasons,
  });

  recordSignal(agentId, symbol, score.direction, 'combined', finalConfidence);

  return {
    signal,
    analysis: createAnalysis(symbol, indicators, score, llmConfidence),
    score,
    validation,
    rejected: false,
  };
}

// =============================================================================
// BATCH SIGNAL SCANNING
// =============================================================================

export interface ScanResult {
  symbol: string;
  result: GenerateSignalResult;
}

/**
 * Scan multiple symbols for signals
 */
export async function scanForSignals(
  symbolsWithKlines: Map<string, any[]>,
  config: ScalperConfig,
  coinConfigs: Map<string, CoinConfig>,
  agentId: string = 'default',
  delayMs: number = 200
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (const [symbol, klines] of symbolsWithKlines) {
    const coinConfig = coinConfigs.get(symbol);
    const result = await generateSignal(symbol, klines, config, coinConfig, agentId);
    results.push({ symbol, result });

    // Rate limiting delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Get qualifying signals from scan results, ranked by confidence
 */
export function getQualifyingSignals(scanResults: ScanResult[]): Signal[] {
  return scanResults
    .filter((r) => r.result.signal !== null)
    .map((r) => r.result.signal as Signal)
    .sort((a, b) => b.confidence - a.confidence); // Sort by confidence descending
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function createRejectedResult(
  symbol: string,
  reason: string,
  config: ScalperConfig,
  indicators?: TechnicalIndicators,
  score?: SignalScore
): GenerateSignalResult {
  const defaultScore: SignalScore = score || {
    direction: 'NONE',
    longScore: 0,
    shortScore: 0,
    totalScore: 0,
    confidence: 0,
    reasons: [],
  };

  const defaultIndicators: TechnicalIndicators = indicators || {
    price: 0,
    rsi: 50,
    momentum: 0,
    volumeRatio: 1,
    trend: 'SIDEWAYS',
    ema9: 0,
    ema21: 0,
    ema50: 0,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    macdCrossUp: false,
    macdCrossDown: false,
    bbUpper: 0,
    bbMiddle: 0,
    bbLower: 0,
    bbPercentB: 0.5,
    stochK: 50,
    stochD: 50,
    roc: 0,
    williamsR: -50,
    atr: 0,
    atrPercent: 0,
  };

  return {
    signal: null,
    analysis: createAnalysis(symbol, defaultIndicators, defaultScore, 0),
    score: defaultScore,
    validation: { isValid: false, reasons: [reason] },
    rejected: true,
    rejectionReason: reason,
  };
}

function createAnalysis(
  symbol: string,
  indicators: TechnicalIndicators,
  score: SignalScore,
  llmConfidence: number
): SignalAnalysis {
  return {
    symbol,
    direction: score.direction,
    ivishxConfidence: 0, // IVISHX integration not implemented (field kept for compatibility)
    llmConfidence,
    combinedConfidence: score.confidence,
    technicalScore: score.totalScore,
    rsi: indicators.rsi,
    momentum: indicators.momentum,
    volumeRatio: indicators.volumeRatio,
    trend: indicators.trend,
    price: indicators.price,
    reasons: score.reasons,
    candlePattern: score.candlePattern,
    bounceDetected: !!score.bounce,
    bounceStrength: score.bounce?.strength || 0,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export * from './technical-analysis';
export * from './signal-scorer';
export * from './llm-analyzer';
