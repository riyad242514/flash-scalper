/**
 * Position Worker
 * Monitors positions and handles exits
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import {
  QUEUE_NAMES,
  getRedisConnection,
  PositionCheckJobData,
  addClosePositionJob,
} from '../queues';
import { config, loadScalperConfig } from '../config';
import { AsterClient } from '../services/execution';
import { updatePosition, checkLLMExit } from '../services/position';
import { calculateAllIndicators, parseKlines } from '../services/signal';
import { workerLogger, logPosition } from '../utils/logger';
import { jobsProcessed, jobDuration, updateAgentMetrics } from '../utils/metrics';
import type { Position } from '../types';

// =============================================================================
// WORKER CONFIGURATION
// =============================================================================

const WORKER_NAME = 'position-worker';
const CONCURRENCY = parseInt(process.env.POSITION_WORKER_CONCURRENCY || '10');

// Redis client for state
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

async function getPosition(agentId: string, symbol: string): Promise<Position | null> {
  const redis = getStateRedis();
  const positionKey = `agent:${agentId}:position:${symbol}`;
  const positionJson = await redis.get(positionKey);

  if (!positionJson) return null;

  try {
    return JSON.parse(positionJson);
  } catch {
    return null;
  }
}

async function savePosition(agentId: string, position: Position): Promise<void> {
  const redis = getStateRedis();
  const positionKey = `agent:${agentId}:position:${position.symbol}`;
  await redis.setex(positionKey, 7200, JSON.stringify(position));
}

async function deletePosition(agentId: string, symbol: string): Promise<void> {
  const redis = getStateRedis();
  const positionKey = `agent:${agentId}:position:${symbol}`;
  await redis.del(positionKey);

  // Also update agent state
  const stateKey = `agent:${agentId}:state`;
  const stateJson = await redis.get(stateKey);
  if (stateJson) {
    try {
      const state = JSON.parse(stateJson);
      delete state.positions[symbol];
      await redis.setex(stateKey, 3600, JSON.stringify(state));
    } catch {
      // Ignore parse errors
    }
  }
}

// =============================================================================
// JOB PROCESSOR
// =============================================================================

async function processPositionCheck(job: Job<PositionCheckJobData>): Promise<void> {
  const startTime = Date.now();
  const { agentId, userId, positionId, symbol } = job.data;

  try {
    // Get position from Redis
    const position = await getPosition(agentId, symbol);
    if (!position) {
      workerLogger.debug({ agentId, symbol }, 'Position not found, skipping');
      return;
    }

    // Load configuration
    const scalperConfig = loadScalperConfig();

    // Create exchange client (read-only for price checks)
    const client = new AsterClient();

    // Get current price
    const currentPrice = await client.getPrice(symbol);

    // Update position with current price
    const updateResult = updatePosition(position, currentPrice, scalperConfig);

    // Log position status
    logPosition(agentId, {
      symbol,
      side: position.side,
      roe: position.unrealizedROE,
      pnl: position.unrealizedPnl,
      peakROE: position.highestROE,
    });

    // Check if we need to close
    if (updateResult.action !== 'hold') {
      workerLogger.info(
        {
          agentId,
          symbol,
          action: updateResult.action,
          reason: updateResult.reason,
          roe: position.unrealizedROE,
        },
        'Position exit triggered'
      );

      // Queue close position job
      // Note: In production, would fetch credentials from database
      // await addClosePositionJob({
      //   agentId,
      //   userId,
      //   positionId: position.id,
      //   symbol,
      //   reason: updateResult.reason || updateResult.action,
      //   credentials: { apiKey: '...', secretKey: '...' },
      // });

      // For now, just mark position for deletion
      await deletePosition(agentId, symbol);

      jobsProcessed.inc({
        worker: WORKER_NAME,
        job_type: 'position_check',
        status: updateResult.action,
      });
    } else {
      // Check LLM exit if enabled
      if (scalperConfig.llmExitAnalysisEnabled) {
        const holdTimeMinutes = (Date.now() - position.openedAt) / 60000;

        if (holdTimeMinutes >= scalperConfig.llmExitAnalysisMinutes) {
          const klines = await client.getKlines(symbol, scalperConfig.klineInterval, scalperConfig.klineCount);
          const parsedKlines = parseKlines(klines);
          const indicators = calculateAllIndicators(parsedKlines, scalperConfig);

          if (indicators) {
            const llmExit = await checkLLMExit(position, indicators, parsedKlines, scalperConfig);

            if (llmExit.shouldExit) {
              workerLogger.info(
                {
                  agentId,
                  symbol,
                  reason: llmExit.reason,
                  roe: position.unrealizedROE,
                },
                'LLM exit triggered'
              );

              // Queue close position job
              await deletePosition(agentId, symbol);

              jobsProcessed.inc({
                worker: WORKER_NAME,
                job_type: 'position_check',
                status: 'llm_exit',
              });

              jobDuration.observe(
                { worker: WORKER_NAME, job_type: 'position_check' },
                Date.now() - startTime
              );
              return;
            }
          }
        }
      }

      // Save updated position
      await savePosition(agentId, position);

      jobsProcessed.inc({
        worker: WORKER_NAME,
        job_type: 'position_check',
        status: 'hold',
      });
    }

    jobDuration.observe({ worker: WORKER_NAME, job_type: 'position_check' }, Date.now() - startTime);
  } catch (error: any) {
    workerLogger.error({ agentId, symbol, error: error.message }, 'Position check error');
    jobsProcessed.inc({ worker: WORKER_NAME, job_type: 'position_check', status: 'error' });
    throw error;
  }
}

// =============================================================================
// WORKER SETUP
// =============================================================================

export function createPositionWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.POSITION_CHECK,
    processPositionCheck,
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      limiter: {
        max: 100,
        duration: 1000, // Max 100 checks per second
      },
    }
  );

  worker.on('completed', (job) => {
    workerLogger.debug({ jobId: job.id }, 'Position check completed');
  });

  worker.on('failed', (job, error) => {
    workerLogger.error({ jobId: job?.id, error: error.message }, 'Position check failed');
  });

  worker.on('error', (error) => {
    workerLogger.error({ error: error.message }, 'Position worker error');
  });

  workerLogger.info({ concurrency: CONCURRENCY }, 'Position worker started');

  return worker;
}

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
  const worker = createPositionWorker();

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

export default createPositionWorker;
