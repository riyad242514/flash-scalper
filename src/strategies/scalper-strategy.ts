/**
 * Scalper Strategy - Standalone Runner
 * Runs the complete scalping strategy in a single process
 * (For development/testing or single-agent deployment)
 */

import { v4 as uuidv4 } from 'uuid';
import { config, loadScalperConfig, loadCoinList } from '../config';
import { AsterClient } from '../services/execution';
import { generateSignal, getQualifyingSignals } from '../services/signal';
import { executeOrder, closePosition, calculateExposure } from '../services/execution';
import { updatePosition, syncPositions, checkDailyLimits, checkDailyReset, monitorPositions } from '../services/position';
import { logger, logTick } from '../utils/logger';
import { updateAgentMetrics, agentStatus } from '../utils/metrics';
import type { Position, AgentState, ScalperConfig, CoinConfig } from '../types';
import { ArtifactManager } from '../services/artifacts/artifact-manager';
import { loadArtifactConfig } from '../config';
import { MemoryManager } from '../services/memory/memory-manager';
import { calculateAllIndicators } from '../services/signal/technical-analysis';
import { parseKlines } from '../services/signal/technical-analysis';

// =============================================================================
// CONFIGURATION
// =============================================================================

const AGENT_ID = process.env.AGENT_ID || `scalper-${uuidv4().slice(0, 8)}`;
const USER_ID = process.env.USER_ID || 'system';

// =============================================================================
// STATE
// =============================================================================

interface ScalperState extends AgentState {
  positions: Map<string, Position>;
  config: ScalperConfig;
  coinConfigs: Map<string, CoinConfig>;
  client: AsterClient;
  lastSignalRejection?: Map<string, number>; // Track when signals were rejected to prevent spam
  artifactManager?: ArtifactManager; // Artifact collection manager
  memoryManager?: MemoryManager; // Memory system for learning
}

async function initializeState(): Promise<ScalperState> {
  const scalperConfig = loadScalperConfig();
  const coinList = loadCoinList();
  const coinConfigs = new Map(coinList.map((c) => [c.symbol, c]));

  // Create exchange client
  const client = new AsterClient();

  // Get initial balance with retry logic
  let balance;
  try {
    balance = await client.getBalance();
  } catch (error: any) {
    logger.error({ 
      error: error.message,
      message: 'Failed to get initial balance - check API credentials and network connection'
    }, 'Initialization failed');
    throw new Error(`Failed to connect to exchange: ${error.message}`);
  }

  logger.info({
    agentId: AGENT_ID,
    equity: balance.balance,
    coins: coinList.length,
    config: {
      leverage: scalperConfig.leverage,
      positionSizePercent: scalperConfig.positionSizePercent,
      maxPositions: scalperConfig.maxPositions,
      takeProfitROE: scalperConfig.takeProfitROE,
      stopLossROE: scalperConfig.stopLossROE,
    },
  }, 'Scalper initialized');

  // Initialize artifact manager if enabled
  let artifactManager: ArtifactManager | undefined;
  try {
    const artifactConfig = loadArtifactConfig();
    if (artifactConfig.enabled) {
      artifactManager = new ArtifactManager(artifactConfig);
      const version = artifactConfig.version || '1.0.0';
      await artifactManager.initializeRun(AGENT_ID, version);
      await artifactManager.collectConfig(AGENT_ID, scalperConfig, version);
      logger.info({ runId: AGENT_ID, version }, 'Artifact collection initialized');
    }
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Failed to initialize artifact collection - continuing without it');
  }

  // Initialize memory manager if enabled
  let memoryManager: MemoryManager | undefined;
  try {
    const memoryEnabled = config.memory.enabled;
    if (memoryEnabled) {
      memoryManager = new MemoryManager({
        enabled: true,
        tradeHistory: {
          maxTradesInMemory: config.memory.maxTrades,
          persistenceEnabled: config.memory.persistenceEnabled,
          persistencePath: config.memory.persistencePath,
        },
        persistence: {
          enabled: config.memory.persistenceEnabled,
          basePath: config.memory.persistencePath,
          autoSaveInterval: 10000,
          version: config.memory.version || '1.0.0',
        },
      });
      await memoryManager.initialize();
      logger.info({ 
        maxTrades: config.memory.maxTrades,
        persistenceEnabled: config.memory.persistenceEnabled,
      }, 'Memory system initialized');
    }
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Failed to initialize memory system - continuing without it');
  }

  return {
    agentId: AGENT_ID,
    userId: USER_ID,
    status: 'running',
    config: scalperConfig,
    coinConfigs,
    client,
    equity: balance.balance,
    startingEquity: balance.balance,
    dailyStartEquity: balance.balance,
    dailyPnL: 0,
    totalPnL: 0,
    positions: new Map(),
    tickCount: 0,
    lastScanTick: 0,
    lastSyncTick: 0,
    totalTrades: 0,
    winningTrades: 0,
    lastTradeTime: Date.now(),
    lastTickTime: Date.now(),
    lastSignalRejection: new Map<string, number>(), // Track signal rejections for cooldown
    artifactManager,
    memoryManager,
  };
}

