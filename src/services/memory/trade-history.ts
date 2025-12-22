/**
 * Trade History Memory System
 * Stores completed trades with full context for pattern learning
 */

import type { TechnicalIndicators, TrendDirection, Position, Trade } from '../../types';
import { logger } from '../../utils/logger';

export interface TradeMemory {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  realizedROE: number;
  durationMinutes: number;
  
  entryIndicators: TechnicalIndicators;
  entrySignal: {
    confidence: number;
    score: number;
    reasons: string[];
    llmAgreed: boolean;
  };
  entryMarketConditions: {
    trend: TrendDirection;
    volatility: number;
    volumeRatio: number;
    timeOfDay: number;
  };
  
  exitReason: string;
  exitIndicators?: TechnicalIndicators;
  
  outcome: 'win' | 'loss' | 'breakeven';
  winAmount: number;
}

export interface TradeHistoryConfig {
  maxTradesInMemory: number;
  persistenceEnabled: boolean;
  persistencePath?: string;
}

export class TradeHistoryMemory {
  private trades: Map<string, TradeMemory> = new Map();
  private tradesBySymbol: Map<string, TradeMemory[]> = new Map();
  private tradesByTime: TradeMemory[] = [];
  private config: TradeHistoryConfig;

  constructor(config: TradeHistoryConfig) {
    this.config = config;
  }

  /**
   * Store a completed trade in memory
   */
  storeTrade(
    position: Position,
    trade: Trade,
    entryIndicators: TechnicalIndicators,
    entrySignal: {
      confidence: number;
      score: number;
      reasons: string[];
      llmAgreed: boolean;
    },
    exitReason: string,
    exitIndicators?: TechnicalIndicators
  ): void {
    const realizedPnl = trade.realizedPnl || 0;
    const marginUsed = position.marginUsed || 0;
    const realizedROE = marginUsed > 0 ? (realizedPnl / marginUsed) * 100 : 0;
    const exitTime = trade.executedAt;
    const entryTime = position.openedAt;
    const durationMinutes = (exitTime - entryTime) / 60000;

    const outcome: 'win' | 'loss' | 'breakeven' = 
      realizedPnl > 0.01 ? 'win' : 
      realizedPnl < -0.01 ? 'loss' : 
      'breakeven';

    const tradeMemory: TradeMemory = {
      id: trade.id,
      symbol: position.symbol,
      side: position.side,
      entryTime,
      exitTime,
      entryPrice: position.entryPrice,
      exitPrice: trade.price,
      realizedPnl,
      realizedROE,
      durationMinutes,
      entryIndicators,
      entrySignal,
      entryMarketConditions: {
        trend: entryIndicators.trend,
        volatility: entryIndicators.atr || 0,
        volumeRatio: entryIndicators.volumeRatio,
        timeOfDay: new Date(entryTime).getUTCHours(),
      },
      exitReason,
      exitIndicators,
      outcome,
      winAmount: outcome === 'win' ? realizedPnl : 0,
    };

    this.trades.set(trade.id, tradeMemory);
    
    if (!this.tradesBySymbol.has(position.symbol)) {
      this.tradesBySymbol.set(position.symbol, []);
    }
    this.tradesBySymbol.get(position.symbol)!.push(tradeMemory);
    
    this.tradesByTime.push(tradeMemory);
    this.tradesByTime.sort((a, b) => b.exitTime - a.exitTime);

    this.pruneOldTrades();

    logger.debug(
      { 
        tradeId: trade.id, 
        symbol: position.symbol, 
        outcome, 
        pnl: realizedPnl,
        totalTrades: this.trades.size 
      },
      'Trade stored in memory'
    );
  }

  /**
   * Get trade by ID
   */
  getTrade(tradeId: string): TradeMemory | undefined {
    return this.trades.get(tradeId);
  }

  /**
   * Get all trades for a symbol
   */
  getTradesBySymbol(symbol: string): TradeMemory[] {
    return this.tradesBySymbol.get(symbol) || [];
  }

  /**
   * Get recent trades (most recent first)
   */
  getRecentTrades(limit: number = 100): TradeMemory[] {
    return this.tradesByTime.slice(0, limit);
  }

  /**
   * Get all trades
   */
  getAllTrades(): TradeMemory[] {
    return Array.from(this.trades.values());
  }

  /**
   * Get trades by outcome
   */
  getTradesByOutcome(outcome: 'win' | 'loss' | 'breakeven'): TradeMemory[] {
    return Array.from(this.trades.values()).filter(t => t.outcome === outcome);
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalTrades: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number;
    avgROE: number;
    totalPnL: number;
  } {
    const allTrades = Array.from(this.trades.values());
    const wins = allTrades.filter(t => t.outcome === 'win').length;
    const losses = allTrades.filter(t => t.outcome === 'loss').length;
    const breakevens = allTrades.filter(t => t.outcome === 'breakeven').length;
    const totalTrades = allTrades.length;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const avgROE = totalTrades > 0 
      ? allTrades.reduce((sum, t) => sum + t.realizedROE, 0) / totalTrades 
      : 0;
    const totalPnL = allTrades.reduce((sum, t) => sum + t.realizedPnl, 0);

    return {
      totalTrades,
      wins,
      losses,
      breakevens,
      winRate,
      avgROE,
      totalPnL,
    };
  }

  /**
   * Prune old trades to maintain memory limit
   */
  private pruneOldTrades(): void {
    if (this.tradesByTime.length <= this.config.maxTradesInMemory) {
      return;
    }

    const toRemove = this.tradesByTime.slice(this.config.maxTradesInMemory);
    
    for (const trade of toRemove) {
      this.trades.delete(trade.id);
      
      const symbolTrades = this.tradesBySymbol.get(trade.symbol);
      if (symbolTrades) {
        const index = symbolTrades.findIndex(t => t.id === trade.id);
        if (index !== -1) {
          symbolTrades.splice(index, 1);
        }
        if (symbolTrades.length === 0) {
          this.tradesBySymbol.delete(trade.symbol);
        }
      }
    }

    this.tradesByTime = this.tradesByTime.slice(0, this.config.maxTradesInMemory);
  }

  /**
   * Clear all trades (for testing)
   */
  clear(): void {
    this.trades.clear();
    this.tradesBySymbol.clear();
    this.tradesByTime = [];
  }

  /**
   * Get memory size
   */
  getSize(): number {
    return this.trades.size;
  }
}
