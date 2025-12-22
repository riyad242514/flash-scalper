/**
 * Technical Analysis Service
 * All indicator calculations extracted and optimized
 */

import type {
  Kline,
  TechnicalIndicators,
  TrendDirection,
  CandlePattern,
  ScalperConfig,
} from '../../types';

// =============================================================================
// MOVING AVERAGES
// =============================================================================

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] || 0;
  const slice = values.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];

  const multiplier = 2 / (period + 1);
  const ema: number[] = [values[0]];

  for (let i = 1; i < values.length; i++) {
    ema[i] = (values[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

/**
 * Get current EMA value
 */
export function getCurrentEMA(values: number[], period: number): number {
  const emaArray = calculateEMA(values, period);
  return emaArray[emaArray.length - 1] || 0;
}

// =============================================================================
// RSI (Relative Strength Index)
// =============================================================================

/**
 * Calculate RSI
 * @param closes - Array of closing prices
 * @param period - RSI period (default 14)
 */
export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  const recentChanges = changes.slice(-period);
  let avgGain = 0;
  let avgLoss = 0;

  for (const change of recentChanges) {
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// =============================================================================
// MACD (Moving Average Convergence Divergence)
// =============================================================================

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
  currentMACD: number;
  currentSignal: number;
  currentHistogram: number;
  crossUp: boolean;
  crossDown: boolean;
}

/**
 * Calculate MACD with signal line and histogram
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);

  const macd: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macd[i] = emaFast[i] - emaSlow[i];
  }

  const signal = calculateEMA(macd, signalPeriod);

  const histogram: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    histogram[i] = macd[i] - signal[i];
  }

  const currentHistogram = histogram[histogram.length - 1] || 0;
  const prevHistogram = histogram[histogram.length - 2] || 0;

  return {
    macd,
    signal,
    histogram,
    currentMACD: macd[macd.length - 1] || 0,
    currentSignal: signal[signal.length - 1] || 0,
    currentHistogram,
    crossUp: prevHistogram < 0 && currentHistogram > 0,
    crossDown: prevHistogram > 0 && currentHistogram < 0,
  };
}

// =============================================================================
// BOLLINGER BANDS
// =============================================================================

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
  bandwidth: number;
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBands {
  const slice = closes.slice(-period);
  const middle = slice.reduce((sum, val) => sum + val, 0) / period;

  const variance =
    slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const currentPrice = closes[closes.length - 1];
  const percentB = upper === lower ? 0.5 : (currentPrice - lower) / (upper - lower);
  const bandwidth = upper === 0 ? 0 : (upper - lower) / middle;

  return { upper, middle, lower, percentB, bandwidth };
}

// =============================================================================
// STOCHASTIC OSCILLATOR
// =============================================================================

export interface StochasticResult {
  k: number;
  d: number;
}

/**
 * Calculate Stochastic Oscillator
 */
export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
  smoothK: number = 3
): StochasticResult {
  if (closes.length < period) return { k: 50, d: 50 };

  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const currentClose = closes[closes.length - 1];

  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);

  // %K = (Current Close - Lowest Low) / (Highest High - Lowest Low) * 100
  const k =
    highestHigh === lowestLow
      ? 50
      : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;

  // Calculate rolling K values for %D
  const kValues: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const windowHighs = highs.slice(i - period + 1, i + 1);
    const windowLows = lows.slice(i - period + 1, i + 1);
    const hh = Math.max(...windowHighs);
    const ll = Math.min(...windowLows);
    kValues.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }

  // %D = SMA of %K
  const d = kValues.slice(-smoothK).reduce((sum, val) => sum + val, 0) / smoothK;

  return { k, d };
}

// =============================================================================
// WILLIAMS %R
// =============================================================================

/**
 * Calculate Williams %R
 * Range: 0 to -100 (0 = overbought, -100 = oversold)
 */
export function calculateWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (closes.length < period) return -50;

  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const currentClose = closes[closes.length - 1];

  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);

  if (highestHigh === lowestLow) return -50;
  return ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
}

// =============================================================================
// RATE OF CHANGE (ROC)
// =============================================================================

