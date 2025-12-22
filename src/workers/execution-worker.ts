/**
 * Execution Worker
 * Processes order execution jobs from the queue
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import {
  QUEUE_NAMES,
  getRedisConnection,
  ExecuteOrderJobData,
} from '../queues';
import { config, loadScalperConfig } from '../config';
import { AsterClient, executeOrder, calculateExposure } from '../services/execution';
import { workerLogger } from '../utils/logger';
import { jobsProcessed, jobDuration } from '../utils/metrics';
import type { Position, Signal } from '../types';

// =============================================================================
// WORKER CONFIGURATION
// =============================================================================

const WORKER_NAME = 'execution-worker';
const CONCURRENCY = parseInt(process.env.EXECUTION_WORKER_CONCURRENCY || '3');

// Redis client for state management
let stateRedis: Redis | null = null;

function getStateRedis(): Redis {
  if (!stateRedis) {
    stateRedis = new Redis(config.redisUrl);
  }
  return stateRedis;
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

interface AgentExecutionState {
  equity: number;
  positions: Record<string, Position>;
  lastUpdate: number;
}

async function getAgentState(agentId: string): Promise<AgentExecutionState | null> {
  const redis = getStateRedis();
  const stateKey = `agent:${agentId}:state`;
  const stateJson = await redis.get(stateKey);

  if (!stateJson) return null;

  try {
    return JSON.parse(stateJson);
  } catch {
    return null;
  }
}

async function saveAgentState(agentId: string, state: AgentExecutionState): Promise<void> {
  const redis = getStateRedis();
  const stateKey = `agent:${agentId}:state`;
  await redis.setex(stateKey, 3600, JSON.stringify(state)); // 1 hour TTL
}

async function savePosition(agentId: string, position: Position): Promise<void> {
  const redis = getStateRedis();
  const positionKey = `agent:${agentId}:position:${position.symbol}`;
  await redis.setex(positionKey, 7200, JSON.stringify(position)); // 2 hour TTL
}

// =============================================================================
// JOB PROCESSOR
// =============================================================================

async function processExecuteOrder(job: Job<ExecuteOrderJobData>): Promise<void> {
  const startTime = Date.now();
  const { agentId, userId, signal, credentials } = job.data;

  workerLogger.info(
    {
      agentId,
      symbol: signal.symbol,
      direction: signal.type,
      confidence: signal.confidence,
    },
    'Processing order execution'
  );

  try {
    // Create exchange client with user credentials
    const client = new AsterClient({
      apiKey: credentials.apiKey,
      secretKey: credentials.secretKey,
    });

    // Load configuration
    const scalperConfig = loadScalperConfig();

    // Get current balance
    const balance = await client.getBalance();
    const equity = balance.balance;

    // Get agent state or initialize
    let state = await getAgentState(agentId);
    if (!state) {
      state = {
        equity,
        positions: {},
        lastUpdate: Date.now(),
      };
    }

    // Calculate current exposure
    const positionsMap = new Map(Object.entries(state.positions));
    const currentExposure = calculateExposure(positionsMap);
    const positionCount = positionsMap.size;

    // Check if we already have a position in this symbol
    if (state.positions[signal.symbol]) {
      workerLogger.info({ symbol: signal.symbol }, 'Position already exists, skipping');
      jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'execute_order', status: 'skipped' });
      return;
    }

    // Build signal object
    const signalObj: Signal = {
      id: signal.id,
      symbol: signal.symbol,
      type: signal.type,
      confidence: signal.confidence,
      source: 'combined',
      reasons: signal.reasons,
      indicators: {},
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000,
    };

    // Execute order
    const result = await executeOrder({
      client,
      signal: signalObj,
      equity,
      currentExposure,
      positionCount,
      config: scalperConfig,
      agentId,
      userId,
    });

    if (result.success && result.position) {
      // Save position to state
      state.positions[signal.symbol] = result.position;
      state.equity = equity;
      state.lastUpdate = Date.now();

      await saveAgentState(agentId, state);
      await savePosition(agentId, result.position);

      workerLogger.info(
        {
          agentId,
          symbol: signal.symbol,
          side: result.position.side,
          size: result.position.size,
          entryPrice: result.position.entryPrice,
        },
        'Order executed successfully'
      );

      jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'execute_order', status: 'completed' });
    } else {
      workerLogger.warn(
        { agentId, symbol: signal.symbol, error: result.error },
        'Order execution failed'
      );
      jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'execute_order', status: 'failed' });
    }

    jobDuration.observe({ worker: WORKER_NAME, job_type: 'execute_order' }, Date.now() - startTime);
  } catch (error: any) {
    workerLogger.error({ agentId, symbol: signal.symbol, error: error.message }, 'Execution error');
    jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'execute_order', status: 'error' });
    throw error;
  }
}

// =============================================================================
// WORKER SETUP
// =============================================================================

export function createExecutionWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.EXECUTE_ORDER,
    processExecuteOrder,
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      limiter: {
        max: 10,
        duration: 1000, // Max 10 orders per second
      },
    }
  );

  worker.on('completed', (job) => {
    workerLogger.debug({ jobId: job.id }, 'Execution job completed');
  });

  worker.on('failed', (job, error) => {
    workerLogger.error({ jobId: job?.id, error: error.message }, 'Execution job failed');
  });

  worker.on('error', (error) => {
    workerLogger.error({ error: error.message }, 'Execution worker error');
  });

  workerLogger.info({ concurrency: CONCURRENCY }, 'Execution worker started');

  return worker;
}

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
  const worker = createExecutionWorker();

  process.on('SIGTERM', async () => {
    workerLogger.info('Received SIGTERM, shutting down...');
    await worker.close();
    if (stateRedis) await stateRedis.quit();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    workerLogger.info('Received SIGINT, shutting down...');
    await worker.close();
    if (stateRedis) await stateRedis.quit();
    process.exit(0);
  });
}

export default createExecutionWorker;
