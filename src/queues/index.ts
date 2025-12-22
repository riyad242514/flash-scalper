/**
 * Job Queue Definitions
 * BullMQ queues for scalable job processing
 */

import { Queue, QueueEvents, Job } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import { workerLogger } from '../utils/logger';
import { jobQueueSize } from '../utils/metrics';

// =============================================================================
// REDIS CONNECTION
// =============================================================================

export const createRedisConnection = () => {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  });
};

// Shared connection for queues
let redisConnection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = createRedisConnection();
  }
  return redisConnection;
}

// =============================================================================
// QUEUE NAMES
// =============================================================================

export const QUEUE_NAMES = {
  SIGNAL_SCAN: 'signal-scan',
  POSITION_CHECK: 'position-check',
  EXECUTE_ORDER: 'execute-order',
  CLOSE_POSITION: 'close-position',
  SYNC_POSITIONS: 'sync-positions',
} as const;

// =============================================================================
// QUEUE INSTANCES
// =============================================================================

// Signal scanning queue
export const signalQueue = new Queue(QUEUE_NAMES.SIGNAL_SCAN, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Position monitoring queue
export const positionQueue = new Queue(QUEUE_NAMES.POSITION_CHECK, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 500,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Order execution queue (high priority)
export const executionQueue = new Queue(QUEUE_NAMES.EXECUTE_ORDER, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 500,
    },
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});

// Close position queue
export const closeQueue = new Queue(QUEUE_NAMES.CLOSE_POSITION, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 500,
    },
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});

// Position sync queue
export const syncQueue = new Queue(QUEUE_NAMES.SYNC_POSITIONS, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: 50,
    removeOnFail: 20,
  },
});

// =============================================================================
// QUEUE EVENTS
// =============================================================================

export function setupQueueEvents() {
  const queues = [signalQueue, positionQueue, executionQueue, closeQueue, syncQueue];

  for (const queue of queues) {
    const events = new QueueEvents(queue.name, {
      connection: createRedisConnection(),
    });

    events.on('completed', ({ jobId }) => {
      workerLogger.debug({ queue: queue.name, jobId }, 'Job completed');
    });

    events.on('failed', ({ jobId, failedReason }) => {
      workerLogger.error({ queue: queue.name, jobId, reason: failedReason }, 'Job failed');
    });

    events.on('stalled', ({ jobId }) => {
      workerLogger.warn({ queue: queue.name, jobId }, 'Job stalled');
    });
  }
}

// =============================================================================
// QUEUE METRICS
// =============================================================================

export async function updateQueueMetrics() {
  const queues = [
    { queue: signalQueue, name: 'signal' },
    { queue: positionQueue, name: 'position' },
    { queue: executionQueue, name: 'execution' },
    { queue: closeQueue, name: 'close' },
    { queue: syncQueue, name: 'sync' },
  ];

  for (const { queue, name } of queues) {
    const counts = await queue.getJobCounts();
    jobQueueSize.set({ queue: name }, counts.waiting + counts.active);
  }
}

// =============================================================================
// JOB DATA TYPES
// =============================================================================

export interface SignalScanJobData {
  agentId: string;
  userId: string;
  symbols: string[];
  configOverrides?: Record<string, any>;
}

export interface PositionCheckJobData {
  agentId: string;
  userId: string;
  positionId: string;
  symbol: string;
}

export interface ExecuteOrderJobData {
  agentId: string;
  userId: string;
  signal: {
    id: string;
    symbol: string;
    type: 'LONG' | 'SHORT';
    confidence: number;
    reasons: string[];
  };
  credentials: {
    apiKey: string;
    secretKey: string;
  };
}

export interface ClosePositionJobData {
  agentId: string;
  userId: string;
  positionId: string;
  symbol: string;
  reason: string;
  credentials: {
    apiKey: string;
    secretKey: string;
  };
}

export interface SyncPositionsJobData {
  agentId: string;
  userId: string;
  credentials: {
    apiKey: string;
    secretKey: string;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Add signal scan job
 */
export async function addSignalScanJob(data: SignalScanJobData): Promise<Job> {
  return signalQueue.add('scan', data, {
    priority: 2,
  });
}

/**
 * Add position check job
 */
export async function addPositionCheckJob(data: PositionCheckJobData): Promise<Job> {
  return positionQueue.add('check', data, {
    priority: 1,
  });
}

/**
 * Add execute order job (high priority)
 */
export async function addExecuteOrderJob(data: ExecuteOrderJobData): Promise<Job> {
  return executionQueue.add('execute', data, {
    priority: 1, // High priority
  });
}

/**
 * Add close position job (highest priority)
 */
export async function addClosePositionJob(data: ClosePositionJobData): Promise<Job> {
  return closeQueue.add('close', data, {
    priority: 1, // Highest priority
  });
}

/**
 * Add sync positions job
 */
export async function addSyncPositionsJob(data: SyncPositionsJobData): Promise<Job> {
  return syncQueue.add('sync', data, {
    priority: 3,
  });
}

/**
 * Schedule recurring signal scan
 */
export async function scheduleRecurringSignalScan(
  data: SignalScanJobData,
  intervalMs: number
): Promise<void> {
  await signalQueue.add('scan', data, {
    repeat: {
      every: intervalMs,
    },
  });
}

/**
 * Cancel all recurring jobs for an agent
 */
export async function cancelAgentJobs(agentId: string): Promise<void> {
  const queues = [signalQueue, positionQueue, executionQueue, closeQueue, syncQueue];

  for (const queue of queues) {
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name.includes(agentId)) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
  }
}

// =============================================================================
// CLEANUP
// =============================================================================

export async function closeQueues(): Promise<void> {
  await Promise.all([
    signalQueue.close(),
    positionQueue.close(),
    executionQueue.close(),
    closeQueue.close(),
    syncQueue.close(),
  ]);

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

export default {
  signalQueue,
  positionQueue,
  executionQueue,
  closeQueue,
  syncQueue,
  addSignalScanJob,
  addPositionCheckJob,
  addExecuteOrderJob,
  addClosePositionJob,
  addSyncPositionsJob,
  scheduleRecurringSignalScan,
  cancelAgentJobs,
  setupQueueEvents,
  updateQueueMetrics,
  closeQueues,
  getRedisConnection,
};
