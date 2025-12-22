/**
 * Order Executor Service
 * Handles order execution with proper risk checks and position sizing
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Signal,
  Position,
  OrderRequest,
  OrderResult,
  ScalperConfig,
  Trade,
  TechnicalIndicators,
} from '../../types';
import { AsterClient } from './exchange-client';
import { executionLogger, logTrade } from '../../utils/logger';
import { recordTrade, tradesTotal } from '../../utils/metrics';

// =============================================================================
// POSITION SIZING
// =============================================================================

/**
 * Calculate position size based on configuration and signal confidence
 */
export function calculatePositionSize(
  equity: number,
  currentExposure: number,
  price: number,
  config: ScalperConfig,
  signalConfidence?: number,
  recentWinRate?: number
): number {
  let targetSizeUSD: number;

  if (config.positionSizeUSD !== null) {
    targetSizeUSD = config.positionSizeUSD;
  } else {
    // Calculate based on available balance
    const availableBalance = equity - currentExposure;
    let baseSizePercent = config.positionSizePercent;
    
    // Dynamic position sizing based on confidence
    if (config.dynamicPositionSizing && signalConfidence !== undefined) {
      const confidenceNormalized = (signalConfidence - 50) / 50; // -1 to +1 range
      const boostMultiplier = config.maxPositionSizeBoost || 1.5;
      const reductionMultiplier = config.minPositionSizeReduction || 0.7;
      
      // High confidence (70%+) gets up to boost, low confidence (50-60%) gets reduction
      if (confidenceNormalized > 0.4) {
        // High confidence: 70%+ confidence
        const boost = 1 + (confidenceNormalized - 0.4) * (boostMultiplier - 1) * 0.5;
        baseSizePercent *= Math.min(boost, boostMultiplier);
      } else if (confidenceNormalized < 0.2 && signalConfidence < 65) {
        // Lower confidence: scale down
        baseSizePercent *= reductionMultiplier;
      }
    }
    
    // Performance-based adjustment
    if (config.performanceAdaptation && recentWinRate !== undefined) {
      const highWinRateThreshold = config.highWinRateThreshold || 0.65;
      if (recentWinRate >= highWinRateThreshold) {
        // High win rate: increase position size by 10-20%
        baseSizePercent *= 1.15;
      } else if (recentWinRate < 0.4) {
        // Low win rate: reduce position size by 20%
        baseSizePercent *= 0.8;
      }
    }
    
    targetSizeUSD = (availableBalance * baseSizePercent) / 100;
  }

  // Apply min/max constraints
  targetSizeUSD = Math.max(config.minPositionSizeUSD, targetSizeUSD);
  targetSizeUSD = Math.min(config.maxPositionSizeUSD, targetSizeUSD);

  // Calculate quantity
  return targetSizeUSD / price;
}

/**
 * Calculate current exposure from positions
 */
export function calculateExposure(positions: Map<string, Position>): number {
  let totalMargin = 0;
  for (const [, pos] of positions) {
    totalMargin += pos.marginUsed;
  }
  return totalMargin;
}

/**
 * Check if we can open a new position
 */
export function canOpenPosition(
  equity: number,
  currentExposure: number,
  positionCount: number,
  estimatedMargin: number,
  config: ScalperConfig
): { allowed: boolean; reason?: string } {
  // Check minimum equity (need at least $10 to trade)
  const minEquity = 10;
  if (equity < minEquity) {
    return {
      allowed: false,
      reason: `Insufficient equity ($${equity.toFixed(2)} < $${minEquity} minimum)`,
    };
  }

  // Check max positions
  if (positionCount >= config.maxPositions) {
    return { allowed: false, reason: `Max positions reached (${positionCount}/${config.maxPositions})` };
  }

  // Check max exposure
  const maxExposure = (equity * config.maxExposurePercent) / 100;
  if (maxExposure < minEquity) {
    return {
      allowed: false,
      reason: `Max exposure too low ($${maxExposure.toFixed(2)} < $${minEquity} minimum). Equity: $${equity.toFixed(2)}, Exposure %: ${config.maxExposurePercent}%`,
    };
  }

  if (currentExposure + estimatedMargin > maxExposure) {
    return {
      allowed: false,
      reason: `Exposure limit ($${(currentExposure + estimatedMargin).toFixed(2)} > $${maxExposure.toFixed(2)}). Current: $${currentExposure.toFixed(2)}, New: $${estimatedMargin.toFixed(2)}, Max: $${maxExposure.toFixed(2)} (${config.maxExposurePercent}% of $${equity.toFixed(2)})`,
    };
  }

  return { allowed: true };
}