/**
 * Calculate Rate of Change
 */
export function calculateROC(closes: number[], period: number = 12): number {
  if (closes.length < period + 1) return 0;
  const currentClose = closes[closes.length - 1];
  const pastClose = closes[closes.length - period - 1];
  return ((currentClose - pastClose) / pastClose) * 100;
}

// =============================================================================
// AVERAGE TRUE RANGE (ATR)
// =============================================================================

/**
 * Calculate Average True Range for volatility
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (closes.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  return trueRanges.slice(-period).reduce((sum, val) => sum + val, 0) / period;
}

// =============================================================================
// MOMENTUM
// =============================================================================

/**
 * Calculate momentum as percentage change
 */
export function calculateMomentum(closes: number[], period: number = 3): number {
  if (closes.length < period + 1) return 0;
  const currentPrice = closes[closes.length - 1];
  const pastPrice = closes[closes.length - period - 1];
  return ((currentPrice - pastPrice) / pastPrice) * 100;
}

// =============================================================================
// VOLUME ANALYSIS
// =============================================================================

/**
 * Calculate volume ratio vs average
 * Returns ratio: 1.0 = 100% (same as average), 2.0 = 200% (double), 0.5 = 50% (half)
 */
export function calculateVolumeRatio(
  volumes: number[],
  avgPeriod: number = 20,
  recentPeriod: number = 3
): number {
  // DEBUG: Log input - use process.stdout for immediate output
  const debugInfo = {
    totalVolumes: volumes.length,
    avgPeriod,
    recentPeriod,
    sampleVolumes: volumes.slice(-5),
    zeroCount: volumes.filter(v => v === 0).length,
    nanCount: volumes.filter(v => isNaN(v)).length,
  };
  
  
  if (volumes.length < avgPeriod) {
    return 1;
  }

  // Filter out invalid values (NaN, undefined, null, <= 0)
  const validVolumes = volumes.filter((v) => typeof v === 'number' && !isNaN(v) && v > 0);
  
  // DEBUG: Log filtering results
  
  // If we have very few valid volumes, return neutral ratio (don't reject based on volume)
  if (validVolumes.length < avgPeriod * 0.5) {
    return 1;
  }

  // Get volumes for average period (excluding recent)
  const avgVolumes = validVolumes.slice(-avgPeriod, -recentPeriod);
  if (avgVolumes.length === 0) {
    return 1;
  }
  
  const avgVolume = avgVolumes.reduce((sum, val) => sum + val, 0) / avgVolumes.length;

  // Get recent volumes
  const recentVolumes = validVolumes.slice(-recentPeriod);
  if (recentVolumes.length === 0) {
    return 1;
  }
  
  const recentVolume = recentVolumes.reduce((sum, val) => sum + val, 0) / recentVolumes.length;

  // DEBUG: Log calculation

  // Handle edge cases
  if (avgVolume === 0 || isNaN(avgVolume) || avgVolume <= 0) {
    return 1;
  }
  
  if (recentVolume === 0 || isNaN(recentVolume) || recentVolume <= 0) {
    // If recent volume is 0 but average exists, return very low ratio (1%)
    // This will be caught by minVolumeRatio (10%) but won't show confusing 0%
    return 0.01; // Return 1% instead of 0% to avoid false "0%" display
  }

  const ratio = recentVolume / avgVolume;
  
  // DEBUG: Log final result
  
  // Sanity check - if ratio is invalid, return neutral
  if (isNaN(ratio) || !isFinite(ratio)) {
    return 1;
  }

  return ratio;
}

// =============================================================================
// TREND DETECTION & MARKET REGIME
// =============================================================================

/**
 * Determine trend direction from price and SMAs
 */
export function detectTrend(
  currentPrice: number,
  smaFast: number,
  smaSlow: number
): TrendDirection {
  if (currentPrice > smaFast && smaFast > smaSlow) return 'UP';
  if (currentPrice < smaFast && smaFast < smaSlow) return 'DOWN';
  return 'SIDEWAYS';
}

