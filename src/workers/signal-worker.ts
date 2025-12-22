/**
 * Signal Worker
 * Processes signal scanning jobs from the queue
 */

import { Worker, Job } from 'bullmq';
import {
  QUEUE_NAMES,
  getRedisConnection,
  SignalScanJobData,
  addExecuteOrderJob,
} from '../queues';
import { config, loadScalperConfig, loadCoinList } from '../config';
import { generateSignal, getQualifyingSignals } from '../services/signal';
import { AsterClient } from '../services/execution';
import { workerLogger } from '../utils/logger';
import { jobsProcessed, jobDuration, agentTicks } from '../utils/metrics';

// =============================================================================
// WORKER CONFIGURATION
// =============================================================================

const WORKER_NAME = 'signal-worker';
const CONCURRENCY = parseInt(process.env.SIGNAL_WORKER_CONCURRENCY || '5');

// =============================================================================
// STATE MANAGEMENT (In-memory for this worker, could be Redis)
// =============================================================================

interface AgentSignalState {
  lastScanTime: number;
  tickCount: number;
  activeSignals: Map<string, number>; // symbol -> timestamp
}

const agentStates = new Map<string, AgentSignalState>();

function getAgentState(agentId: string): AgentSignalState {
  if (!agentStates.has(agentId)) {
    agentStates.set(agentId, {
      lastScanTime: 0,
      tickCount: 0,
      activeSignals: new Map(),
    });
  }
  return agentStates.get(agentId)!;
}

// =============================================================================
// JOB PROCESSOR
// =============================================================================

async function processSignalScan(job: Job<SignalScanJobData>): Promise<void> {
  const startTime = Date.now();
  const { agentId, userId, symbols, configOverrides } = job.data;

  workerLogger.info({ agentId, symbolCount: symbols.length }, 'Starting signal scan');

  try {
    // Load configuration
    const scalperConfig = {
      ...loadScalperConfig(),
      ...configOverrides,
    };

    // Build coin config map
    const coinList = loadCoinList();
    const coinConfigs = new Map(coinList.map((c) => [c.symbol, c]));

    // Filter to requested symbols
    const symbolsToScan = symbols.length > 0 ? symbols : coinList.map((c) => c.symbol);

    // Create exchange client (using default credentials for market data)
    const client = new AsterClient();

    // Fetch klines for all symbols
    const klinesMap = new Map<string, any[]>();
    for (const symbol of symbolsToScan) {
      try {
        const klines = await client.getKlines(symbol, scalperConfig.klineInterval, scalperConfig.klineCount);
        klinesMap.set(symbol, klines);
      } catch (error: any) {
        workerLogger.warn({ symbol, error: error.message }, 'Failed to fetch klines');
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Generate signals
    const scanResults = [];
    for (const [symbol, klines] of klinesMap) {
      const coinConfig = coinConfigs.get(symbol);
      const result = await generateSignal(symbol, klines, scalperConfig, coinConfig, agentId);
      scanResults.push({ symbol, result });
    }

    // Get qualifying signals
    const qualifyingSignals = getQualifyingSignals(scanResults);

    workerLogger.info(
      {
        agentId,
        scanned: symbolsToScan.length,
        signals: qualifyingSignals.length,
        elapsed: Date.now() - startTime,
      },
      `Signal scan complete: ${qualifyingSignals.length} signals found`
    );

    // Queue execution jobs for qualifying signals
    for (const signal of qualifyingSignals) {
      // Check if we already have a recent signal for this symbol
      const state = getAgentState(agentId);
      const lastSignalTime = state.activeSignals.get(signal.symbol) || 0;
      const timeSinceLastSignal = Date.now() - lastSignalTime;

      // Prevent duplicate signals within 60 seconds
      if (timeSinceLastSignal < 60000) {
        workerLogger.debug({ symbol: signal.symbol }, 'Skipping duplicate signal');
        continue;
      }

      // Note: In production, you'd fetch credentials from database
      // For now, we'll just log that a signal was generated
      workerLogger.info(
        {
          agentId,
          symbol: signal.symbol,
          direction: signal.type,
          confidence: signal.confidence,
        },
        'Signal ready for execution'
      );

      // Mark signal as active
      state.activeSignals.set(signal.symbol, Date.now());

      // In full implementation, would add to execution queue:
      // await addExecuteOrderJob({
      //   agentId,
      //   userId,
      //   signal: {
      //     id: signal.id,
      //     symbol: signal.symbol,
      //     type: signal.type as 'LONG' | 'SHORT',
      //     confidence: signal.confidence,
      //     reasons: signal.reasons,
      //   },
      //   credentials: { apiKey: '...', secretKey: '...' },
      // });
    }

    // Update state
    const state = getAgentState(agentId);
    state.lastScanTime = Date.now();
    state.tickCount++;

    // Metrics
    agentTicks.inc({ agent_id: agentId });
    jobDuration.observe({ worker: WORKER_NAME, job_type: 'signal_scan' }, Date.now() - startTime);
    jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'signal_scan', status: 'completed' });
  } catch (error: any) {
    workerLogger.error({ agentId, error: error.message }, 'Signal scan failed');
    jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'signal_scan', status: 'failed' });
    throw error;
  }
}

// =============================================================================
// WORKER SETUP
// =============================================================================

export function createSignalWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.SIGNAL_SCAN,
    processSignalScan,
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      limiter: {
        max: 50,
        duration: 1000, // Max 50 jobs per second
      },
    }
  );

  worker.on('completed', (job) => {
    workerLogger.debug({ jobId: job.id }, 'Signal scan job completed');
  });

  worker.on('failed', (job, error) => {
    workerLogger.error({ jobId: job?.id, error: error.message }, 'Signal scan job failed');
  });

  worker.on('error', (error) => {
    workerLogger.error({ error: error.message }, 'Signal worker error');
  });

  workerLogger.info({ concurrency: CONCURRENCY }, 'Signal worker started');

  return worker;
}

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
  const worker = createSignalWorker();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    workerLogger.info('Received SIGTERM, shutting down...');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    workerLogger.info('Received SIGINT, shutting down...');
    await worker.close();
    process.exit(0);
  });
}

export default createSignalWorker;
