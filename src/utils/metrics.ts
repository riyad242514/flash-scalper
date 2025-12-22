/**
 * Prometheus Metrics for Observability
 * Tracks trades, signals, latency, and system health
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const registry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// =============================================================================
// TRADE METRICS
// =============================================================================

export const tradesTotal = new Counter({
  name: 'flashscalper_trades_total',
  help: 'Total number of trades executed',
  labelNames: ['agent_id', 'symbol', 'side', 'result'],
  registers: [registry],
});

export const tradePnL = new Histogram({
  name: 'flashscalper_trade_pnl_usd',
  help: 'Trade PnL in USD',
  labelNames: ['agent_id', 'symbol'],
  buckets: [-100, -50, -20, -10, -5, -1, 0, 1, 5, 10, 20, 50, 100],
  registers: [registry],
});

export const tradeROE = new Histogram({
  name: 'flashscalper_trade_roe_percent',
  help: 'Trade ROE in percent',
  labelNames: ['agent_id', 'symbol'],
  buckets: [-10, -5, -3, -2, -1, 0, 1, 2, 3, 5, 10, 15, 20],
  registers: [registry],
});

export const tradeDuration = new Histogram({
  name: 'flashscalper_trade_duration_seconds',
  help: 'Trade duration in seconds',
  labelNames: ['agent_id', 'symbol'],
  buckets: [60, 120, 300, 600, 900, 1200, 1800, 3600],
  registers: [registry],
});

// =============================================================================
// SIGNAL METRICS
// =============================================================================

export const signalsTotal = new Counter({
  name: 'flashscalper_signals_total',
  help: 'Total number of signals generated',
  labelNames: ['agent_id', 'symbol', 'direction', 'source'],
  registers: [registry],
});

export const signalsRejected = new Counter({
  name: 'flashscalper_signals_rejected_total',
  help: 'Total number of signals rejected',
  labelNames: ['agent_id', 'symbol', 'reason'],
  registers: [registry],
});

export const signalConfidence = new Histogram({
  name: 'flashscalper_signal_confidence',
  help: 'Signal confidence score',
  labelNames: ['agent_id', 'direction'],
  buckets: [20, 30, 40, 50, 60, 70, 80, 90, 100],
  registers: [registry],
});

// =============================================================================
// POSITION METRICS
// =============================================================================

export const openPositions = new Gauge({
  name: 'flashscalper_open_positions',
  help: 'Current number of open positions',
  labelNames: ['agent_id'],
  registers: [registry],
});

export const positionExposure = new Gauge({
  name: 'flashscalper_position_exposure_usd',
  help: 'Current position exposure in USD',
  labelNames: ['agent_id'],
  registers: [registry],
});

export const unrealizedPnL = new Gauge({
  name: 'flashscalper_unrealized_pnl_usd',
  help: 'Current unrealized PnL in USD',
  labelNames: ['agent_id'],
  registers: [registry],
});

// =============================================================================
// AGENT METRICS
// =============================================================================

export const agentEquity = new Gauge({
  name: 'flashscalper_agent_equity_usd',
  help: 'Current agent equity in USD',
  labelNames: ['agent_id', 'user_id'],
  registers: [registry],
});

export const agentDailyPnL = new Gauge({
  name: 'flashscalper_agent_daily_pnl_usd',
  help: 'Agent daily PnL in USD',
  labelNames: ['agent_id'],
  registers: [registry],
});

export const agentDrawdown = new Gauge({
  name: 'flashscalper_agent_drawdown_percent',
  help: 'Agent current drawdown percentage',
  labelNames: ['agent_id'],
  registers: [registry],
});

export const agentWinRate = new Gauge({
  name: 'flashscalper_agent_win_rate',
  help: 'Agent win rate (0-1)',
  labelNames: ['agent_id'],
  registers: [registry],
});

export const agentTicks = new Counter({
  name: 'flashscalper_agent_ticks_total',
  help: 'Total number of agent ticks',
  labelNames: ['agent_id'],
  registers: [registry],
});

export const agentStatus = new Gauge({
  name: 'flashscalper_agent_status',
  help: 'Agent status (1=running, 0=stopped, -1=error)',
  labelNames: ['agent_id', 'status'],
  registers: [registry],
});

// =============================================================================
// EXCHANGE METRICS
// =============================================================================

export const exchangeRequests = new Counter({
  name: 'flashscalper_exchange_requests_total',
  help: 'Total number of exchange API requests',
  labelNames: ['exchange', 'endpoint', 'status'],
  registers: [registry],
});

export const exchangeLatency = new Histogram({
  name: 'flashscalper_exchange_latency_ms',
  help: 'Exchange API latency in milliseconds',
  labelNames: ['exchange', 'endpoint'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const exchangeErrors = new Counter({
  name: 'flashscalper_exchange_errors_total',
  help: 'Total number of exchange API errors',
  labelNames: ['exchange', 'endpoint', 'error_type'],
  registers: [registry],
});

// =============================================================================
// LLM METRICS
// =============================================================================

export const llmRequests = new Counter({
  name: 'flashscalper_llm_requests_total',
  help: 'Total number of LLM API requests',
  labelNames: ['model', 'type', 'result'],
  registers: [registry],
});

export const llmLatency = new Histogram({
  name: 'flashscalper_llm_latency_ms',
  help: 'LLM API latency in milliseconds',
  labelNames: ['model', 'type'],
  buckets: [100, 250, 500, 1000, 2000, 3000, 5000, 10000],
  registers: [registry],
});

export const llmRetries = new Counter({
  name: 'flashscalper_llm_retries_total',
  help: 'Total number of LLM retry attempts',
  labelNames: ['model', 'type'],
  registers: [registry],
});

export const llmCircuitBreakerState = new Gauge({
  name: 'flashscalper_llm_circuit_breaker_state',
  help: 'LLM circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['model'],
  registers: [registry],
});

export const llmRateLimitHits = new Counter({
  name: 'flashscalper_llm_rate_limit_hits_total',
  help: 'Total number of LLM rate limit hits',
  labelNames: ['model'],
  registers: [registry],
});

export const llmStructuredOutputFailures = new Counter({
  name: 'flashscalper_llm_structured_output_failures_total',
  help: 'Total number of LLM structured output validation failures',
  labelNames: ['model', 'type'],
  registers: [registry],
});

// =============================================================================
// WORKER METRICS
// =============================================================================

export const jobsProcessed = new Counter({
  name: 'flashscalper_jobs_processed_total',
  help: 'Total number of jobs processed',
  labelNames: ['worker', 'job_type', 'status'],
  registers: [registry],
});

export const jobDuration = new Histogram({
  name: 'flashscalper_job_duration_ms',
  help: 'Job processing duration in milliseconds',
  labelNames: ['worker', 'job_type'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const jobQueueSize = new Gauge({
  name: 'flashscalper_job_queue_size',
  help: 'Current number of jobs in queue',
  labelNames: ['queue'],
  registers: [registry],
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function recordTrade(
  agentId: string,
  symbol: string,
  side: 'buy' | 'sell',
  result: 'success' | 'failure' | 'paper',
  pnl: number,
  roe: number,
  durationSeconds: number
) {
  tradesTotal.inc({ agent_id: agentId, symbol, side, result: result === 'paper' ? 'success' : result });
  if (result === 'success') {
    tradePnL.observe({ agent_id: agentId, symbol }, pnl);
    tradeROE.observe({ agent_id: agentId, symbol }, roe);
    tradeDuration.observe({ agent_id: agentId, symbol }, durationSeconds);
  }
}

export function recordSignal(
  agentId: string,
  symbol: string,
  direction: string,
  source: string,
  confidence: number
) {
  signalsTotal.inc({ agent_id: agentId, symbol, direction, source });
  signalConfidence.observe({ agent_id: agentId, direction }, confidence);
}

export function recordSignalRejection(
  agentId: string,
  symbol: string,
  reason: string
) {
  signalsRejected.inc({ agent_id: agentId, symbol, reason });
}

export function updateAgentMetrics(
  agentId: string,
  userId: string,
  metrics: {
    equity: number;
    dailyPnL: number;
    drawdown: number;
    winRate: number;
    positionCount: number;
    exposure: number;
    unrealizedPnL: number;
  }
) {
  agentEquity.set({ agent_id: agentId, user_id: userId }, metrics.equity);
  agentDailyPnL.set({ agent_id: agentId }, metrics.dailyPnL);
  agentDrawdown.set({ agent_id: agentId }, metrics.drawdown);
  agentWinRate.set({ agent_id: agentId }, metrics.winRate);
  openPositions.set({ agent_id: agentId }, metrics.positionCount);
  positionExposure.set({ agent_id: agentId }, metrics.exposure);
  unrealizedPnL.set({ agent_id: agentId }, metrics.unrealizedPnL);
}

export default registry;
