/**
 * LLM Analysis Service
 * Uses OpenRouter/DeepSeek for trade confirmation and exit analysis
 * Structured outputs (Zod), retry logic, circuit breaker, and rate limiting
 */

import { z } from 'zod';
import type { TechnicalIndicators, LLMAnalysis, Position, Kline } from '../../types';
import { config } from '../../config';
import { signalLogger } from '../../utils/logger';
import { llmRequests, llmLatency, llmRetries, llmCircuitBreakerState, llmRateLimitHits, llmStructuredOutputFailures } from '../../utils/metrics';
import { retryWithBackoff } from '../../utils/retry';
import { CircuitBreaker, CircuitState } from '../../utils/circuit-breaker';
import { RateLimiterManager, RateLimitError } from '../../utils/rate-limiter';
import { LLMTimeoutError, LLMValidationError, LLMRateLimitError, LLMServiceError } from '../../types';

// =============================================================================
// LLM CONFIGURATION
// =============================================================================

interface LLMConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  timeout: number;
  baseUrl: string;
}

const llmConfig: LLMConfig = {
  enabled: config.llm.enabled,
  apiKey: config.llm.apiKey,
  model: config.llm.model,
  timeout: config.llm.timeout,
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
};

// =============================================================================
// ZOD SCHEMAS FOR STRUCTURED OUTPUTS
// =============================================================================

const EntryAnalysisSchema = z.object({
  action: z.enum(['LONG', 'SHORT', 'WAIT']),
  confidence: z.number().min(0).max(100),
  reason: z.string(),
});

const ExitAnalysisSchema = z.object({
  action: z.enum(['HOLD', 'EXIT']),
  confidence: z.number().min(0).max(100),
  reason: z.string(),
});

// =============================================================================
// CIRCUIT BREAKER & RATE LIMITER
// =============================================================================

// Per-model circuit breaker and rate limiter
const circuitBreakers = new Map<string, CircuitBreaker>();
const rateLimiterManager = new RateLimiterManager();

function getCircuitBreaker(model: string): CircuitBreaker {
  if (!circuitBreakers.has(model)) {
    const cb = new CircuitBreaker({
      failureThreshold: config.llm.circuitBreaker.failureThreshold,
      successThreshold: config.llm.circuitBreaker.successThreshold,
      timeoutMs: config.llm.circuitBreaker.timeoutMs,
      halfOpenTimeoutMs: config.llm.circuitBreaker.halfOpenTimeoutMs,
      onStateChange: (state) => {
        const stateValue = state === CircuitState.CLOSED ? 0 : state === CircuitState.OPEN ? 1 : 2;
        llmCircuitBreakerState.set({ model }, stateValue);
      },
    });
    circuitBreakers.set(model, cb);
  }
  return circuitBreakers.get(model)!;
}

function getRateLimiter(model: string) {
  return rateLimiterManager.getLimiter(model, {
    requestsPerMinute: config.llm.rateLimit.requestsPerMinute,
    burstSize: config.llm.rateLimit.burstSize,
  });
}

// =============================================================================
// ENTRY ANALYSIS
// =============================================================================

/**
 * Ask LLM to confirm entry signal
 */
