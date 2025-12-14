import { EventEmitter } from 'events';

import logger from '@src/logger/logger.js';

/**
 * Progress tracking service for server management operations
 * Provides step-by-step progress indicators with dynamic progress bars
 */

export interface OperationProgress {
  operationId: string;
  operationType: string;
  currentStep: number;
  totalSteps: number;
  stepName: string;
  progress: number; // 0-100
  message?: string;
  startedAt: Date;
  updatedAt: Date;
}

export interface OperationResult {
  success: boolean;
  operationId: string;
  duration: number;
  message?: string;
  error?: Error;
}

export type OperationType = 'install' | 'update' | 'uninstall' | 'search';

export class ProgressTrackingService extends EventEmitter {
  private operations: Map<string, OperationProgress> = new Map();

  /**
   * Start tracking an operation
   */
  startOperation(operationId: string, operationType: OperationType, totalSteps: number = 5): void {
    const progress: OperationProgress = {
      operationId,
      operationType,
      currentStep: 0,
      totalSteps,
      stepName: 'Initializing...',
      progress: 0,
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    this.operations.set(operationId, progress);
    this.emit('operation-started', progress);

    logger.info(
      `🚀 ${operationType.charAt(0).toUpperCase() + operationType.slice(1)} operation started: ${operationId}`,
    );
  }

  /**
   * Update progress for an operation
   */
  updateProgress(operationId: string, currentStep: number, stepName: string, message?: string): void {
    const progress = this.operations.get(operationId);
    if (!progress) {
      logger.warn(`No progress tracked for operation: ${operationId}`);
      return;
    }

    const newProgress = progress.totalSteps > 0 ? Math.round((currentStep / progress.totalSteps) * 100) : 0;

    progress.currentStep = currentStep;
    progress.stepName = stepName;
    progress.progress = Math.max(0, Math.min(100, newProgress));
    progress.message = message;
    progress.updatedAt = new Date();

    this.emit('progress-updated', progress);

    const progressPercentage = Math.max(0, Math.min(100, newProgress));
    const progressBarWidth = Math.floor(progressPercentage / 5);
    const progressBar = '█'.repeat(Math.max(0, progressBarWidth)) + '░'.repeat(Math.max(0, 20 - progressBarWidth));
    logger.info(`   [${progressBar}] ${progressPercentage}% - ${stepName}`);
  }

  /**
   * Complete an operation
   */
  completeOperation(operationId: string, result?: OperationResult): void {
    const progress = this.operations.get(operationId);
    if (!progress) {
      logger.warn(`No progress tracked for operation: ${operationId}`);
      return;
    }

    const duration = new Date().getTime() - progress.startedAt.getTime();

    const operationResult: OperationResult = {
      success: true,
      operationId,
      duration,
      ...result,
    };

    this.emit('operation-completed', operationResult);
    this.operations.delete(operationId);

    logger.info(`✅ Operation completed in ${duration}ms: ${operationId}`);
  }

  /**
   * Fail an operation
   */
  failOperation(operationId: string, error: Error): void {
    const progress = this.operations.get(operationId);
    if (!progress) {
      logger.warn(`No progress tracked for operation: ${operationId}`);
      return;
    }

    const duration = new Date().getTime() - progress.startedAt.getTime();

    const operationResult: OperationResult = {
      success: false,
      operationId,
      duration,
      error,
      message: error.message,
    };

    this.emit('operation-failed', operationResult);
    this.operations.delete(operationId);

    logger.error(`❌ Operation failed after ${duration}ms: ${operationId} - ${error.message}`);
  }

  /**
   * Get operation status
   */
  getOperationStatus(operationId: string): OperationProgress | undefined {
    return this.operations.get(operationId);
  }
}

/**
 * Singleton instance of progress tracking service
 */
let progressTrackingServiceInstance: ProgressTrackingService | null = null;

export function getProgressTrackingService(): ProgressTrackingService {
  if (!progressTrackingServiceInstance) {
    progressTrackingServiceInstance = new ProgressTrackingService();
  }
  return progressTrackingServiceInstance;
}