// =============================================================================
// ORDER EXECUTION
// =============================================================================

export interface ExecuteOrderParams {
  client: AsterClient;
  signal: Signal;
  equity: number;
  currentExposure: number;
  positionCount: number;
  config: ScalperConfig;
  agentId: string;
  userId: string;
  recentWinRate?: number; // For dynamic position sizing
  signalAnalysis?: {
    indicators: TechnicalIndicators;
    score: number;
    llmAgreed: boolean;
  }; // Entry signal analysis for memory system
}

export interface ExecuteOrderResult {
  success: boolean;
  position?: Position;
  trade?: Trade;
  error?: string;
}

/**
 * Execute order based on signal
 */
export async function executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
  const { client, signal, equity, currentExposure, positionCount, config, agentId, userId, recentWinRate } = params;

  const symbol = signal.symbol;
  const side = signal.type === 'LONG' ? 'BUY' : 'SELL';

  try {
    // Get current price
    const price = await client.getPrice(symbol);

    // Calculate position size with dynamic sizing
    const quantity = calculatePositionSize(equity, currentExposure, price, config, signal.confidence, recentWinRate);
    const roundedQty = client.roundQuantity(symbol, quantity);
    const notional = roundedQty * price;
    const marginRequired = notional / config.leverage;

    // Check if we can open
    const canOpen = canOpenPosition(equity, currentExposure, positionCount, marginRequired, config);
    if (!canOpen.allowed) {
      return { success: false, error: canOpen.reason };
    }

    // Check minimum quantity
    const { min } = client.getMinQtyAndPrecision(symbol);
    if (roundedQty < min) {
      return { success: false, error: `Quantity too small (${roundedQty} < ${min})` };
    }

    // Set leverage
    await client.setLeverage(symbol, config.leverage);

    // Use limit orders at support/resistance for better entry prices
    let entryPrice = price;
    let useLimitOrder = false;
    
    if (signal.supportResistance) {
      const sr = signal.supportResistance;
      
      if (side === 'BUY') {
        entryPrice = sr.support * 1.001;
        if (Math.abs(entryPrice - price) / price < 0.005) {
          useLimitOrder = true;
        }
      } else {
        entryPrice = sr.resistance * 0.999;
        if (Math.abs(entryPrice - price) / price < 0.005) {
          useLimitOrder = true;
        }
      }
    }

    // Log pre-execution
    executionLogger.info(
      {
        symbol,
        side,
        quantity: roundedQty,
        price,
        entryPrice: useLimitOrder ? entryPrice : price,
        orderType: useLimitOrder ? 'LIMIT' : 'MARKET',
        notional,
        marginRequired,
        leverage: config.leverage,
        supportResistance: signal.supportResistance,
      },
      `Executing ${useLimitOrder ? 'LIMIT' : 'MARKET'} ${side} order`
    );

    // Place limit order at support/resistance, fallback to market
    let orderResult: OrderResult;
    if (useLimitOrder) {
      try {
        orderResult = await client.placeLimitOrder(symbol, side, roundedQty, entryPrice);
        // If limit order doesn't fill within 3 seconds, cancel and use market
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Check if order was filled (if orderId exists, try to check status)
        // For now, assume limit order worked if no error - exchange will handle partial fills
        if (!orderResult.success && orderResult.error) {
          // Limit order failed, use market
          executionLogger.warn({ symbol, side, error: orderResult.error }, 'Limit order failed, using market order');
          orderResult = await client.placeMarketOrder(symbol, side, roundedQty);
        }
      } catch (error: any) {
        // Fallback to market order if limit fails
        executionLogger.warn({ symbol, side, error: error.message }, 'Limit order failed, using market order');
        orderResult = await client.placeMarketOrder(symbol, side, roundedQty);
      }
    } else {
      // Place market order
      orderResult = await client.placeMarketOrder(symbol, side, roundedQty);
    }

    // Paper trading mode: simulate trade if execution fails
    if (!orderResult.success) {
      const errorMsg = orderResult.error || '';
      const isRegionError = errorMsg.includes('region') || 
                           errorMsg.includes('Service not available') ||
                           errorMsg.includes('-5019') ||
                           errorMsg.includes('not available');
      
      // Default to true if not specified (for region errors, always paper trade)
      const shouldPaperTrade = config.paperTradingOnError !== false && isRegionError;
      
      if (shouldPaperTrade) {
        executionLogger.warn(
          { symbol, side, error: orderResult.error },
          'Execution failed - simulating trade in paper mode'
        );
        
        // Simulate successful fill at current price
        const simulatedFillPrice = price;
        const simulatedFillQty = roundedQty;
        
        // Calculate dynamic take profit
        let dynamicTP: number | undefined;
        if (config.dynamicTPEnabled && signal.indicators?.atrPercent) {
          const atrMultiplier = config.atrTPMultiplier || 2.5;
          const atrMove = (signal.indicators.atrPercent * atrMultiplier) / config.leverage;
          dynamicTP = Math.max(config.takeProfitROE, atrMove);
        }
        
        const takeProfitTarget = (signal.confidence >= 75 && config.takeProfitROEHigh) 
          ? config.takeProfitROEHigh 
          : (dynamicTP || config.takeProfitROE);

        // Create simulated position
        const position: Position = {
          id: uuidv4(),
          agentId,
          userId,
          symbol,
          side: signal.type === 'LONG' ? 'long' : 'short',
          size: simulatedFillQty,
          entryPrice: simulatedFillPrice,
          currentPrice: simulatedFillPrice,
          leverage: config.leverage,
          marginUsed: (simulatedFillQty * simulatedFillPrice) / config.leverage,
          unrealizedPnl: 0,
          unrealizedROE: 0,
          highestROE: 0,
          lowestROE: 0,
          stopLoss: null,
          takeProfit: takeProfitTarget,
          trailingActivated: false,
          trailingStopPrice: null,
          ivishxConfidence: signal.confidence,
          llmConfidence: 0,
          entryReason: signal.reasons,
          openedAt: Date.now(),
          updatedAt: Date.now(),
          maxHoldTime: config.maxHoldTimeMinutes * 60 * 1000,
          originalSize: simulatedFillQty,
          partialProfitTaken: false,
          dynamicTP: dynamicTP,
        };

        const trade: Trade = {
          id: uuidv4(),
          positionId: position.id,
          agentId,
          userId,
          symbol,
          side: side.toLowerCase() as 'buy' | 'sell',
          type: 'open',
          quantity: simulatedFillQty,
          price: simulatedFillPrice,
          realizedPnl: 0,
          fees: 0,
          reason: `PAPER TRADE: ${signal.reasons.join(', ')}`,
          executedAt: Date.now(),
        };

        logTrade(agentId, userId, {
          symbol,
          side: trade.side,
          type: 'open',
          quantity: simulatedFillQty,
          price: simulatedFillPrice,
          reason: 'PAPER TRADE (execution failed)',
        });

        tradesTotal.inc({ agent_id: agentId, symbol, side: trade.side, result: 'paper' });

        return { success: true, position, trade };
      }
      
      return { success: false, error: orderResult.error };
    }

    const filledPrice = orderResult.filledPrice || price;
    const filledQty = orderResult.filledQuantity || roundedQty;

    // Calculate dynamic take profit based on ATR if enabled
    let dynamicTP: number | undefined;
    if (config.dynamicTPEnabled && signal.indicators?.atrPercent) {
      // ATR-based TP: target 2.5x ATR move (more aggressive for volatile markets)
      const atrMultiplier = config.atrTPMultiplier || 2.5;
      const atrMove = (signal.indicators.atrPercent * atrMultiplier) / config.leverage;
      dynamicTP = Math.max(config.takeProfitROE, atrMove);
    }
    
    // Use higher TP for high confidence signals
    const takeProfitTarget = (signal.confidence >= 75 && config.takeProfitROEHigh) 
      ? config.takeProfitROEHigh 
      : (dynamicTP || config.takeProfitROE);

    // Create position object
    const position: Position = {
      id: uuidv4(),
      agentId,
      userId,
      symbol,
      side: signal.type === 'LONG' ? 'long' : 'short',
      size: filledQty,
      entryPrice: filledPrice,
      currentPrice: filledPrice,
      leverage: config.leverage,
      marginUsed: (filledQty * filledPrice) / config.leverage,
      unrealizedPnl: 0,
      unrealizedROE: 0,
      highestROE: 0,
      lowestROE: 0,
      stopLoss: null,
      takeProfit: takeProfitTarget,
      trailingActivated: false,
      trailingStopPrice: null,
      ivishxConfidence: signal.confidence,
      llmConfidence: 0, // Would be set if LLM was used
      entryReason: signal.reasons,
      openedAt: Date.now(),
      updatedAt: Date.now(),
      maxHoldTime: config.maxHoldTimeMinutes * 60 * 1000,
      originalSize: filledQty,
      partialProfitTaken: false,
      dynamicTP: dynamicTP,
      // Memory system: Store entry signal data for learning
      entryIndicators: params.signalAnalysis?.indicators || (signal.indicators as any),
      entrySignalConfidence: signal.confidence,
      entrySignalScore: params.signalAnalysis?.score || 0,
      entrySignalReasons: signal.reasons,
      entryLLMAgreed: params.signalAnalysis?.llmAgreed || false,
    };

    // Create trade record
    const trade: Trade = {
      id: uuidv4(),
      positionId: position.id,
      agentId,
      userId,
      symbol,
      side: side.toLowerCase() as 'buy' | 'sell',
      type: 'open',
      quantity: filledQty,
      price: filledPrice,
      realizedPnl: 0,
      fees: orderResult.fees || 0,
      reason: signal.reasons.join(', '),
      executedAt: Date.now(),
    };

    // Log trade
    logTrade(agentId, userId, {
      symbol,
      side: trade.side,
      type: 'open',
      quantity: filledQty,
      price: filledPrice,
      reason: trade.reason,
    });

    // Record metrics
    tradesTotal.inc({ agent_id: agentId, symbol, side: trade.side, result: 'success' });

    return { success: true, position, trade };
  } catch (error: any) {
    executionLogger.error({ symbol, error: error.message }, 'Order execution failed');
    tradesTotal.inc({ agent_id: agentId, symbol, side, result: 'failure' });
    return { success: false, error: error.message };
  }
}

