/**
 * Contextual Memory System
 * Remembers recent market context for better decisions
 */

import type { TechnicalIndicators, SignalType } from '../../types';
import { logger } from '../../utils/logger';

export interface MarketContext {
  timestamp: number;
  symbol: string;
  priceAction: {
    recentPrices: number[];
    volatility: number;
    trend: string;
  };
  signalPatterns: {
    recentSignals: Array<{ type: SignalType; confidence: number; outcome?: 'win' | 'loss' }>;
    winningPattern: string[];
    losingPattern: string[];
  };
  marketEvents: Array<{
    type: 'volatility_spike' | 'volume_surge' | 'trend_reversal';
    timestamp: number;
    strength: number;
  }>;
  tradeStreak: {
    currentStreak: number;
    streakType: 'winning' | 'losing' | 'none';
  };
}

export interface ContextualBoost {
  confidenceBoost: number;
  scoreBoost: number;
  reason: string;
}

export class ContextualMemory {
  private contexts: Map<string, MarketContext[]> = new Map();
  private maxContextsPerSymbol: number = 20;
  private contextExpirationMs: number = 3600000;

  /**
   * Store market context
   */
  storeContext(
    symbol: string,
    indicators: TechnicalIndicators,
    recentSignals: Array<{ type: SignalType; confidence: number; outcome?: 'win' | 'loss' }>
  ): void {
    const context: MarketContext = {
      timestamp: Date.now(),
      symbol,
      priceAction: {
        recentPrices: [],
        volatility: indicators.atr || 0,
        trend: indicators.trend,
      },
      signalPatterns: {
        recentSignals,
        winningPattern: recentSignals.filter(s => s.outcome === 'win').map(s => s.type),
        losingPattern: recentSignals.filter(s => s.outcome === 'loss').map(s => s.type),
      },
      marketEvents: this.detectMarketEvents(indicators),
      tradeStreak: this.calculateTradeStreak(recentSignals),
    };

    if (!this.contexts.has(symbol)) {
      this.contexts.set(symbol, []);
    }

    const symbolContexts = this.contexts.get(symbol)!;
    symbolContexts.push(context);
    symbolContexts.sort((a, b) => b.timestamp - a.timestamp);

    if (symbolContexts.length > this.maxContextsPerSymbol) {
      symbolContexts.pop();
    }

    this.pruneExpiredContexts();
  }

  /**
   * Get contextual boost for a signal
   */
  getContextualBoost(
    symbol: string,
    signalType: SignalType,
    confidence: number
  ): ContextualBoost {
    const symbolContexts = this.contexts.get(symbol) || [];
    const recentContexts = symbolContexts
      .filter(c => Date.now() - c.timestamp < this.contextExpirationMs)
      .slice(0, 10);

    if (recentContexts.length === 0) {
      return {
        confidenceBoost: 0,
        scoreBoost: 0,
        reason: 'No recent context',
      };
    }

    let confidenceBoost = 0;
    let scoreBoost = 0;
    const reasons: string[] = [];

    for (const context of recentContexts) {
      const winningPattern = context.signalPatterns.winningPattern;
      const losingPattern = context.signalPatterns.losingPattern;

      if (winningPattern.includes(signalType)) {
        confidenceBoost += 2;
        scoreBoost += 3;
        reasons.push('Similar to recent winner');
      }

      if (losingPattern.includes(signalType)) {
        confidenceBoost -= 2;
        scoreBoost -= 3;
        reasons.push('Similar to recent loser');
      }

      if (context.tradeStreak.streakType === 'winning' && context.tradeStreak.currentStreak >= 3) {
        confidenceBoost += 1;
        scoreBoost += 2;
        reasons.push('Winning streak context');
      }

      if (context.tradeStreak.streakType === 'losing' && context.tradeStreak.currentStreak >= 3) {
        confidenceBoost -= 1;
        scoreBoost -= 2;
        reasons.push('Losing streak context');
      }

      const volatilitySpike = context.marketEvents.find(e => e.type === 'volatility_spike');
      if (volatilitySpike && volatilitySpike.strength > 0.7) {
        confidenceBoost -= 0.5;
        reasons.push('High volatility context');
      }
    }

    return {
      confidenceBoost: Math.min(Math.max(confidenceBoost, -5), 5),
      scoreBoost: Math.min(Math.max(scoreBoost, -8), 8),
      reason: reasons.join('; ') || 'Neutral context',
    };
  }

  /**
   * Update signal outcome in context
   */
  updateSignalOutcome(symbol: string, signalType: SignalType, outcome: 'win' | 'loss'): void {
    const symbolContexts = this.contexts.get(symbol) || [];
    
    for (const context of symbolContexts) {
      const signal = context.signalPatterns.recentSignals.find(
        s => s.type === signalType && !s.outcome
      );
      
      if (signal) {
        signal.outcome = outcome;
        if (outcome === 'win') {
          context.signalPatterns.winningPattern.push(signalType);
        } else {
          context.signalPatterns.losingPattern.push(signalType);
        }
      }
    }
  }

  /**
   * Clear contexts for a symbol
   */
  clearContexts(symbol: string): void {
    this.contexts.delete(symbol);
  }

  /**
   * Clear all contexts
   */
  clearAll(): void {
    this.contexts.clear();
  }

  private detectMarketEvents(indicators: TechnicalIndicators): Array<{
    type: 'volatility_spike' | 'volume_surge' | 'trend_reversal';
    timestamp: number;
    strength: number;
  }> {
    const events: Array<{
      type: 'volatility_spike' | 'volume_surge' | 'trend_reversal';
      timestamp: number;
      strength: number;
    }> = [];

    if ((indicators.atrPercent || 0) > 3) {
      events.push({
        type: 'volatility_spike',
        timestamp: Date.now(),
        strength: Math.min((indicators.atrPercent || 0) / 3, 1),
      });
    }

    if ((indicators.volumeRatio || 1) > 2) {
      events.push({
        type: 'volume_surge',
        timestamp: Date.now(),
        strength: Math.min((indicators.volumeRatio || 1) / 2, 1),
      });
    }

    return events;
  }

  private calculateTradeStreak(
    recentSignals: Array<{ type: SignalType; confidence: number; outcome?: 'win' | 'loss' }>
  ): {
    currentStreak: number;
    streakType: 'winning' | 'losing' | 'none';
  } {
    const outcomes = recentSignals
      .filter(s => s.outcome)
      .map(s => s.outcome!)
      .reverse();

    if (outcomes.length === 0) {
      return { currentStreak: 0, streakType: 'none' };
    }

    let streak = 1;
    const firstOutcome = outcomes[0];

    for (let i = 1; i < outcomes.length; i++) {
      if (outcomes[i] === firstOutcome) {
        streak++;
      } else {
        break;
      }
    }

    return {
      currentStreak: streak,
      streakType: firstOutcome === 'win' ? 'winning' : 'losing',
    };
  }

  private pruneExpiredContexts(): void {
    const now = Date.now();

    for (const [symbol, contexts] of this.contexts.entries()) {
      const validContexts = contexts.filter(
        c => now - c.timestamp < this.contextExpirationMs
      );

      if (validContexts.length === 0) {
        this.contexts.delete(symbol);
      } else {
        this.contexts.set(symbol, validContexts);
      }
    }
  }
}

