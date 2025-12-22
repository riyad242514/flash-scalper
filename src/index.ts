/**
 * FlashScalper - Main Entry Point
 * Scalable trading microservice platform
 */

// Re-export all modules
export * from './types';
export * from './config';
export * from './services/signal';
export * from './services/execution';
export * from './services/position';
export * from './queues';
export * from './utils/logger';
export * from './utils/metrics';

// Version
export const VERSION = '1.0.0';

// Quick start helpers
import { AsterClient } from './services/execution';
import { generateSignal, calculateAllIndicators, parseKlines } from './services/signal';
import { loadScalperConfig, loadCoinList } from './config';
import { logger } from './utils/logger';

/**
 * Quick test function to verify everything works
 */
export async function quickTest(): Promise<void> {
  logger.info('Running quick test...');

  const config = loadScalperConfig();
  const coins = loadCoinList();

  logger.info({ coinCount: coins.length, config: { leverage: config.leverage } }, 'Config loaded');

  // Test exchange connection (read-only)
  const client = new AsterClient();

  try {
    const klines = await client.getKlines('BTCUSDT', '5m', 60);
    logger.info({ klineCount: klines.length }, 'Fetched BTC klines');

    const parsedKlines = parseKlines(klines);
    const indicators = calculateAllIndicators(parsedKlines, config);

    if (indicators) {
      logger.info({
        price: indicators.price,
        rsi: indicators.rsi,
        trend: indicators.trend,
        stochK: indicators.stochK,
      }, 'Technical indicators calculated');
    }

    const result = await generateSignal('BTCUSDT', klines, config, { symbol: 'BTCUSDT', ivishx: 'bitcoin', boost: 1.0 }, 'test');

    logger.info({
      direction: result.score.direction,
      score: result.score.totalScore,
      reasons: result.score.reasons.slice(0, 3),
    }, 'Signal generated');

    logger.info('Quick test completed successfully!');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Quick test failed');
  }
}

// Run quick test if executed directly
if (require.main === module) {
  quickTest().catch(console.error);
}