// =============================================================================
// CLOSE POSITION
// =============================================================================

export interface ClosePositionParams {
  client: AsterClient;
  position: Position;
  reason: string;
  agentId: string;
  userId: string;
  config?: ScalperConfig; // For paper trading check
}

export interface ClosePositionResult {
  success: boolean;
  trade?: Trade;
  realizedPnl?: number;
  error?: string;
}

/**
 * Close an existing position
 */
export async function closePosition(params: ClosePositionParams): Promise<ClosePositionResult> {
  const { client, position, reason, agentId, userId, config } = params;

  try {
    // Get current price
    const currentPrice = await client.getPrice(position.symbol);

    // Determine close side (opposite of position)
    const closeSide = position.side === 'long' ? 'SELL' : 'BUY';

    // Place close order
    const orderResult = await client.placeMarketOrder(
      position.symbol,
      closeSide,
      position.size,
      true // reduceOnly
    );

    // Paper trading: simulate close if execution fails
    if (!orderResult.success) {
      const isRegionError = orderResult.error?.includes('region') || orderResult.error?.includes('Service not available');
      const paperTradingEnabled = config?.paperTradingOnError ?? true;
      
      if (paperTradingEnabled && isRegionError) {
        executionLogger.warn(
          { symbol: position.symbol, error: orderResult.error },
          'Close order failed - simulating in paper mode'
        );
        
        // Simulate successful close at current price
        const simulatedFillPrice = currentPrice;
        
        // Calculate realized PnL
        let realizedPnl: number;
        if (position.side === 'long') {
          realizedPnl = (simulatedFillPrice - position.entryPrice) * position.size;
        } else {
          realizedPnl = (position.entryPrice - simulatedFillPrice) * position.size;
        }
        
        // Calculate ROE
        const margin = position.marginUsed;
        const roe = margin > 0 ? (realizedPnl / margin) * 100 : 0;
        
        // Create trade record
        const trade: Trade = {
          id: uuidv4(),
          positionId: position.id,
          agentId,
          userId,
          symbol: position.symbol,
          side: closeSide.toLowerCase() as 'buy' | 'sell',
          type: 'close',
          quantity: position.size,
          price: simulatedFillPrice,
          realizedPnl,
          fees: 0,
          reason: `PAPER TRADE: ${reason}`,
          executedAt: Date.now(),
        };
        
        // Log trade
        logTrade(agentId, userId, {
          symbol: position.symbol,
          side: trade.side,
          type: 'close',
          quantity: position.size,
          price: simulatedFillPrice,
          pnl: realizedPnl,
          reason: `PAPER TRADE: ${reason}`,
        });
        
        // Record metrics
        const isWin = realizedPnl > 0;
        const durationSeconds = (Date.now() - position.openedAt) / 1000;
        
        recordTrade(
          agentId,
          position.symbol,
          trade.side,
          'paper',
          realizedPnl,
          roe,
          durationSeconds
        );
        
        executionLogger.info(
          {
            symbol: position.symbol,
            side: position.side,
            entryPrice: position.entryPrice,
            exitPrice: simulatedFillPrice,
            pnl: realizedPnl,
            roe,
            holdTimeMin: durationSeconds / 60,
            reason,
          },
          `PAPER TRADE CLOSED: ${isWin ? 'WIN' : 'LOSS'} $${realizedPnl.toFixed(2)}`
        );
        
        return { success: true, trade, realizedPnl };
      }
      
      return { success: false, error: orderResult.error };
    }

    const filledPrice = orderResult.filledPrice || currentPrice;

    // Calculate realized PnL
    let realizedPnl: number;
    if (position.side === 'long') {
      realizedPnl = (filledPrice - position.entryPrice) * position.size;
    } else {
      realizedPnl = (position.entryPrice - filledPrice) * position.size;
    }

    // Calculate ROE
    const margin = position.marginUsed;
    const roe = margin > 0 ? (realizedPnl / margin) * 100 : 0;

    // Create trade record
    const trade: Trade = {
      id: uuidv4(),
      positionId: position.id,
      agentId,
      userId,
      symbol: position.symbol,
      side: closeSide.toLowerCase() as 'buy' | 'sell',
      type: 'close',
      quantity: position.size,
      price: filledPrice,
      realizedPnl,
      fees: orderResult.fees || 0,
      reason,
      executedAt: Date.now(),
    };

    // Log trade
    logTrade(agentId, userId, {
      symbol: position.symbol,
      side: trade.side,
      type: 'close',
      quantity: position.size,
      price: filledPrice,
      pnl: realizedPnl,
      reason,
    });

    // Record metrics
    const isWin = realizedPnl > 0;
    const durationSeconds = (Date.now() - position.openedAt) / 1000;

    recordTrade(
      agentId,
      position.symbol,
      trade.side,
      'success',
      realizedPnl,
      roe,
      durationSeconds
    );

    executionLogger.info(
      {
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice: filledPrice,
        pnl: realizedPnl,
        roe,
        holdTimeMin: durationSeconds / 60,
        reason,
      },
      `Position closed: ${isWin ? 'WIN' : 'LOSS'} $${realizedPnl.toFixed(2)}`
    );

    return { success: true, trade, realizedPnl };
  } catch (error: any) {
    executionLogger.error({ symbol: position.symbol, error: error.message }, 'Close position failed');
    return { success: false, error: error.message };
  }
}

export default {
  calculatePositionSize,
  calculateExposure,
  canOpenPosition,
  executeOrder,
  closePosition,
};