/**
 * Calculate trend strength (ADX-like, simplified)
 * Returns 0-1 where 1 = strong trend, 0 = no trend (ranging)
 */
export function calculateTrendStrength(
  closes: number[],
  period: number = 14
): number {
  if (closes.length < period * 2) return 0.5; // Default moderate
  
  const smaFast = calculateSMA(closes, period);
  const smaSlow = calculateSMA(closes, period * 2);
  
  // Calculate price deviation from SMAs
  const currentPrice = closes[closes.length - 1];
  const fastDev = Math.abs(currentPrice - smaFast) / smaFast;
  const slowDev = Math.abs(currentPrice - smaSlow) / smaSlow;
  
  // Calculate momentum consistency
  const recentChanges = closes.slice(-period).map((c, i) => {
    if (i === 0) return 0;
    return (c - closes[closes.length - period + i - 1]) / closes[closes.length - period + i - 1];
  });
  
  const avgChange = recentChanges.reduce((sum, c) => sum + Math.abs(c), 0) / period;
  const changeConsistency = recentChanges.filter(c => Math.sign(c) === Math.sign(recentChanges[recentChanges.length - 1])).length / period;
  
  // Combine factors: deviation + consistency
  const strength = (fastDev * 0.3 + slowDev * 0.3 + avgChange * 0.2 + changeConsistency * 0.2) * 10;
  
  return Math.min(1, Math.max(0, strength));
}

/**
 * Detect RSI/Price divergence (bullish or bearish)
 */
export interface DivergenceDetection {
  hasDivergence: boolean;
  type: 'bullish' | 'bearish' | null;
  strength: number;
  reason: string;
}

export function detectDivergence(
  closes: number[],
  rsiValues: number[],
  lookback: number = 14
): DivergenceDetection {
  if (closes.length < lookback * 2 || rsiValues.length < lookback * 2) {
    return { hasDivergence: false, type: null, strength: 0, reason: 'Insufficient data' };
  }
  
  // Get recent price and RSI lows/highs
  const recentPrices = closes.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);
  
  const priceLow = Math.min(...recentPrices);
  const priceLowIdx = recentPrices.indexOf(priceLow);
  const rsiLow = Math.min(...recentRSI);
  const rsiLowIdx = recentRSI.indexOf(rsiLow);
  
  const priceHigh = Math.max(...recentPrices);
  const priceHighIdx = recentPrices.indexOf(priceHigh);
  const rsiHigh = Math.max(...recentRSI);
  const rsiHighIdx = recentRSI.indexOf(rsiHigh);
  
  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceLowIdx < lookback - 3 && rsiLowIdx < lookback - 3) {
    const prevPriceLow = Math.min(...closes.slice(-lookback * 2, -lookback));
    const prevRSILow = Math.min(...rsiValues.slice(-lookback * 2, -lookback));
    
    if (priceLow < prevPriceLow && rsiLow > prevRSILow) {
      const strength = Math.min(100, ((rsiLow - prevRSILow) / prevRSILow) * 200);
      return {
        hasDivergence: true,
        type: 'bullish',
        strength,
        reason: `Bullish divergence: Price lower low, RSI higher low (${strength.toFixed(0)}%)`,
      };
    }
  }
  
  // Bearish divergence: price makes higher high, RSI makes lower high
  if (priceHighIdx < lookback - 3 && rsiHighIdx < lookback - 3) {
    const prevPriceHigh = Math.max(...closes.slice(-lookback * 2, -lookback));
    const prevRSIHigh = Math.max(...rsiValues.slice(-lookback * 2, -lookback));
    
    if (priceHigh > prevPriceHigh && rsiHigh < prevRSIHigh) {
      const strength = Math.min(100, ((prevRSIHigh - rsiHigh) / prevRSIHigh) * 200);
      return {
        hasDivergence: true,
        type: 'bearish',
        strength,
        reason: `Bearish divergence: Price higher high, RSI lower high (${strength.toFixed(0)}%)`,
      };
    }
  }
  
  return { hasDivergence: false, type: null, strength: 0, reason: 'No divergence' };
}

