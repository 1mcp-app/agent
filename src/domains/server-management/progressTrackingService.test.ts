import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getProgressTrackingService,
  type OperationResult,
  type OperationType,
  ProgressTrackingService,
} from './progressTrackingService.js';

// Mock logger
vi.mock('@src/logger/logger.ts', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ProgressTrackingService', () => {
  let service: ProgressTrackingService;
  let mockListeners: Record<string, Function[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    vi.clearAllMocks();
    service = new ProgressTrackingService();
    mockListeners = {};

    // Mock EventEmitter methods
    vi.spyOn(service, 'emit').mockImplementation((event: string | symbol, ...args: any[]) => {
      const eventKey = String(event);
      mockListeners[eventKey] = mockListeners[eventKey] || [];
      mockListeners[eventKey].forEach((listener) => listener(...args));
      return true;
    });

    vi.spyOn(service, 'on').mockImplementation((event: string | symbol, listener: (...args: any[]) => void) => {
      const eventKey = String(event);
      mockListeners[eventKey] = mockListeners[eventKey] || [];
      mockListeners[eventKey].push(listener);
      return service;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startOperation', () => {
    it('should start tracking an operation with default total steps', () => {
      const operationId = 'test-op-123';
      service.startOperation(operationId, 'install');

      const status = service.getOperationStatus(operationId);
      expect(status).toEqual({
        operationId: 'test-op-123',
        operationType: 'install',
        currentStep: 0,
        totalSteps: 5,
        stepName: 'Initializing...',
        progress: 0,
        startedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should start tracking an operation with custom total steps', () => {
      const operationId = 'test-op-456';
      service.startOperation(operationId, 'update', 10);

      const status = service.getOperationStatus(operationId);
      expect(status?.totalSteps).toBe(10);
    });

    it('should emit operation-started event with proper data', () => {
      const onStart = vi.fn();
      service.on('operation-started', onStart);

      const operationId = 'test-op-789';
      service.startOperation(operationId, 'uninstall', 3);

      expect(onStart).toHaveBeenCalledWith({
        operationId: 'test-op-789',
        operationType: 'uninstall',
        currentStep: 0,
        totalSteps: 3,
        stepName: 'Initializing...',
        progress: 0,
        startedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      expect(service.emit).toHaveBeenCalledWith('operation-started', expect.any(Object));
    });

    it('should handle different operation types', () => {
      const operationTypes: OperationType[] = ['install', 'update', 'uninstall', 'search'];

      operationTypes.forEach((opType) => {
        const operationId = `test-${opType}`;
        service.startOperation(operationId, opType);

        const status = service.getOperationStatus(operationId);
        expect(status?.operationType).toBe(opType);
      });
    });

    it('should replace existing operation with same ID', () => {
      const operationId = 'duplicate-op';

      // Start first operation
      service.startOperation(operationId, 'install', 5);
      const firstStatus = service.getOperationStatus(operationId);
      const firstStartTime = firstStatus!.startedAt;

      // Wait a moment to ensure different timestamp
      vi.advanceTimersByTime(10);

      // Start second operation with same ID
      service.startOperation(operationId, 'update', 10);
      const secondStatus = service.getOperationStatus(operationId);

      expect(secondStatus?.totalSteps).toBe(10);
      expect(secondStatus?.operationType).toBe('update');
      expect(secondStatus?.startedAt.getTime()).toBeGreaterThan(firstStartTime.getTime());
    });
  });

  describe('updateProgress', () => {
    beforeEach(() => {
      service.startOperation('test-op', 'install', 5);
    });

    it('should update operation progress correctly', () => {
      service.updateProgress('test-op', 2, 'Downloading files');

      const status = service.getOperationStatus('test-op');
      expect(status).toEqual({
        operationId: 'test-op',
        operationType: 'install',
        currentStep: 2,
        totalSteps: 5,
        stepName: 'Downloading files',
        progress: 40, // (2/5) * 100 = 40
        message: undefined,
        startedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should update progress with message', () => {
      service.updateProgress('test-op', 3, 'Installing dependencies', 'Installing npm packages...');

      const status = service.getOperationStatus('test-op');
      expect(status?.message).toBe('Installing npm packages...');
    });

    it('should calculate progress percentage correctly', () => {
      const testCases = [
        { step: 0, expected: 0 },
        { step: 1, expected: 20 },
        { step: 2, expected: 40 },
        { step: 3, expected: 60 },
        { step: 4, expected: 80 },
        { step: 5, expected: 100 },
      ];

      testCases.forEach(({ step, expected }) => {
        service.updateProgress('test-op', step, `Step ${step}`);
        const status = service.getOperationStatus('test-op');
        expect(status?.progress).toBe(expected);
      });
    });

    it('should handle progress rounding correctly', () => {
      service.startOperation('rounding-test', 'install', 3);

      // 1/3 * 100 = 33.333..., should round to 33
      service.updateProgress('rounding-test', 1, 'Step 1');
      let status = service.getOperationStatus('rounding-test');
      expect(status?.progress).toBe(33);

      // 2/3 * 100 = 66.666..., should round to 67
      service.updateProgress('rounding-test', 2, 'Step 2');
      status = service.getOperationStatus('rounding-test');
      expect(status?.progress).toBe(67);
    });

    it('should emit progress-updated event', () => {
      const onUpdate = vi.fn();
      service.on('progress-updated', onUpdate);

      service.updateProgress('test-op', 2, 'Updating progress', 'Test message');

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'test-op',
          currentStep: 2,
          stepName: 'Updating progress',
          progress: 40,
          message: 'Test message',
        }),
      );
    });

    it('should warn when updating non-existent operation', () => {
      service.updateProgress('non-existent-op', 1, 'Test step');

      expect(service.emit).not.toHaveBeenCalledWith('progress-updated', expect.any(Object));
    });

    it('should handle step numbers outside valid range', () => {
      // Negative step
      service.updateProgress('test-op', -1, 'Negative step');
      let status = service.getOperationStatus('test-op');
      expect(status?.progress).toBe(0); // (-1/5) * 100 rounded to 0

      // Step beyond total
      service.updateProgress('test-op', 10, 'Beyond total');
      status = service.getOperationStatus('test-op');
      expect(status?.progress).toBe(100); // (10/5) * 100 capped by rounding
    });
  });

  describe('completeOperation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      service.startOperation('test-op', 'install', 3);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should complete operation successfully', () => {
      const onComplete = vi.fn();
      service.on('operation-completed', onComplete);

      vi.advanceTimersByTime(5000); // 5 seconds later
      service.completeOperation('test-op', {
        success: true,
        operationId: 'test-op',
        duration: 5000,
        message: 'Installation completed',
      });

      expect(onComplete).toHaveBeenCalledWith({
        success: true,
        operationId: 'test-op',
        duration: 5000,
        message: 'Installation completed',
      });

      // Operation should be removed from tracking
      expect(service.getOperationStatus('test-op')).toBeUndefined();
    });

    it('should complete operation without custom result', () => {
      const onComplete = vi.fn();
      service.on('operation-completed', onComplete);

      vi.advanceTimersByTime(3000); // 3 seconds later
      service.completeOperation('test-op');

      expect(onComplete).toHaveBeenCalledWith({
        success: true,
        operationId: 'test-op',
        duration: 3000,
      });
    });

    it('should warn when completing non-existent operation', () => {
      service.completeOperation('non-existent-op');

      expect(service.emit).not.toHaveBeenCalledWith('operation-completed', expect.any(Object));
    });

    it('should merge custom result with default values', () => {
      const onComplete = vi.fn();
      service.on('operation-completed', onComplete);

      vi.advanceTimersByTime(2000); // 2 seconds later
      service.completeOperation('test-op', {
        message: 'Custom message',
        success: true,
        operationId: 'test-op',
        duration: 2000,
        // Note: These should be overridden by the service
      } as OperationResult);

      expect(onComplete).toHaveBeenCalledWith({
        success: true, // Default value
        operationId: 'test-op', // Default value
        duration: 2000, // Default value
        message: 'Custom message', // Custom value
      });
    });

    it('should handle very long duration', () => {
      vi.advanceTimersByTime(3600000); // 1 hour later
      const onComplete = vi.fn();
      service.on('operation-completed', onComplete);

      service.completeOperation('test-op');

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: 3600000, // 1 hour in milliseconds
        }),
      );
    });
  });

  describe('failOperation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      service.startOperation('test-op', 'install', 3);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should fail operation with error', () => {
      const onFail = vi.fn();
      service.on('operation-failed', onFail);

      const error = new Error('Installation failed');
      vi.advanceTimersByTime(4000); // 4 seconds later
      service.failOperation('test-op', error);

      expect(onFail).toHaveBeenCalledWith({
        success: false,
        operationId: 'test-op',
        duration: 4000,
        error,
        message: 'Installation failed',
      });

      // Operation should be removed from tracking
      expect(service.getOperationStatus('test-op')).toBeUndefined();
    });

    it('should warn when failing non-existent operation', () => {
      const error = new Error('Test error');
      service.failOperation('non-existent-op', error);

      expect(service.emit).not.toHaveBeenCalledWith('operation-failed', expect.any(Object));
    });

    it('should handle different error types', () => {
      const onFail = vi.fn();
      service.on('operation-failed', onFail);

      const testCases = [
        { error: new Error('Simple error'), expectedMessage: 'Simple error' },
        { error: new TypeError('Type error'), expectedMessage: 'Type error' },
        { error: new RangeError('Range error'), expectedMessage: 'Range error' },
        { error: new Error('Error with details'), expectedMessage: 'Error with details' },
      ];

      testCases.forEach(({ error, expectedMessage }, index) => {
        const operationId = `error-test-${index}`;
        service.startOperation(operationId, 'install');

        service.failOperation(operationId, error);

        expect(onFail).toHaveBeenLastCalledWith(
          expect.objectContaining({
            operationId,
            error,
            message: expectedMessage,
          }),
        );
      });
    });

    it('should handle errors without message', () => {
      const onFail = vi.fn();
      service.on('operation-failed', onFail);

      const error = new Error();
      service.failOperation('test-op', error);

      expect(onFail).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '', // Empty string for error without message
        }),
      );
    });

    it('should handle very short failure duration', () => {
      vi.advanceTimersByTime(100); // 100ms later
      const onFail = vi.fn();
      service.on('operation-failed', onFail);

      service.failOperation('test-op', new Error('Quick failure'));

      expect(onFail).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: 100,
        }),
      );
    });
  });

  describe('getOperationStatus', () => {
    it('should return undefined for non-existent operation', () => {
      expect(service.getOperationStatus('non-existent')).toBeUndefined();
    });

    it('should return current operation status', () => {
      service.startOperation('test-op', 'install', 10);
      service.updateProgress('test-op', 5, 'Mid-operation', 'Test message');

      const status = service.getOperationStatus('test-op');
      expect(status).toEqual({
        operationId: 'test-op',
        operationType: 'install',
        currentStep: 5,
        totalSteps: 10,
        stepName: 'Mid-operation',
        progress: 50,
        message: 'Test message',
        startedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should return separate status for concurrent operations', () => {
      service.startOperation('op1', 'install', 5);
      service.startOperation('op2', 'update', 3);

      service.updateProgress('op1', 2, 'Step 2');
      service.updateProgress('op2', 1, 'Step A');

      const status1 = service.getOperationStatus('op1');
      const status2 = service.getOperationStatus('op2');

      expect(status1?.currentStep).toBe(2);
      expect(status2?.currentStep).toBe(1);
      expect(status1?.totalSteps).toBe(5);
      expect(status2?.totalSteps).toBe(3);
    });

    it('should not return status for completed operations', () => {
      service.startOperation('test-op', 'install');
      service.completeOperation('test-op');

      expect(service.getOperationStatus('test-op')).toBeUndefined();
    });

    it('should not return status for failed operations', () => {
      service.startOperation('test-op', 'install');
      service.failOperation('test-op', new Error('Failed'));

      expect(service.getOperationStatus('test-op')).toBeUndefined();
    });
  });

  describe('operation lifecycle management', () => {
    it('should handle complete operation lifecycle', () => {
      const events: string[] = [];

      service.on('operation-started', () => events.push('started'));
      service.on('progress-updated', () => events.push('updated'));
      service.on('operation-completed', () => events.push('completed'));

      // Start operation
      service.startOperation('lifecycle-test', 'install', 3);
      expect(events).toEqual(['started']);

      // Update progress
      service.updateProgress('lifecycle-test', 1, 'Step 1');
      expect(events).toEqual(['started', 'updated']);

      // Complete operation
      service.completeOperation('lifecycle-test');
      expect(events).toEqual(['started', 'updated', 'completed']);

      // Operation should be cleaned up
      expect(service.getOperationStatus('lifecycle-test')).toBeUndefined();
    });

    it('should handle failed operation lifecycle', () => {
      const events: string[] = [];

      service.on('operation-started', () => events.push('started'));
      service.on('progress-updated', () => events.push('updated'));
      service.on('operation-failed', () => events.push('failed'));

      // Start operation
      service.startOperation('fail-test', 'install', 2);
      expect(events).toEqual(['started']);

      // Update progress
      service.updateProgress('fail-test', 1, 'Step 1');
      expect(events).toEqual(['started', 'updated']);

      // Fail operation
      service.failOperation('fail-test', new Error('Test failure'));
      expect(events).toEqual(['started', 'updated', 'failed']);

      // Operation should be cleaned up
      expect(service.getOperationStatus('fail-test')).toBeUndefined();
    });
  });

  describe('multiple concurrent operations', () => {
    it('should track multiple operations independently', () => {
      const operations = [
        { id: 'op1', type: 'install' as OperationType, steps: 5 },
        { id: 'op2', type: 'update' as OperationType, steps: 3 },
        { id: 'op3', type: 'uninstall' as OperationType, steps: 2 },
      ];

      // Start all operations
      operations.forEach((op) => {
        service.startOperation(op.id, op.type, op.steps);
      });

      // Update each operation differently
      service.updateProgress('op1', 2, 'Step 2');
      service.updateProgress('op2', 1, 'Step A');
      service.updateProgress('op3', 0, 'Starting');

      // Check all statuses are independent
      const status1 = service.getOperationStatus('op1');
      const status2 = service.getOperationStatus('op2');
      const status3 = service.getOperationStatus('op3');

      expect(status1?.currentStep).toBe(2);
      expect(status2?.currentStep).toBe(1);
      expect(status3?.currentStep).toBe(0);

      expect(status1?.totalSteps).toBe(5);
      expect(status2?.totalSteps).toBe(3);
      expect(status3?.totalSteps).toBe(2);
    });

    it('should handle completion of operations independently', () => {
      service.startOperation('op1', 'install', 3);
      service.startOperation('op2', 'update', 3);

      // Complete first operation
      service.completeOperation('op1');

      expect(service.getOperationStatus('op1')).toBeUndefined();
      expect(service.getOperationStatus('op2')).toBeDefined();

      // Complete second operation
      service.completeOperation('op2');

      expect(service.getOperationStatus('op2')).toBeUndefined();
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle empty operation ID', () => {
      expect(() => service.startOperation('', 'install')).not.toThrow();
      expect(service.getOperationStatus('')).toBeDefined();
    });

    it('should handle zero total steps', () => {
      service.startOperation('zero-steps', 'install', 0);
      service.updateProgress('zero-steps', 0, 'Test');

      const status = service.getOperationStatus('zero-steps');
      expect(status?.totalSteps).toBe(0);
      expect(status?.progress).toBe(0); // Avoid division by zero
    });

    it('should handle negative total steps gracefully', () => {
      service.startOperation('negative-steps', 'install', -1);

      const status = service.getOperationStatus('negative-steps');
      expect(status?.totalSteps).toBe(-1);
    });

    it('should handle very long operation names and messages', () => {
      const longMessage = 'a'.repeat(1000);

      service.startOperation('test-op', 'install');
      service.updateProgress('test-op', 1, longMessage, longMessage);

      const status = service.getOperationStatus('test-op');
      expect(status?.stepName).toBe(longMessage);
      expect(status?.message).toBe(longMessage);
    });
  });
});

