import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { OperationOptions } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { MCPError } from './errorTypes.js';

/**
 * Executes an operation with error handling and retry logic
 * @param operation The operation to execute
 * @param contextName The execution context name for logging
 * @param options Operation options including timeout and retry settings
 * @returns The result of the operation
 */
export async function executeOperation<T>(
  operation: () => Promise<T>,
  contextName: string,
  options: OperationOptions = {},
): Promise<T> {
  const { retryCount = 0, retryDelay = 1000 } = options;

  let lastError: Error | undefined;
  for (let i = 0; i <= retryCount; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < retryCount) {
        logger.info(`Retrying operation ${operation.name} on ${contextName} after ${retryDelay}ms`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  // If we get here, we've exhausted all retries
  logger.error(`Operation failed on ${contextName} after ${retryCount + 1} attempts: ${lastError}`);

  if (lastError instanceof MCPError) {
    throw lastError;
  }

  const mcpError = new MCPError(`Error executing operation on ${contextName}`, ErrorCode.InternalError, {
    originalError: lastError,
  });
  throw mcpError;
}