// =============================================================================
// CANDLESTICK PATTERN DETECTION
// =============================================================================

interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  body: number;
  isBullish: boolean;
}

function parseCandle(kline: Kline): CandleData {
  return {
    open: kline.open,
    high: kline.high,
    low: kline.low,
    close: kline.close,
    body: Math.abs(kline.close - kline.open),
    isBullish: kline.close > kline.open,
  };
}

/**
 * Detect candlestick patterns
 */
export function detectCandlePattern(klines: Kline[]): CandlePattern | null {
  if (klines.length < 3) return null;

  const candles = klines.slice(-3).map(parseCandle);
  const [c1, c2, current] = candles;
  const prev = c2;

  // Bullish Engulfing
  if (
    !prev.isBullish &&
    current.isBullish &&
    current.body > prev.body * 1.2 &&
    current.close > prev.open &&
    current.open < prev.close
  ) {
    return { pattern: 'BULLISH_ENGULFING', bullish: true };
  }

  // Bearish Engulfing
  if (
    prev.isBullish &&
    !current.isBullish &&
    current.body > prev.body * 1.2 &&
    current.open > prev.close &&
    current.close < prev.open
  ) {
    return { pattern: 'BEARISH_ENGULFING', bullish: false };
  }

  // Hammer (bullish reversal)
  const lowerWick = current.isBullish
    ? current.open - current.low
    : current.close - current.low;
  const upperWick = current.isBullish
    ? current.high - current.close
    : current.high - current.open;

  if (lowerWick > current.body * 2 && upperWick < current.body * 0.5) {
    return { pattern: 'HAMMER', bullish: true };
  }

  // Shooting Star (bearish reversal)
  if (upperWick > current.body * 2 && lowerWick < current.body * 0.5) {
    return { pattern: 'SHOOTING_STAR', bullish: false };
  }

  // Three White Soldiers
  if (c1.isBullish && c2.isBullish && current.isBullish) {
    return { pattern: 'THREE_WHITE_SOLDIERS', bullish: true };
  }

  // Three Black Crows
  if (!c1.isBullish && !c2.isBullish && !current.isBullish) {
    return { pattern: 'THREE_BLACK_CROWS', bullish: false };
  }

  return null;
}

// =============================================================================
// BOUNCE / V-RECOVERY DETECTION
// =============================================================================

export interface BounceDetection {
  isBounce: boolean;
  strength: number;
  reasons: string[];
}

/**
 * Detect V-recovery / bounce from oversold conditions
 */
