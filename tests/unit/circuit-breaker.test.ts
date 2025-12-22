/**
 * Circuit Breaker Unit Tests
 */

import { CircuitBreaker, CircuitState, CircuitBreakerOpenError } from '../../src/utils/circuit-breaker';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let stateChanges: CircuitState[];

  beforeEach(() => {
    stateChanges = [];
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 1000, // 1 second for faster tests
      halfOpenTimeoutMs: 500,
      onStateChange: (state) => stateChanges.push(state),
    });
  });

  describe('CLOSED state (normal operation)', () => {
    it('should allow requests when CLOSED', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await circuitBreaker.execute(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should track failures but stay CLOSED below threshold', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Fail 4 times (below threshold of 5)
      for (let i = 0; i < 4; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(circuitBreaker.getFailures()).toBe(4);
    });
  });

  describe('OPEN state (fast-fail)', () => {
    it('should open circuit after failure threshold', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Fail 5 times (threshold)
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      expect(stateChanges).toContain(CircuitState.OPEN);
    });

    it('should fast-fail when OPEN', async () => {
      // Open the circuit
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      
      // Try to execute - should fail fast
      const startTime = Date.now();
      try {
        await circuitBreaker.execute(() => Promise.resolve('should not execute'));
        fail('Should have thrown CircuitBreakerOpenError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerOpenError);
        const latency = Date.now() - startTime;
        expect(latency).toBeLessThan(10); // Fast-fail in <10ms
      }
    });
  });

  describe('HALF_OPEN state (testing)', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Try to execute - should transition to HALF_OPEN
      const testFn = jest.fn().mockResolvedValue('success');
      const result = await circuitBreaker.execute(testFn);
      
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
      expect(stateChanges).toContain(CircuitState.HALF_OPEN);
      expect(result).toBe('success');
    });
  });

  describe('Transition HALF_OPEN → CLOSED (success)', () => {
    it('should close circuit after success threshold', async () => {
      // Open the circuit
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Execute 2 successful requests (success threshold)
      const successFn = jest.fn().mockResolvedValue('success');
      await circuitBreaker.execute(successFn);
      await circuitBreaker.execute(successFn);
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(stateChanges).toContain(CircuitState.CLOSED);
    });
  });

  describe('Transition HALF_OPEN → OPEN (failure)', () => {
    it('should open circuit again on failure in HALF_OPEN', async () => {
      // Open the circuit
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Fail in HALF_OPEN state
      const failFn = jest.fn().mockRejectedValue(new Error('test error'));
      try {
        await circuitBreaker.execute(failFn);
      } catch (e) {
        // Expected
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      expect(stateChanges.filter(s => s === CircuitState.OPEN).length).toBeGreaterThan(0);
    });
  });

  describe('Reset', () => {
    it('should reset circuit breaker to CLOSED', async () => {
      // Open the circuit
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      
      // Reset
      circuitBreaker.reset();
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(circuitBreaker.getFailures()).toBe(0);
      expect(circuitBreaker.getSuccesses()).toBe(0);
    });
  });

  describe('State transitions', () => {
    it('should track all state changes', async () => {
      // CLOSED → OPEN
      const fn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(stateChanges).toContain(CircuitState.OPEN);
      
      // OPEN → HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 1100));
      const testFn = jest.fn().mockResolvedValue('success');
      await circuitBreaker.execute(testFn);
      
      expect(stateChanges).toContain(CircuitState.HALF_OPEN);
      
      // HALF_OPEN → CLOSED
      await circuitBreaker.execute(testFn);
      
      expect(stateChanges).toContain(CircuitState.CLOSED);
    });
  });
});