// =============================================================================
// MAIN LOOP
// =============================================================================

async function runTick(state: ScalperState): Promise<void> {
  state.tickCount++;
  state.lastTickTime = Date.now();

  try {
    // Check daily reset
    checkDailyReset(state);

    // Update balance
    const balance = await state.client.getBalance();
    state.equity = balance.balance;

    // Monitor existing positions
    if (state.positions.size > 0) {
      const monitorResults = await monitorPositions(
        state.client,
        state.positions,
        state.config,
        AGENT_ID,
        USER_ID,
        state // Pass state for stats updates
      );

      // Update stats for closed positions
      for (const result of monitorResults) {
        if (result.closed && result.closeResult?.realizedPnl !== undefined) {
          state.totalTrades++;
          state.dailyPnL += result.closeResult.realizedPnl;
          state.totalPnL += result.closeResult.realizedPnl;

          if (result.closeResult.realizedPnl > 0) {
            state.winningTrades++;
          }
        }
      }
    }

    // Periodic position sync - imports external positions for management
    const syncInterval = 4; // Every 4 ticks
    if (state.tickCount - state.lastSyncTick >= syncInterval) {
      state.lastSyncTick = state.tickCount;
      const syncResult = await syncPositions(state.client, state.positions, AGENT_ID, state.config);

      if (syncResult.closed.length > 0) {
        logger.info({ closed: syncResult.closed }, 'Positions closed externally');
      }
      if (syncResult.imported.length > 0) {
        logger.info({ imported: syncResult.imported }, 'External positions IMPORTED for management (SL/TP will be applied)');
      }
    }

    // Check risk limits
    const riskCheck = checkDailyLimits(state, state.config);
    if (!riskCheck.canTrade) {
      logger.warn({ reason: riskCheck.reason }, 'Trading paused due to risk limits');
    }

    // Scan for new signals
    const scanInterval = state.config.scanIntervalTicks;
    if (state.tickCount - state.lastScanTick >= scanInterval && riskCheck.canTrade) {
      state.lastScanTick = state.tickCount;

      // Check if we can open more positions
      const currentExposure = calculateExposure(state.positions);
      const canOpenMore = state.positions.size < state.config.maxPositions;

      if (canOpenMore) {
        await scanAndExecute(state, currentExposure);
      }
    }

    // Log status periodically
    const statusInterval = state.config.statusLogInterval || 5;
    if (state.tickCount % statusInterval === 0) {
      const exposure = calculateExposure(state.positions);
      const maxExposure = (state.equity * state.config.maxExposurePercent) / 100;
      const drawdown = ((state.startingEquity - state.equity) / state.startingEquity) * 100;
      const winRate = state.totalTrades > 0 ? (state.winningTrades / state.totalTrades) * 100 : 0;

      logTick(AGENT_ID, {
        tickCount: state.tickCount,
        equity: state.equity,
        exposure,
        maxExposure,
        positionCount: state.positions.size,
        maxPositions: state.config.maxPositions,
        dailyPnL: state.dailyPnL,
        drawdown,
        winRate,
      });

      // Update metrics
      updateAgentMetrics(AGENT_ID, USER_ID, {
        equity: state.equity,
        dailyPnL: state.dailyPnL,
        drawdown,
        winRate: winRate / 100,
        positionCount: state.positions.size,
        exposure,
        unrealizedPnL: balance.unrealizedPnL,
      });
    }
  } catch (error: any) {
    logger.error({ error: error.message, tickCount: state.tickCount }, 'Tick error');
  }
}