export function detectBounce(
  klines: Kline[],
  rsi: number,
  stoch: StochasticResult,
  williamsR: number,
  config: Pick<
    ScalperConfig,
    | 'bounceDetectionEnabled'
    | 'bounceRSIThreshold'
    | 'bounceStochThreshold'
    | 'bounceWilliamsThreshold'
    | 'bounceMinGreenCandles'
    | 'bounceBonusPoints'
  >
): BounceDetection {
  if (!config.bounceDetectionEnabled) {
    return { isBounce: false, strength: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let oversoldCount = 0;
  let bounceStrength = 0;

  // Check oversold conditions
  if (rsi < config.bounceRSIThreshold) {
    oversoldCount++;
    reasons.push(`RSI oversold (${rsi.toFixed(0)} < ${config.bounceRSIThreshold})`);
  }
  if (stoch.k < config.bounceStochThreshold) {
    oversoldCount++;
    reasons.push(`Stoch oversold (K=${stoch.k.toFixed(0)} < ${config.bounceStochThreshold})`);
  }
  if (williamsR < config.bounceWilliamsThreshold) {
    oversoldCount++;
    reasons.push(`Williams %R oversold (${williamsR.toFixed(0)} < ${config.bounceWilliamsThreshold})`);
  }

  // Need at least 2 oversold indicators
  if (oversoldCount < 2) {
    return { isBounce: false, strength: 0, reasons: [] };
  }

  // Check for consecutive green candles
  const recentKlines = klines.slice(-config.bounceMinGreenCandles - 2);
  let greenCandleCount = 0;

  for (let i = recentKlines.length - config.bounceMinGreenCandles; i < recentKlines.length; i++) {
    if (i >= 0 && i < recentKlines.length) {
      const kline = recentKlines[i];
      if (kline.close > kline.open) {
        greenCandleCount++;
      }
    }
  }

  // Require minimum green candles for bounce confirmation
  if (greenCandleCount >= config.bounceMinGreenCandles) {
    bounceStrength = config.bounceBonusPoints;
    reasons.push(`${greenCandleCount} green candles (recovery)`);

    // Check for bullish engulfing on bounce
    if (klines.length >= 2) {
      const last = klines[klines.length - 1];
      const prev = klines[klines.length - 2];

      if (
        prev.close < prev.open &&
        last.close > last.open &&
        last.close > prev.open &&
        last.open < prev.close
      ) {
        bounceStrength += 5;
        reasons.push('BULLISH ENGULFING on bounce');
      }
    }

    // Check for higher lows (V-recovery pattern)
    if (klines.length >= 4) {
      const low1 = klines[klines.length - 4].low;
      const low2 = klines[klines.length - 2].low;
      const low3 = klines[klines.length - 1].low;
      if (low3 > low2 && low2 > low1) {
        bounceStrength += 5;
        reasons.push('Higher lows (V-recovery)');
      }
    }

    return { isBounce: true, strength: bounceStrength, reasons };
  }

  return { isBounce: false, strength: 0, reasons: [] };
}

// =============================================================================
// SUPPORT & RESISTANCE LEVELS
// =============================================================================

export interface SupportResistance {
  support: number; // Recent swing low (support level)
  resistance: number; // Recent swing high (resistance level)
  pivotPoint: number; // Classic pivot point
  r1: number; // Resistance 1
  r2: number; // Resistance 2
  s1: number; // Support 1
  s2: number; // Support 2
}

/**
 * Calculate support and resistance levels using swing highs/lows
 */
export function calculateSupportResistance(klines: Kline[], lookback: number = 20): SupportResistance {
  if (klines.length < lookback) {
    const currentPrice = klines[klines.length - 1]?.close || 0;
    return {
      support: currentPrice * 0.995, // 0.5% below current
      resistance: currentPrice * 1.005, // 0.5% above current
      pivotPoint: currentPrice,
      r1: currentPrice * 1.01,
      r2: currentPrice * 1.02,
      s1: currentPrice * 0.99,
      s2: currentPrice * 0.98,
    };
  }

  const recentKlines = klines.slice(-lookback);
  const highs = recentKlines.map((k) => k.high);
  const lows = recentKlines.map((k) => k.low);
  const closes = recentKlines.map((k) => k.close);
  
  const currentPrice = closes[closes.length - 1];
  const currentHigh = highs[highs.length - 1];
  const currentLow = lows[lows.length - 1];

  // Find swing highs (local maxima)
  let swingHigh = currentHigh;
  for (let i = 1; i < highs.length - 1; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
      if (highs[i] > swingHigh) {
        swingHigh = highs[i];
      }
    }
  }

  // Find swing lows (local minima)
  let swingLow = currentLow;
  for (let i = 1; i < lows.length - 1; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
      if (lows[i] < swingLow) {
        swingLow = lows[i];
      }
    }
  }

  // Classic Pivot Point calculation
  const pivotPoint = (currentHigh + currentLow + currentPrice) / 3;
  const r1 = 2 * pivotPoint - currentLow;
  const r2 = pivotPoint + (currentHigh - currentLow);
  const s1 = 2 * pivotPoint - currentHigh;
  const s2 = pivotPoint - (currentHigh - currentLow);

  // Use swing levels, fallback to pivot levels if swing not found
  const support = swingLow > 0 ? swingLow : s1;
  const resistance = swingHigh > 0 ? swingHigh : r1;

  return {
    support: Math.max(support, currentPrice * 0.99), // At least 1% below current
    resistance: Math.min(resistance, currentPrice * 1.01), // At least 1% above current
    pivotPoint,
    r1,
    r2,
    s1,
    s2,
  };
}

// =============================================================================
// COMPLETE TECHNICAL ANALYSIS
// =============================================================================