describe('getProgressTrackingService (Singleton)', () => {
  beforeEach(() => {
    // Reset singleton instance
    vi.resetModules();
  });

  it('should return the same instance on multiple calls', () => {
    const service1 = getProgressTrackingService();
    const service2 = getProgressTrackingService();
    const service3 = getProgressTrackingService();

    expect(service1).toBe(service2);
    expect(service2).toBe(service3);
  });

  it('should create a new instance on first call', () => {
    const service = getProgressTrackingService();
    expect(service).toBeInstanceOf(ProgressTrackingService);
  });

  it('should maintain state across singleton calls', () => {
    const service1 = getProgressTrackingService();
    service1.startOperation('singleton-test', 'install');

    const service2 = getProgressTrackingService();
    const status = service2.getOperationStatus('singleton-test');

    expect(status).toBeDefined();
    expect(status?.operationId).toBe('singleton-test');
  });

  it('should handle singleton pattern with multiple operations', () => {
    const service1 = getProgressTrackingService();
    const service2 = getProgressTrackingService();

    service1.startOperation('op1', 'install');
    service2.startOperation('op2', 'update');

    // Both operations should be tracked in the same instance
    const status1 = service1.getOperationStatus('op1');
    const status2 = service2.getOperationStatus('op2');

    expect(status1).toBeDefined();
    expect(status2).toBeDefined();
    expect(status1?.operationId).toBe('op1');
    expect(status2?.operationId).toBe('op2');
  });
});
