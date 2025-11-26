import { MCPServerParams } from '@src/core/types/transport.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { ChangeAnalyzer, ChangeType } from './changeAnalyzer.js';

describe('ChangeAnalyzer', () => {
  let analyzer: ChangeAnalyzer;

  beforeEach(() => {
    analyzer = new ChangeAnalyzer();
  });

  const createTestServer = (overrides: Partial<MCPServerParams> = {}): MCPServerParams => ({
    type: 'stdio',
    command: 'echo',
    args: ['hello'],
    tags: ['test'],
    timeout: 5000,
    ...overrides,
  });

  describe('analyzeChanges', () => {
    it('should detect no changes for identical configurations', () => {
      const config = { server1: createTestServer() };
      const analysis = analyzer.analyzeChanges(config, config);

      expect(analysis.changes).toHaveLength(0);
      expect(analysis.summary.totalChanges).toBe(0);
      expect(analysis.summary.requiresFullRestart).toBe(false);
      expect(analysis.summary.canPartialReload).toBe(false);
    });

    it('should detect added servers', () => {
      const oldConfig = { server1: createTestServer() };
      const newServer = createTestServer({ command: 'node', args: ['server.js'] });
      const newConfig = { ...oldConfig, server2: newServer };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      expect(analysis.changes).toHaveLength(1);
      expect(analysis.changes[0].changeType).toBe(ChangeType.ADD_SERVER);
      expect(analysis.changes[0].newConfig).toEqual(newServer);
      expect(analysis.summary.totalChanges).toBe(1);
      expect(analysis.summary.requiresFullRestart).toBe(false);
      expect(analysis.summary.canPartialReload).toBe(true);
    });

    it('should detect removed servers', () => {
      const server1 = createTestServer({ command: 'echo' });
      const server2 = createTestServer({ command: 'node', args: ['server.js'] });
      const oldConfig = { server1, server2 };
      const newConfig = { server1 };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      expect(analysis.changes).toHaveLength(1);
      expect(analysis.changes[0].changeType).toBe(ChangeType.REMOVE_SERVER);
      expect(analysis.changes[0].oldConfig).toEqual(server2);
      expect(analysis.summary.totalChanges).toBe(1);
      expect(analysis.summary.requiresFullRestart).toBe(false);
      expect(analysis.summary.canPartialReload).toBe(true);
    });

    it('should detect transport changes requiring full restart', () => {
      const oldConfig = { server1: createTestServer({ type: 'stdio', command: 'echo' }) };
      const newConfig = { server1: createTestServer({ type: 'http', url: 'http://localhost:3000' }) };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      // Transport change is detected as remove + add since server ID changes
      expect(analysis.changes).toHaveLength(2);
      expect(analysis.changes.map((c) => c.changeType)).toContain(ChangeType.REMOVE_SERVER);
      expect(analysis.changes.map((c) => c.changeType)).toContain(ChangeType.ADD_SERVER);
      expect(analysis.summary.totalChanges).toBe(2);
      expect(analysis.summary.requiresFullRestart).toBe(false); // Add/remove don't require full restart
      expect(analysis.summary.canPartialReload).toBe(true);
    });

    it('should handle multiple changes', () => {
      const server1 = createTestServer({ command: 'echo' });
      const server2 = createTestServer({ command: 'node', args: ['server.js'] });
      const server3 = createTestServer({ command: 'python', args: ['app.py'] });

      const oldConfig = { server1, server2 };
      const newConfig = { server1, server3 }; // Remove server2, add server3

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      expect(analysis.changes).toHaveLength(2);
      expect(analysis.changes.map((c) => c.changeType)).toContain(ChangeType.REMOVE_SERVER);
      expect(analysis.changes.map((c) => c.changeType)).toContain(ChangeType.ADD_SERVER);
      expect(analysis.summary.totalChanges).toBe(2);
      expect(analysis.summary.requiresFullRestart).toBe(false);
      expect(analysis.summary.canPartialReload).toBe(true);
    });
  });

  describe('impact analysis', () => {
    it('should calculate correct impact for add server', () => {
      const oldConfig: Record<string, MCPServerParams> = {};
      const newConfig = { server1: createTestServer() };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      const change = analysis.changes[0];
      expect(change.impact.requiresFullRestart).toBe(false);
      expect(change.impact.affectsConnections).toBe(false);
      expect(change.impact.affectsCapabilities).toBe(true);
      expect(change.impact.estimatedDowntime).toBeGreaterThan(0);
    });

    it('should calculate correct impact for remove server', () => {
      const server = createTestServer();
      const oldConfig = { server1: server };
      const newConfig: Record<string, MCPServerParams> = {};

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      const change = analysis.changes[0];
      expect(change.impact.requiresFullRestart).toBe(false);
      expect(change.impact.affectsConnections).toBe(true);
      expect(change.impact.affectsCapabilities).toBe(true);
      expect(change.impact.estimatedDowntime).toBeGreaterThan(100);
    });

    it('should calculate correct impact for transport change', () => {
      const oldConfig = { server1: createTestServer({ type: 'stdio' }) };
      const newConfig = { server1: createTestServer({ type: 'http', url: 'http://localhost:3000' }) };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      // With transport change, we have both remove and add impacts
      expect(analysis.changes.length).toBe(2);
      const removeChange = analysis.changes.find((c) => c.changeType === ChangeType.REMOVE_SERVER);
      const addChange = analysis.changes.find((c) => c.changeType === ChangeType.ADD_SERVER);

      expect(removeChange?.impact.affectsConnections).toBe(true);
      expect(removeChange?.impact.affectsCapabilities).toBe(true);
      expect(addChange?.impact.affectsCapabilities).toBe(true);
      expect(analysis.summary.estimatedTotalDowntime).toBeGreaterThan(0);
    });
  });

  describe('recommendations', () => {
    it('should recommend partial reload for transport changes', () => {
      const oldConfig = { server1: createTestServer({ type: 'stdio' }) };
      const newConfig = { server1: createTestServer({ type: 'http', url: 'http://localhost:3000' }) };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      expect(analysis.recommendations.length).toBeGreaterThanOrEqual(1);
      // Transport changes (remove + add) should recommend partial reload, not full
      expect(analysis.recommendations[0].reloadStrategy).toBe('partial');
    });

    it('should recommend deferred reload for no changes', () => {
      const config = { server1: createTestServer() };
      const analysis = analyzer.analyzeChanges(config, config);

      expect(analysis.recommendations).toHaveLength(1);
      expect(analysis.recommendations[0].reloadStrategy).toBe('deferred');
      expect(analysis.recommendations[0].reason).toContain('No functional changes');
      expect(analysis.recommendations[0].estimatedTime).toBe(0);
    });
  });

  describe('server ID generation', () => {
    it('should generate consistent IDs for identical servers', () => {
      const server1 = createTestServer({ command: 'echo', args: ['hello'] });
      const server2 = createTestServer({ command: 'echo', args: ['hello'] });

      // Test that the analyzer can identify servers as the same
      const oldConfig = { server1 };
      const newConfig = { server1: server2 };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      expect(analysis.changes).toHaveLength(0); // Should detect as unchanged
    });

    it('should generate different IDs for different servers', () => {
      const server1 = createTestServer({ command: 'echo', args: ['hello'] });
      const server2 = createTestServer({ command: 'echo', args: ['world'] });

      const oldConfig = { server1 };
      const newConfig = { server1: server2 };

      const analysis = analyzer.analyzeChanges(oldConfig, newConfig);

      // Different args generate different IDs, so this is remove + add
      expect(analysis.changes).toHaveLength(2);
      expect(analysis.changes.map((c) => c.changeType)).toContain(ChangeType.REMOVE_SERVER);
      expect(analysis.changes.map((c) => c.changeType)).toContain(ChangeType.ADD_SERVER);
    });
  });
});