/**
 * Calculate all technical indicators for a symbol
 */
export function calculateAllIndicators(
  klines: Kline[],
  config: ScalperConfig
): TechnicalIndicators | null {
  if (klines.length < Math.max(config.trendSMASlow, config.rsiPeriod + 5, 50)) {
    return null;
  }

  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const volumes = klines.map((k) => {
    const vol = k.volume;
    // Validate volume - should be a positive number
    if (typeof vol !== 'number' || isNaN(vol) || vol <= 0) {
      // Log warning for debugging
      // Return 0 - will be handled by calculateVolumeRatio
      return 0;
    }
    return vol;
  });
  const currentPrice = closes[closes.length - 1];

  // EMAs
  const ema9Array = calculateEMA(closes, 9);
  const ema21Array = calculateEMA(closes, 21);
  const ema50Array = calculateEMA(closes, 50);
  const ema9 = ema9Array[ema9Array.length - 1];
  const ema21 = ema21Array[ema21Array.length - 1];
  const ema50 = ema50Array[ema50Array.length - 1];

  // MACD
  const macdResult = calculateMACD(closes);

  // Bollinger Bands
  const bb = calculateBollingerBands(closes);

  // Stochastic
  const stoch = calculateStochastic(highs, lows, closes);

  // Trend detection
  const smaFast = calculateSMA(closes, config.trendSMAFast);
  const smaSlow = calculateSMA(closes, config.trendSMASlow);
  const trend = detectTrend(currentPrice, smaFast, smaSlow);

  // ATR
  const atr = calculateATR(highs, lows, closes);
  const atrPercent = (atr / currentPrice) * 100;

  // Calculate RSI array for divergence detection
  const rsiArray: number[] = [];
  for (let i = config.rsiPeriod; i <= closes.length; i++) {
    rsiArray.push(calculateRSI(closes.slice(0, i), config.rsiPeriod));
  }
  const currentRSI = calculateRSI(closes, config.rsiPeriod);
  
  // Trend strength (market regime)
  const trendStrength = calculateTrendStrength(closes, config.trendSMASlow);
  
  // Divergence detection
  const divergence = detectDivergence(closes, rsiArray, 14);

  return {
    price: currentPrice,
    rsi: currentRSI,
    momentum: calculateMomentum(closes, config.momentumPeriod),
    volumeRatio: calculateVolumeRatio(volumes, config.volumePeriod),
    trend,
    trendStrength, // Add trend strength

    ema9,
    ema21,
    ema50,

    macd: macdResult.currentMACD,
    macdSignal: macdResult.currentSignal,
    macdHistogram: macdResult.currentHistogram,
    macdCrossUp: macdResult.crossUp,
    macdCrossDown: macdResult.crossDown,

    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbPercentB: bb.percentB,

    stochK: stoch.k,
    stochD: stoch.d,

    roc: calculateROC(closes),
    williamsR: calculateWilliamsR(highs, lows, closes),
    atr,
    atrPercent,
    divergence, // Add divergence
  };
}

// =============================================================================
// HELPER: Convert raw kline array to Kline objects
// =============================================================================

export function parseKlines(rawKlines: any[]): Kline[] {
  if (!rawKlines || rawKlines.length === 0) {
    return [];
  }
  
  // DEBUG: Log first and last raw kline
  
  const parsed = rawKlines.map((k, index) => {
    if (!Array.isArray(k)) {
      return null;
    }
    
    const volume = parseFloat(k[5]);
    // DEBUG: Log volume parsing for first few
    if (index < 3 || index >= rawKlines.length - 3) {
    }
    
    // Validate volume - ensure it's a valid number (allow 0, but not NaN)
    const validVolume = (typeof volume === 'number' && !isNaN(volume) && volume >= 0) ? volume : 0;
    
    return {
      openTime: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: validVolume,
      closeTime: parseInt(k[6]),
    };
  }).filter(k => k !== null) as Kline[];
  
  // DEBUG: Log parsed volumes
  
  return parsed;
}

// Functions already exported above, no need to re-export
