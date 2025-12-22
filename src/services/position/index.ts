/**
 * Position Service - Main Entry Point
 */

export * from './position-manager';

import {
  updatePosition,
  checkLLMExit,
  syncPositions,
  checkDailyLimits,
  checkDailyReset,
  monitorPositions,
} from './position-manager';

export const positionService = {
  updatePosition,
  checkLLMExit,
  syncPositions,
  checkDailyLimits,
  checkDailyReset,
  monitorPositions,
};

export default positionService;
