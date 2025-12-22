/**
 * Execution Service - Main Entry Point
 */

export * from './exchange-client';
export * from './order-executor';

import { AsterClient, createAsterClient } from './exchange-client';
import {
  executeOrder,
  closePosition,
  calculatePositionSize,
  calculateExposure,
  canOpenPosition,
  ExecuteOrderParams,
  ExecuteOrderResult,
  ClosePositionParams,
  ClosePositionResult,
} from './order-executor';

export const executionService = {
  createClient: createAsterClient,
  executeOrder,
  closePosition,
  calculatePositionSize,
  calculateExposure,
  canOpenPosition,
};

export default executionService;