export async function analyzeEntry(
  symbol: string,
  direction: 'LONG' | 'SHORT',
  indicators: TechnicalIndicators,
  reasons: string[],
  klines: Kline[]
): Promise<LLMAnalysis> {
  if (!llmConfig.enabled || !llmConfig.apiKey) {
    return {
      action: direction,
      confidence: 50,
      reason: 'LLM disabled',
      agrees: true,
    };
  }

  const startTime = Date.now();

  try {
    // Build candle summary
    const recentCandles = klines.slice(-5).map((k, i) => {
      const isGreen = k.close > k.open;
      const change = ((k.close - k.open) / k.open * 100).toFixed(2);
      return `${i + 1}: ${isGreen ? 'GREEN' : 'RED'} ${change}%`;
    });

    const prompt = `You are an expert crypto scalper maximizing profit per trade. Analyze this ${direction} signal for ${symbol}.

MARKET DATA:
- Price: $${indicators.price.toFixed(4)}
- RSI(14): ${indicators.rsi.toFixed(1)} ${indicators.rsi < 30 ? '⚠️ OVERSOLD' : indicators.rsi > 70 ? '⚠️ OVERBOUGHT' : ''}
- MACD Histogram: ${indicators.macdHistogram.toFixed(6)} ${indicators.macdCrossUp ? '📈 BULLISH CROSS' : indicators.macdCrossDown ? '📉 BEARISH CROSS' : ''}
- Volume Ratio: ${(indicators.volumeRatio * 100).toFixed(0)}% ${indicators.volumeRatio > 1.5 ? '📊 HIGH VOLUME' : ''}
- Trend: ${indicators.trend} ${indicators.trend === 'UP' && direction === 'LONG' ? '✅ ALIGNED' : indicators.trend === 'DOWN' && direction === 'SHORT' ? '✅ ALIGNED' : '⚠️ COUNTER-TREND'}
- EMA9: $${indicators.ema9.toFixed(4)}, EMA21: $${indicators.ema21.toFixed(4)}
- ATR: ${indicators.atrPercent.toFixed(2)}% ${indicators.atrPercent > 2 ? '🔥 HIGH VOLATILITY' : ''}

SIGNAL REASONS:
${reasons.map((r) => `- ${r}`).join('\n')}

RECENT CANDLES (newest last):
${recentCandles.join('\n')}

ANALYSIS FOCUS (for BIGGER WINS):
1. Entry Quality: Is this a HIGH-PROBABILITY setup with strong confluence?
2. Profit Potential: Could this move 2-3x the stop loss? (Risk:Reward)
3. Timing: Is momentum accelerating or fading?
4. Reversal Risk: Any warning signs in the last 3-5 candles?
5. Volume: Is volume confirming the move or diverging?

Be AGGRESSIVE on high-confidence setups. Be CONSERVATIVE if indicators conflict.

Respond with a JSON object in this exact format (no markdown, just JSON):
{
  "action": "LONG" | "SHORT" | "WAIT",
  "confidence": 0-100,
  "reason": "Brief explanation (max 50 words)"
}`;

    // Get circuit breaker and rate limiter for this model
    const circuitBreaker = getCircuitBreaker(llmConfig.model);
    const rateLimiter = getRateLimiter(llmConfig.model);

    // Acquire rate limit token
    try {
      await rateLimiter.acquireToken(5000); // Wait up to 5s for token
    } catch (error) {
      if (error instanceof RateLimitError) {
        llmRateLimitHits.inc({ model: llmConfig.model });
        throw new LLMRateLimitError('Rate limit exceeded', error.retryAfterMs);
      }
      throw error;
    }

    // Execute with circuit breaker and retry
    const makeRequest = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, llmConfig.timeout);
      
      try {
        const response = await fetch(llmConfig.baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${llmConfig.apiKey}`,
            'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/flashscalper',
                        'X-Title': 'FlashScalper',
          },
          body: JSON.stringify({
            model: llmConfig.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.3,
            response_format: { type: 'json_object' }, // Request JSON response
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10) * 1000;
            throw new LLMRateLimitError('Rate limit exceeded', retryAfter);
          }
          if (response.status >= 500) {
            throw new LLMServiceError(`LLM API error: ${response.status}`, response.status);
          }
          throw new LLMServiceError(`LLM API error: ${response.status}`, response.status);
        }
        
        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError' || error.message?.includes('timeout')) {
          throw new LLMTimeoutError('Request timed out');
        }
        // Re-throw LLM errors as-is
        if (error instanceof LLMRateLimitError || error instanceof LLMServiceError || error instanceof LLMTimeoutError) {
          throw error;
        }
        // Wrap other errors
        throw new LLMServiceError(error.message || 'Unknown error');
      }
    };

    const response = await circuitBreaker.execute(() =>
      retryWithBackoff(makeRequest, {
        maxRetries: config.llm.retry.maxRetries,
        initialDelayMs: config.llm.retry.initialDelayMs,
        maxDelayMs: config.llm.retry.maxDelayMs,
        backoffMultiplier: config.llm.retry.backoffMultiplier,
        jitter: config.llm.retry.jitter,
        retryable: (error) => {
          // Retry on network errors, timeouts, and 5xx errors
          if (error instanceof LLMTimeoutError) {
            return true; // Retry on timeout
          }
          if (error instanceof LLMServiceError) {
            return error.statusCode === undefined || (error.statusCode >= 500 && error.statusCode < 600);
          }
          // Don't retry on rate limits or validation errors
          if (error instanceof LLMRateLimitError || error instanceof LLMValidationError) {
            return false;
          }
          return true;
        },
      })
    );

    // Track retries (if any occurred, they're logged by retryWithBackoff)
    // For now, we'll track successful requests
    const latency = Date.now() - startTime;
    llmLatency.observe({ model: llmConfig.model, type: 'entry' }, latency);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    // Parse with Zod schema (structured output)
    let result: LLMAnalysis;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonStr);
      const validated = EntryAnalysisSchema.parse(parsed);
      
      result = {
        action: validated.action === 'WAIT' ? 'HOLD' : validated.action,
        confidence: validated.confidence,
        reason: validated.reason,
        agrees: validated.action === direction || (validated.action === 'WAIT' ? false : validated.action === direction),
      };
    } catch (error) {
      // Fallback to text parsing if JSON parsing fails
      llmStructuredOutputFailures.inc({ model: llmConfig.model, type: 'entry' });
      signalLogger.warn({ error: (error as Error).message, content }, 'Failed to parse LLM JSON response, using fallback');
      result = parseLLMResponse(content, direction);
    }

    llmRequests.inc({ model: llmConfig.model, type: 'entry', result: 'success' });

    signalLogger.debug({
      symbol,
      direction,
      llmAction: result.action,
      llmConfidence: result.confidence,
      llmReason: result.reason,
      latencyMs: latency,
    }, `LLM entry analysis: ${result.agrees ? 'AGREES' : 'DISAGREES'}`);

    return result;
  } catch (error: any) {
    llmRequests.inc({ model: llmConfig.model, type: 'entry', result: 'error' });
    
    // Categorize error for better logging
    if (error instanceof LLMTimeoutError) {
      signalLogger.warn({ error: error.message, symbol }, 'LLM entry analysis timed out');
    } else if (error instanceof LLMRateLimitError) {
      signalLogger.warn({ error: error.message, retryAfter: error.retryAfterMs, symbol }, 'LLM rate limit exceeded');
    } else if (error instanceof LLMValidationError) {
      signalLogger.warn({ error: error.message, symbol }, 'LLM response validation failed');
    } else if (error instanceof LLMServiceError) {
      signalLogger.warn({ error: error.message, statusCode: error.statusCode, symbol }, 'LLM service error');
    } else {
      signalLogger.warn({ error: error.message, symbol }, 'LLM entry analysis failed');
    }

    // IMPORTANT: Do NOT agree on error - we require LLM confirmation for trades
    // If LLM can't confirm, skip the trade (safer)
    return {
      action: 'HOLD',
      confidence: 0,
      reason: `LLM error: ${error.message}`,
      agrees: false, // Do NOT agree on error - skip trade
    };
  }
}

// =============================================================================
// EXIT ANALYSIS
// =============================================================================

/**
 * Ask LLM to analyze whether to exit position
 */
export async function analyzeExit(
  position: Position,
  indicators: TechnicalIndicators,
  klines: Kline[]
): Promise<LLMAnalysis> {
  if (!llmConfig.enabled || !llmConfig.apiKey) {
    return {
      action: 'HOLD',
      confidence: 50,
      reason: 'LLM disabled',
      agrees: false,
    };
  }

  const startTime = Date.now();

  try {
    const holdTime = (Date.now() - position.openedAt) / 60000; // minutes
    const recentCandles = klines.slice(-5).map((k, i) => {
      const isGreen = k.close > k.open;
      const change = ((k.close - k.open) / k.open * 100).toFixed(2);
      return `${i + 1}: ${isGreen ? 'GREEN' : 'RED'} ${change}%`;
    });

    const prompt = `You are an expert scalper maximizing profit. Managing a ${position.side.toUpperCase()} position.

POSITION:
- Symbol: ${position.symbol}
- Side: ${position.side.toUpperCase()}
- Entry: $${position.entryPrice.toFixed(4)}
- Current: $${position.currentPrice.toFixed(4)}
- ROE: ${position.unrealizedROE >= 0 ? '+' : ''}${position.unrealizedROE.toFixed(2)}% ${position.unrealizedROE >= 10 ? '🎯 BIG WIN!' : position.unrealizedROE >= 5 ? '✅ PROFITABLE' : ''}
- PnL: $${position.unrealizedPnl >= 0 ? '+' : ''}${position.unrealizedPnl.toFixed(2)}
- Peak ROE: ${position.highestROE.toFixed(2)}% ${position.highestROE > position.unrealizedROE + 3 ? '⚠️ PULLBACK FROM PEAK' : ''}
- Hold Time: ${holdTime.toFixed(1)} minutes

MARKET DATA:
- RSI(14): ${indicators.rsi.toFixed(1)} ${position.side === 'long' && indicators.rsi > 70 ? '⚠️ OVERBOUGHT' : position.side === 'short' && indicators.rsi < 30 ? '⚠️ OVERSOLD' : ''}
- MACD Histogram: ${indicators.macdHistogram.toFixed(6)} ${position.side === 'long' && indicators.macdHistogram < 0 ? '⚠️ BEARISH' : position.side === 'short' && indicators.macdHistogram > 0 ? '⚠️ BULLISH' : ''}
- Stochastic K: ${indicators.stochK.toFixed(1)}
- Trend: ${indicators.trend} ${position.side === 'long' && indicators.trend === 'DOWN' ? '⚠️ TREND REVERSING' : position.side === 'short' && indicators.trend === 'UP' ? '⚠️ TREND REVERSING' : ''}
- EMA9: $${indicators.ema9.toFixed(4)}, EMA21: $${indicators.ema21.toFixed(4)}
- Volume Ratio: ${(indicators.volumeRatio * 100).toFixed(0)}%

RECENT CANDLES:
${recentCandles.join('\n')}

EXIT ANALYSIS (MAXIMIZE PROFITS):
1. Current Profit: ${position.unrealizedROE >= 8 ? 'STRONG WIN - protect gains!' : position.unrealizedROE >= 5 ? 'GOOD WIN - let it run if momentum holds' : position.unrealizedROE >= 0 ? 'SMALL WIN - watch for reversal' : 'LOSS - cut if no recovery'}
2. Momentum: ${position.side === 'long' && indicators.momentum > 0 ? '✅ Still bullish' : position.side === 'long' && indicators.momentum < 0 ? '❌ Losing momentum' : position.side === 'short' && indicators.momentum < 0 ? '✅ Still bearish' : '❌ Losing momentum'}
3. Peak Protection: ${position.highestROE > position.unrealizedROE + 2 ? '⚠️ Gave back ' + (position.highestROE - position.unrealizedROE).toFixed(1) + '% from peak - consider exit' : '✅ Near peak'}
4. Time: ${holdTime > 20 ? '⚠️ Held >20min - consider exit' : 'OK'}

STRATEGY: If profitable (>5% ROE) and momentum fading, EXIT. If still strong, HOLD for bigger win.

Respond with a JSON object in this exact format (no markdown, just JSON):
{
  "action": "HOLD" | "EXIT",
  "confidence": 0-100,
  "reason": "Brief explanation (max 50 words)"
}`;

    // Get circuit breaker and rate limiter for this model
    const circuitBreaker = getCircuitBreaker(llmConfig.model);
    const rateLimiter = getRateLimiter(llmConfig.model);

    // Acquire rate limit token
    try {
      await rateLimiter.acquireToken(5000); // Wait up to 5s for token
    } catch (error) {
      if (error instanceof RateLimitError) {
        llmRateLimitHits.inc({ model: llmConfig.model });
        throw new LLMRateLimitError('Rate limit exceeded', error.retryAfterMs);
      }
      throw error;
    }

    // Execute with circuit breaker and retry
    const makeRequest = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, llmConfig.timeout);
      
      try {
        const response = await fetch(llmConfig.baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${llmConfig.apiKey}`,
            'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/flashscalper',
                        'X-Title': 'FlashScalper',
          },
          body: JSON.stringify({
            model: llmConfig.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.3,
            response_format: { type: 'json_object' }, // Request JSON response
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10) * 1000;
            throw new LLMRateLimitError('Rate limit exceeded', retryAfter);
          }
          if (response.status >= 500) {
            throw new LLMServiceError(`LLM API error: ${response.status}`, response.status);
          }
          throw new LLMServiceError(`LLM API error: ${response.status}`, response.status);
        }
        
        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError' || error.message?.includes('timeout')) {
          throw new LLMTimeoutError('Request timed out');
        }
        // Re-throw LLM errors as-is
        if (error instanceof LLMRateLimitError || error instanceof LLMServiceError || error instanceof LLMTimeoutError) {
          throw error;
        }
        // Wrap other errors
        throw new LLMServiceError(error.message || 'Unknown error');
      }
    };

    const response = await circuitBreaker.execute(() =>
      retryWithBackoff(makeRequest, {
        maxRetries: config.llm.retry.maxRetries,
        initialDelayMs: config.llm.retry.initialDelayMs,
        maxDelayMs: config.llm.retry.maxDelayMs,
        backoffMultiplier: config.llm.retry.backoffMultiplier,
        jitter: config.llm.retry.jitter,
        retryable: (error) => {
          // Retry on network errors, timeouts, and 5xx errors
          if (error instanceof LLMTimeoutError) {
            return true; // Retry on timeout
          }
          if (error instanceof LLMServiceError) {
            return error.statusCode === undefined || (error.statusCode >= 500 && error.statusCode < 600);
          }
          // Don't retry on rate limits or validation errors
          if (error instanceof LLMRateLimitError || error instanceof LLMValidationError) {
            return false;
          }
          return true;
        },
      })
    );

    const latency = Date.now() - startTime;
    llmLatency.observe({ model: llmConfig.model, type: 'exit' }, latency);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    // Parse with Zod schema (structured output)
    let result: LLMAnalysis;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonStr);
      const validated = ExitAnalysisSchema.parse(parsed);
      
      result = {
        action: validated.action,
        confidence: validated.confidence,
        reason: validated.reason,
        agrees: validated.action === 'EXIT',
      };
    } catch (error) {
      // Fallback to text parsing if JSON parsing fails
      llmStructuredOutputFailures.inc({ model: llmConfig.model, type: 'exit' });
      signalLogger.warn({ error: (error as Error).message, content }, 'Failed to parse LLM JSON response, using fallback');
      result = parseExitResponse(content);
    }

    llmRequests.inc({ model: llmConfig.model, type: 'exit', result: 'success' });

    signalLogger.debug({
      symbol: position.symbol,
      positionSide: position.side,
      roe: position.unrealizedROE,
      llmAction: result.action,
      llmConfidence: result.confidence,
      latencyMs: latency,
    }, `LLM exit analysis: ${result.action}`);

    return result;
  } catch (error: any) {
    llmRequests.inc({ model: llmConfig.model, type: 'exit', result: 'error' });
    
    // Categorize error for better logging
    if (error instanceof LLMTimeoutError) {
      signalLogger.warn({ error: error.message, symbol: position.symbol }, 'LLM exit analysis timed out');
    } else if (error instanceof LLMRateLimitError) {
      signalLogger.warn({ error: error.message, retryAfter: error.retryAfterMs, symbol: position.symbol }, 'LLM rate limit exceeded');
    } else if (error instanceof LLMValidationError) {
      signalLogger.warn({ error: error.message, symbol: position.symbol }, 'LLM response validation failed');
    } else if (error instanceof LLMServiceError) {
      signalLogger.warn({ error: error.message, statusCode: error.statusCode, symbol: position.symbol }, 'LLM service error');
    } else {
      signalLogger.warn({ error: error.message, symbol: position.symbol }, 'LLM exit analysis failed');
    }

    return {
      action: 'HOLD',
      confidence: 50,
      reason: `LLM error: ${error.message}`,
      agrees: false,
    };
  }
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