async function scanAndExecute(state: ScalperState, currentExposure: number): Promise<void> {
  let symbols = Array.from(state.coinConfigs.keys());

  // Use symbol intelligence to prioritize symbols if memory is enabled
  if (state.memoryManager) {
    const rankedSymbols = state.memoryManager.getRankedSymbols();
    if (rankedSymbols.length > 0) {
      // Prioritize ranked symbols, but keep all symbols in the list
      const rankedSet = new Set(rankedSymbols);
      const unranked = symbols.filter(s => !rankedSet.has(s));
      symbols = [...rankedSymbols, ...unranked];
      logger.debug({ 
        rankedCount: rankedSymbols.length,
        topSymbols: rankedSymbols.slice(0, 5),
      }, 'Symbols prioritized by memory');
    }
  }

  logger.info({ symbolCount: symbols.length }, 'Scanning for signals');

  // Fetch klines for all symbols
  const klinesMap = new Map<string, any[]>();
  for (const symbol of symbols) {
    // Skip if we already have a position
    if (state.positions.has(symbol)) continue;
    
    // Signal cooldown - don't scan same symbol if we just rejected it recently
    if (state.lastSignalRejection) {
      const lastRejectionTime = state.lastSignalRejection.get(symbol);
      const cooldownMs = 2 * 60 * 1000;
      if (lastRejectionTime && (Date.now() - lastRejectionTime) < cooldownMs) {
        continue;
      }
    }

    try {
      const klines = await state.client.getKlines(
        symbol,
        state.config.klineInterval,
        state.config.klineCount
      );
      klinesMap.set(symbol, klines);
    } catch (error: any) {
      // Skip symbols that fail, but log them
      logger.debug({ symbol, error: error.message }, 'Failed to fetch klines for symbol');
    }

    // Rate limiting
    await sleep(state.config.scanDelayMs || 200);
  }

  // Generate signals
  const scanResults = [];
  for (const [symbol, klines] of klinesMap) {
    const coinConfig = state.coinConfigs.get(symbol);
    const result = await generateSignal(symbol, klines, state.config, coinConfig, AGENT_ID, state.memoryManager);
    scanResults.push({ symbol, result });
    
    // Track rejections for cooldown
    if (result.rejected && result.rejectionReason && state.lastSignalRejection) {
      state.lastSignalRejection.set(symbol, Date.now());
    }
  }

  // Get qualifying signals (sorted by confidence)
  const qualifyingSignals = getQualifyingSignals(scanResults);

  if (qualifyingSignals.length === 0) {
    logger.debug('No qualifying signals found');
    return;
  }

  // Correlation filter - avoid trading correlated pairs simultaneously
  const correlatedPairs: Record<string, string[]> = {
    'BTCUSDT': ['ETHUSDT', 'BNBUSDT'],
    'ETHUSDT': ['BTCUSDT', 'BNBUSDT'],
    'BNBUSDT': ['BTCUSDT', 'ETHUSDT'],
  };

  // Filter out signals for correlated pairs if we already have a position
  const filteredSignals = qualifyingSignals.filter(signal => {
    const correlations = correlatedPairs[signal.symbol] || [];
    const hasCorrelatedPosition = correlations.some(corrSymbol => 
      state.positions.has(corrSymbol)
    );
    
    if (hasCorrelatedPosition) {
      logger.debug(
        { symbol: signal.symbol, correlations, existingPositions: Array.from(state.positions.keys()) },
        'Signal filtered: Correlated pair already has position'
      );
      return false;
    }
    return true;
  });

  if (filteredSignals.length === 0) {
    logger.debug('No qualifying signals after correlation filter');
    return;
  }

  logger.info({ 
    signalCount: filteredSignals.length,
    topSignal: {
      symbol: filteredSignals[0].symbol,
      confidence: filteredSignals[0].confidence,
      direction: filteredSignals[0].type,
    }
  }, 'Signals found (ranked by confidence, correlation filtered)');

  // Execute BEST qualifying signal (highest confidence) - let winners run bigger
  const signal = filteredSignals[0];
  
  // Calculate recent win rate for dynamic position sizing
  const recentWinRate = state.totalTrades >= (state.config.recentTradesWindow || 10)
    ? state.winningTrades / state.totalTrades
    : undefined;

  // Double-check we don't have this position already
  if (state.positions.has(signal.symbol)) {
    logger.debug({ symbol: signal.symbol }, 'Position already exists');
    return;
  }

  // Get signal analysis for memory storage
  const signalAnalysis = scanResults.find(s => s.symbol === signal.symbol);
  const analysis = signalAnalysis?.result;
  
  // Get indicators for entry signal storage
  let entryIndicators: any = undefined;
  let entryScore = 0;
  let entryLLMAgreed = false;
  
  if (analysis && analysis.analysis && state.memoryManager) {
    try {
      const klines = klinesMap.get(signal.symbol);
      if (klines) {
        const parsedKlines = parseKlines(klines);
        entryIndicators = calculateAllIndicators(parsedKlines, state.config);
        entryScore = analysis.score?.totalScore || 0;
        entryLLMAgreed = analysis.analysis.llmConfidence > 0 && 
          (analysis.analysis.combinedConfidence > analysis.analysis.llmConfidence);
      }
    } catch (error: any) {
      logger.debug({ symbol: signal.symbol, error: error.message }, 'Failed to get entry indicators');
    }
  }

  // Execute order with recent win rate for dynamic sizing
  logger.debug({ symbol: signal.symbol, direction: signal.type }, 'Attempting to execute order');

  const result = await executeOrder({
    client: state.client,
    signal,
    equity: state.equity,
    currentExposure,
    positionCount: state.positions.size,
    config: state.config,
    agentId: AGENT_ID,
    userId: USER_ID,
    recentWinRate,
    signalAnalysis: entryIndicators ? {
      indicators: entryIndicators,
      score: entryScore,
      llmAgreed: entryLLMAgreed,
    } : undefined,
  });

  if (result.success && result.position) {
    state.positions.set(signal.symbol, result.position);
    state.totalTrades++;
    state.lastTradeTime = Date.now();

    // Store market context for memory system
    if (state.memoryManager && entryIndicators) {
      state.memoryManager.storeContext(
        signal.symbol,
        entryIndicators,
        [] // Recent signals will be populated as trades complete
      );
    }

    logger.info({
      symbol: signal.symbol,
      side: result.position.side,
      size: result.position.size,
      entryPrice: result.position.entryPrice,
    }, 'Position opened');
  } else {
    // Log why order failed
    logger.warn({
      symbol: signal.symbol,
      error: result.error,
      success: result.success,
    }, 'Order execution failed');
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  logger.info(`
╔══════════════════════════════════════════════════════════════╗
║     FLASHSCALPER - MICROSERVICE ARCHITECTURE                ║
║     Multi-tenant scalable trading platform                   ║
╠══════════════════════════════════════════════════════════════╣
║  Agent ID:  ${AGENT_ID.padEnd(45)}║
║  Mode:      Standalone                                       ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Initialize state
  const state = await initializeState();
  currentState = state; // Store for shutdown handler

  // Set agent status
  agentStatus.set({ agent_id: AGENT_ID, status: 'running' }, 1);

  // Main loop
  const tickInterval = state.config.tickIntervalMs;
  logger.info({ tickIntervalMs: tickInterval }, 'Starting main loop');

  try {
    while (state.status === 'running') {
      await runTick(state);
      await sleep(tickInterval);
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error in main loop');
    throw error;
  } finally {
    // Save memory on normal exit
    if (state.memoryManager) {
      try {
        await state.memoryManager.saveMemory();
        logger.info('Memory saved on exit');
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to save memory on exit');
      }
    }

    // Finalize artifacts on normal exit
    if (state.artifactManager) {
      try {
        state.artifactManager.cleanup(); // Stop rotation timer
        const runId = state.artifactManager.getCurrentRunId() || state.agentId;
        await state.artifactManager.collectLogs(runId);
        await state.artifactManager.collectPnLSnapshot(
          runId,
          state,
          state.positions
        );
        await state.artifactManager.finalizeRun(runId);
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to finalize artifacts on exit');
      }
    }

    // Cleanup
    agentStatus.set({ agent_id: AGENT_ID, status: 'stopped' }, 0);
    logger.info('Scalper stopped');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graceful shutdown handler
let shutdownInProgress = false;
let currentState: ScalperState | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    logger.warn('Shutdown already in progress, forcing exit');
    process.exit(1);
  }

  shutdownInProgress = true;
  logger.info({ signal }, 'Received shutdown signal, finalizing artifacts...');

  try {
    if (currentState) {
      currentState.status = 'stopped';
      
      // Finalize artifacts
      if (currentState.artifactManager) {
        try {
          currentState.artifactManager.cleanup(); // Stop rotation timer
          
          const runId = currentState.artifactManager.getCurrentRunId() || currentState.agentId;
          
          // Collect final logs
          await currentState.artifactManager.collectLogs(runId);
          
          // Collect final P&L snapshot
          await currentState.artifactManager.collectPnLSnapshot(
            runId,
            currentState,
            currentState.positions
          );
          
          // Finalize and upload to cloud
          const artifacts = await currentState.artifactManager.finalizeRun(runId);
          
          logger.info(
            { 
              runId: currentState.agentId,
              cloudUrls: artifacts.cloudUrls ? Object.keys(artifacts.cloudUrls).length : 0
            },
            'Artifacts finalized'
          );
        } catch (error: any) {
          logger.error({ error: error.message }, 'Failed to finalize artifacts');
        }
      }
    }

    // Set agent status
    agentStatus.set({ agent_id: AGENT_ID, status: 'stopped' }, 0);
    
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((error) => {
    logger.error({ error: error.message }, 'Shutdown handler error');
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((error) => {
    logger.error({ error: error.message }, 'Shutdown handler error');
    process.exit(1);
  });
});

// Run
main().catch((error) => {
  logger.fatal({ error: error.message }, 'Fatal error');
  process.exit(1);
});

export { main, initializeState, runTick };
