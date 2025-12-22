/**
 * Symbol Intelligence
 * Learns which symbols perform better in different conditions
 */

import type { TradeMemory } from './trade-history';
import { logger } from '../../utils/logger';

export interface SymbolPerformance {
  symbol: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgROE: number;
  totalPnL: number;
  bestConditions: string[];
  worstConditions: string[];
  recentPerformance: Array<{ time: number; pnl: number; roe: number }>;
}

export interface SymbolIntelligence {
  symbolPerformance: Map<string, SymbolPerformance>;
  symbolRanking: string[];
}

export class SymbolIntelligenceMemory {
  private intelligence: SymbolIntelligence;
  private maxRecentPerformance: number = 20;

  constructor() {
    this.intelligence = {
      symbolPerformance: new Map(),
      symbolRanking: [],
    };
  }

  /**
   * Learn from a completed trade
   */
  learnFromTrade(trade: TradeMemory): void {
    const performance = this.intelligence.symbolPerformance.get(trade.symbol) || {
      symbol: trade.symbol,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgROE: 0,
      totalPnL: 0,
      bestConditions: [],
      worstConditions: [],
      recentPerformance: [],
    };

    performance.totalTrades++;
    if (trade.outcome === 'win') {
      performance.wins++;
    } else if (trade.outcome === 'loss') {
      performance.losses++;
    }
    performance.winRate = performance.totalTrades > 0 
      ? performance.wins / performance.totalTrades 
      : 0;
    performance.avgROE = ((performance.avgROE * (performance.totalTrades - 1)) + trade.realizedROE) / performance.totalTrades;
    performance.totalPnL += trade.realizedPnl;

    performance.recentPerformance.push({
      time: trade.exitTime,
      pnl: trade.realizedPnl,
      roe: trade.realizedROE,
    });

    if (performance.recentPerformance.length > this.maxRecentPerformance) {
      performance.recentPerformance.shift();
    }

    this.updateConditionLearning(performance, trade);

    this.intelligence.symbolPerformance.set(trade.symbol, performance);
    this.updateRanking();
  }

  /**
   * Get symbol priority score (higher = better)
   */
  getSymbolPriority(symbol: string, currentConditions: string[]): number {
    const performance = this.intelligence.symbolPerformance.get(symbol);
    
    if (!performance || performance.totalTrades < 3) {
      return 0.5;
    }

    let priority = performance.winRate;

    const bestConditionsMatch = currentConditions.filter(c => 
      performance.bestConditions.includes(c)
    ).length;
    const worstConditionsMatch = currentConditions.filter(c => 
      performance.worstConditions.includes(c)
    ).length;

    if (bestConditionsMatch > 0) {
      priority += 0.2 * bestConditionsMatch;
    }

    if (worstConditionsMatch > 0) {
      priority -= 0.3 * worstConditionsMatch;
    }

    if (performance.avgROE > 0) {
      priority += Math.min(performance.avgROE / 10, 0.2);
    }

    return Math.min(Math.max(priority, 0), 1);
  }

  /**
   * Get ranked symbols (best first)
   */
  getRankedSymbols(conditions: string[] = []): string[] {
    if (conditions.length === 0) {
      return [...this.intelligence.symbolRanking];
    }

    const symbols = Array.from(this.intelligence.symbolPerformance.keys());
    return symbols
      .map(symbol => ({
        symbol,
        priority: this.getSymbolPriority(symbol, conditions),
      }))
      .sort((a, b) => b.priority - a.priority)
      .map(s => s.symbol);
  }

  /**
   * Get symbol performance
   */
  getSymbolPerformance(symbol: string): SymbolPerformance | undefined {
    return this.intelligence.symbolPerformance.get(symbol);
  }

  /**
   * Get all symbol performances
   */
  getAllPerformances(): Map<string, SymbolPerformance> {
    return new Map(this.intelligence.symbolPerformance);
  }

  /**
   * Get intelligence for persistence
   */
  getIntelligence(): SymbolIntelligence {
    return {
      symbolPerformance: new Map(this.intelligence.symbolPerformance),
      symbolRanking: [...this.intelligence.symbolRanking],
    };
  }

  /**
   * Load intelligence from persistence
   */
  loadIntelligence(intelligence: SymbolIntelligence): void {
    this.intelligence = {
      symbolPerformance: new Map(intelligence.symbolPerformance),
      symbolRanking: intelligence.symbolRanking || [],
    };
  }

  private updateConditionLearning(performance: SymbolPerformance, trade: TradeMemory): void {
    const condition = this.extractCondition(trade);

    if (trade.outcome === 'win') {
      if (!performance.bestConditions.includes(condition)) {
        performance.bestConditions.push(condition);
      }

      const worstIndex = performance.worstConditions.indexOf(condition);
      if (worstIndex !== -1) {
        performance.worstConditions.splice(worstIndex, 1);
      }
    } else if (trade.outcome === 'loss') {
      if (!performance.worstConditions.includes(condition)) {
        performance.worstConditions.push(condition);
      }

      const bestIndex = performance.bestConditions.indexOf(condition);
      if (bestIndex !== -1) {
        performance.bestConditions.splice(bestIndex, 1);
      }
    }

    if (performance.bestConditions.length > 5) {
      performance.bestConditions = performance.bestConditions.slice(0, 5);
    }

    if (performance.worstConditions.length > 5) {
      performance.worstConditions = performance.worstConditions.slice(0, 5);
    }
  }

  private extractCondition(trade: TradeMemory): string {
    const conditions: string[] = [];

    conditions.push(trade.entryMarketConditions.trend);
    
    if (trade.entryMarketConditions.volumeRatio > 1.5) {
      conditions.push('high_volume');
    } else if (trade.entryMarketConditions.volumeRatio < 0.5) {
      conditions.push('low_volume');
    }

    if (trade.entryMarketConditions.volatility > 2) {
      conditions.push('high_volatility');
    } else if (trade.entryMarketConditions.volatility < 0.5) {
      conditions.push('low_volatility');
    }

    return conditions.join('_');
  }

  private updateRanking(): void {
    const symbols = Array.from(this.intelligence.symbolPerformance.keys());
    this.intelligence.symbolRanking = symbols
      .map(symbol => {
        const perf = this.intelligence.symbolPerformance.get(symbol)!;
        return {
          symbol,
          score: perf.winRate * 0.6 + (perf.avgROE > 0 ? Math.min(perf.avgROE / 10, 0.4) : 0),
        };
      })
      .sort((a, b) => b.score - a.score)
      .map(s => s.symbol);
  }
}