function parseLLMResponse(content: string, expectedDirection: 'LONG' | 'SHORT'): LLMAnalysis {
  const lines = content.split('\n').map((l) => l.trim());

  let action: 'LONG' | 'SHORT' | 'HOLD' | 'EXIT' = expectedDirection;
  let confidence = 50;
  let reason = 'Unable to parse LLM response';

  for (const line of lines) {
    if (line.startsWith('ACTION:')) {
      const actionStr = line.replace('ACTION:', '').trim().toUpperCase();
      if (actionStr === 'LONG' || actionStr === 'SHORT' || actionStr === 'WAIT') {
        action = actionStr === 'WAIT' ? 'HOLD' : actionStr;
      }
    }
    if (line.startsWith('CONFIDENCE:')) {
      const confStr = line.replace('CONFIDENCE:', '').trim();
      const parsed = parseInt(confStr, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        confidence = parsed;
      }
    }
    if (line.startsWith('REASON:')) {
      reason = line.replace('REASON:', '').trim();
    }
  }

  // LLM agrees ONLY if:
  // 1. It says the same direction (LONG/SHORT) as our signal
  // 2. AND it has confidence >= 65%
  // NEVER count HOLD/WAIT as agreement - that means "don't trade"
  const agrees = action === expectedDirection && confidence >= 65;

  return { action, confidence, reason, agrees };
}

function parseExitResponse(content: string): LLMAnalysis {
  const lines = content.split('\n').map((l) => l.trim());

  let action: 'HOLD' | 'EXIT' = 'HOLD';
  let confidence = 50;
  let reason = 'Unable to parse LLM response';

  for (const line of lines) {
    if (line.startsWith('ACTION:')) {
      const actionStr = line.replace('ACTION:', '').trim().toUpperCase();
      if (actionStr === 'EXIT') {
        action = 'EXIT';
      }
    }
    if (line.startsWith('CONFIDENCE:')) {
      const confStr = line.replace('CONFIDENCE:', '').trim();
      const parsed = parseInt(confStr, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        confidence = parsed;
      }
    }
    if (line.startsWith('REASON:')) {
      reason = line.replace('REASON:', '').trim();
    }
  }

  return { action, confidence, reason, agrees: action === 'EXIT' };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const llmAnalyzer = {
  analyzeEntry,
  analyzeExit,
  isEnabled: () => llmConfig.enabled && !!llmConfig.apiKey,
};

export default llmAnalyzer;
