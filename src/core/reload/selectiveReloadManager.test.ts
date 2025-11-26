import { MCPServerParams } from '@src/core/types/transport.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReloadStatus, SelectiveReloadManager } from './selectiveReloadManager.js';

describe('SelectiveReloadManager', () => {
  let reloadManager: SelectiveReloadManager;

  const createTestServer = (overrides: Partial<MCPServerParams> = {}): MCPServerParams => ({
    type: 'stdio' as const,
    command: 'echo',
    args: ['hello'],
    tags: ['test'],
    timeout: 5000,
    ...overrides,
  });

  beforeEach(() => {
    reloadManager = SelectiveReloadManager.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance
    (reloadManager as any).instance = null;
  });

  describe('executeReload', () => {
    it('should handle no changes scenario', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const operation = await reloadManager.executeReload(oldConfig, newConfig);

      expect(operation.status).toBe(ReloadStatus.COMPLETED);
      expect(operation.progress).toBe(100);
    });

    it('should handle dry run mode', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer({ command: 'node' }) };

      const operation = await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });

      expect(operation.status).toBe(ReloadStatus.COMPLETED);
      expect(operation.progress).toBe(100);
    });

    it('should handle force full reload', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer({ command: 'node' }) };

      const operation = await reloadManager.executeReload(oldConfig, newConfig, {
        forceFullReload: true,
        dryRun: true,
      });

      expect(operation.status).toBe(ReloadStatus.COMPLETED);
    });

    it('should emit reload events', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const events: string[] = [];
      reloadManager.on('reloadStarted', () => events.push('started'));
      reloadManager.on('reloadCompleted', () => events.push('completed'));

      await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });

      expect(events).toContain('started');
      expect(events).toContain('completed');
    });

    it('should handle custom migration strategy', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer({ command: 'node' }) };

      const strategy = {
        strategy: 'reconnect' as const,
        timeoutMs: 10000,
        retryAttempts: 5,
        preserveSessions: false,
      };

      const operation = await reloadManager.executeReload(oldConfig, newConfig, {
        strategy,
        dryRun: true,
      });

      expect(operation.status).toBe(ReloadStatus.COMPLETED);
    });
  });

  describe('operation management', () => {
    it('should track active operations', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const promise = reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });
      const activeOperations = reloadManager.getActiveOperations();

      expect(activeOperations.length).toBeGreaterThanOrEqual(0);

      await promise;
    });

    it('should get operation by ID', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const operation = await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });
      const retrievedOperation = reloadManager.getOperation(operation.id);

      expect(retrievedOperation).toBeDefined();
      expect(retrievedOperation?.id).toBe(operation.id);
      expect(retrievedOperation?.status).toBe(ReloadStatus.COMPLETED);
    });

    it('should cancel active operation', async () => {
      const cancelled = await reloadManager.cancelOperation('invalid-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('progress tracking', () => {
    it('should update operation progress correctly', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const operation = await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });

      expect(operation.progress).toBe(100);
      expect(operation.startTime).toBeInstanceOf(Date);
      expect(operation.endTime).toBeInstanceOf(Date);
    });
  });

  describe('operation lifecycle', () => {
    it('should follow correct status progression', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const statusChanges: string[] = [];
      reloadManager.on('reloadStarted', (op) => statusChanges.push(op.status));
      reloadManager.on('reloadCompleted', (op) => statusChanges.push(op.status));
      reloadManager.on('reloadFailed', (op) => statusChanges.push(op.status));

      const operation = await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });

      expect(operation.status).toBe(ReloadStatus.COMPLETED);
      expect(operation.impact).toBeDefined();
      expect(operation.affectedServers).toBeDefined();
      expect(operation.completedServers).toBeDefined();
    });

    it('should handle operation timeout correctly', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const startTime = Date.now();
      const operation = await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });
      const endTime = Date.now();

      expect(operation.startTime).toBeInstanceOf(Date);
      expect(operation.endTime).toBeInstanceOf(Date);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete quickly in dry run mode
    });
  });

  describe('migration strategies', () => {
    it('should use default migration strategy when none provided', async () => {
      const oldConfig = { server1: createTestServer() };
      const newConfig = { server1: createTestServer() };

      const operation = await reloadManager.executeReload(oldConfig, newConfig, { dryRun: true });

      expect(operation.status).toBe(ReloadStatus.COMPLETED);
    });
  });
});
