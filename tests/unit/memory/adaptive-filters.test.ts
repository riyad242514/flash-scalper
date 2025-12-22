/**
 * Adaptive Filters Unit Tests
 */

import { AdaptiveFilters, type AdaptiveFilterConfig } from '../../../src/services/memory/adaptive-filters';

describe('AdaptiveFilters', () => {
  let filters: AdaptiveFilters;
  let initialConfig: AdaptiveFilterConfig;

  beforeEach(() => {
    initialConfig = {
      minCombinedConfidence: 55,
      minScoreForSignal: 50,
      requireTrendAlignment: false,
      requireVolumeConfirmation: false,
      requireMultiIndicatorConfluence: false,
      minIndicatorConfluence: 3,
      minVolumeSpike: 0.3,
      minTrendStrength: 0.3,
    };

    filters = new AdaptiveFilters(initialConfig);
  });

  describe('recordTradeOutcome', () => {
    it('should record winning trade', () => {
      filters.recordTradeOutcome(
        { trendAlignment: true, volumeConfirmation: true, multiIndicatorConfluence: true },
        true,
        5
      );

      const performance = filters.getFilterPerformance();
      expect(performance.get('trendAlignment')?.trades).toBe(1);
      expect(performance.get('trendAlignment')?.wins).toBe(1);
    });

    it('should record losing trade', () => {
      filters.recordTradeOutcome(
        { trendAlignment: true, volumeConfirmation: false, multiIndicatorConfluence: false },
        false,
        -3
      );

      const performance = filters.getFilterPerformance();
      expect(performance.get('trendAlignment')?.trades).toBe(1);
      expect(performance.get('trendAlignment')?.losses).toBe(1);
    });
  });

  describe('getAdjustedFilters', () => {
    it('should return base config when not enough trades', () => {
      const adjustments = filters.getAdjustedFilters();

      expect(adjustments.minCombinedConfidence).toBe(initialConfig.minCombinedConfidence);
    });

    it('should tighten filters when win rate is low', () => {
      for (let i = 0; i < 15; i++) {
        filters.recordTradeOutcome(
          { trendAlignment: true, volumeConfirmation: true, multiIndicatorConfluence: true },
          false,
          -3
        );
      }

      const adjustments = filters.getAdjustedFilters();
      expect(adjustments.minCombinedConfidence).toBeGreaterThanOrEqual(initialConfig.minCombinedConfidence);
    });

    it('should relax filters when win rate is high', () => {
      for (let i = 0; i < 15; i++) {
        filters.recordTradeOutcome(
          { trendAlignment: true, volumeConfirmation: true, multiIndicatorConfluence: true },
          true,
          5
        );
      }

      const adjustments = filters.getAdjustedFilters();
      expect(adjustments.minCombinedConfidence).toBeLessThanOrEqual(initialConfig.minCombinedConfidence + 5);
    });
  });

  describe('reset', () => {
    it('should reset filter performance', () => {
      filters.recordTradeOutcome(
        { trendAlignment: true, volumeConfirmation: true, multiIndicatorConfluence: true },
        true,
        5
      );

      filters.reset();

      const performance = filters.getFilterPerformance();
      expect(performance.get('trendAlignment')?.trades).toBe(0);
    });
  });
});

