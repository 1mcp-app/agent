import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeOperation } from './operationExecution.js';
import { MCPError } from './errorTypes.js';
import logger from '@src/logger/logger.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('operationExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('executeOperation', () => {
    it('should execute operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await executeOperation(operation, 'test-context');

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalled();
    });

    it('should retry failed operations', async () => {
      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('result');

      const operationPromise = executeOperation(operation, 'test-context', { retryCount: 1, retryDelay: 1000 });

      // Advance timer by retry delay
      await vi.advanceTimersByTimeAsync(1000);

      const result = await operationPromise;

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Retrying operation'));
    });

    it('should throw error after max retries', async () => {
      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValue(error);

      const operationPromise = executeOperation(operation, 'test-context', { retryCount: 2, retryDelay: 1000 });

      // Create rejection assertion before advancing timers
      const rejection = expect(operationPromise).rejects.toMatchObject({
        message: 'Error executing operation on test-context',
        data: { originalError: error },
      });

      // Advance timer for each retry
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Wait for the rejection assertion
      await rejection;

      expect(operation).toHaveBeenCalledTimes(3); // Initial try + 2 retries
      expect(logger.error).toHaveBeenCalled();
    });

    it('should rethrow MCPError without wrapping', async () => {
      const mcpError = new MCPError('Original MCP Error', 500);
      const operation = vi.fn().mockRejectedValue(mcpError);

      await expect(executeOperation(operation, 'test-context')).rejects.toThrow(mcpError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use default retry options', async () => {
      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValue(error);

      // Default retryCount is 0, so should only try once
      await expect(executeOperation(operation, 'test-context')).rejects.toThrow(MCPError);

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle string errors', async () => {
      const operation = vi.fn().mockRejectedValue('String error');

      await expect(executeOperation(operation, 'test-context')).rejects.toThrow(MCPError);

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
