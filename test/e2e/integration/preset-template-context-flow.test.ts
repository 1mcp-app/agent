import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { TemplateFilteringService } from '@src/core/filtering/templateFilteringService.js';
import { ConnectionManager } from '@src/core/server/connectionManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Server class for testing
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    transport: undefined,
    setRequestHandler: vi.fn(),
    ping: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock dependencies
vi.mock('@src/core/capabilities/capabilityManager.js', () => ({
  setupCapabilities: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@src/logger/mcpLoggingEnhancer.js', () => ({
  enhanceServerWithLogging: vi.fn(),
}));

vi.mock('@src/domains/preset/services/presetNotificationService.js', () => ({
  PresetNotificationService: {
    getInstance: vi.fn(() => ({
      trackClient: vi.fn(),
      untrackClient: vi.fn(),
    })),
  },
}));

vi.mock('@src/logger/logger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    debugIf: vi.fn(),
  };
  return {
    __esModule: true,
    default: mockLogger,
    debugIf: mockLogger.debugIf,
  };
});

vi.mock('@src/core/server/clientInstancePool.js', () => ({
  ClientInstancePool: vi.fn().mockImplementation(() => ({
    getOrCreateClientInstance: vi.fn().mockResolvedValue({
      id: 'test-instance-id',
      templateName: 'serena',
      client: {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        setRequestHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        ping: vi.fn().mockResolvedValue({}),
      },
      transport: {
        close: vi.fn().mockResolvedValue(undefined),
      },
      renderedHash: 'test-rendered-hash',
      referenceCount: 1,
    }),
    removeClientFromInstance: vi.fn(),
    getInstance: vi.fn(),
    getTemplateInstances: vi.fn(() => []),
    getAllInstances: vi.fn(() => []),
    removeInstance: vi.fn().mockResolvedValue(undefined),
    cleanupIdleInstances: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(() => ({
      totalInstances: 0,
      activeInstances: 0,
      idleInstances: 0,
      templateCount: 0,
      totalClients: 0,
    })),
  })),
}));

/**
 * E2E integration test for the preset + template context flow.
 *
 * This test verifies the integration scenario where:
 * 1. A preset is configured with a tag query that filters for specific tags
 * 2. Template servers are configured with matching tags
 * 3. A client connects with a specific session ID via context
 * 4. Template servers are created and properly associated with the session
 * 5. The filtering logic correctly includes template servers for the session
 *
 * This test covers the bug fix where context.sessionId was not being properly
 * merged into InboundConnection.context, causing filterConnectionsForSession
 * to fail to find matching template servers.
 */
describe('Preset + Template Context Flow Integration', () => {
  let tempConfigDir: string;
  let mcpConfigPath: string;
  let configManager: ConfigManager;
  let presetManager: PresetManager;
  let connectionManager: ConnectionManager;
  let templateServerManager: TemplateServerManager;

  // Mock session and context data
  const sessionId = `e2e-test-session-${randomBytes(8).toString('hex')}`;
  const mockContext: ContextData = {
    sessionId,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    project: {
      name: 'e2e-test-project',
      path: '/tmp/test',
      environment: 'development',
    },
    user: {
      username: 'e2e-test-user',
      home: '/home/test',
    },
    environment: {
      variables: {
        NODE_ENV: 'test',
      },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temporary config directory
    tempConfigDir = join(tmpdir(), `preset-template-e2e-${randomBytes(4).toString('hex')}`);
    await fs.mkdir(tempConfigDir, { recursive: true });

    mcpConfigPath = join(tempConfigDir, 'mcp.json');

    // Reset singleton instances
    (ConfigManager as any).instance = null;
    (McpConfigManager as any).instance = null;
    (PresetManager as any).instance = null;
    (ServerManager as any).instance = null;

    // Initialize managers
    configManager = ConfigManager.getInstance(mcpConfigPath);
    await McpConfigManager.getInstance(mcpConfigPath);
    presetManager = PresetManager.getInstance(tempConfigDir);
    await presetManager.initialize();

    // Initialize connection manager with mock config
    const serverConfig = { name: 'test-server', version: '1.0.0' };
    const serverCapabilities = { capabilities: { tools: {} } };
    const outboundConns = new Map();
    connectionManager = new ConnectionManager(serverConfig, serverCapabilities, outboundConns);

    // Initialize template server manager
    templateServerManager = new TemplateServerManager();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Reset singletons
    (ConfigManager as any).instance = null;
    (McpConfigManager as any).instance = null;
    (PresetManager as any).instance = null;
    (ServerManager as any).instance = null;

    // Cleanup managers
    if (connectionManager) {
      await connectionManager.cleanup();
    }
    if (templateServerManager) {
      templateServerManager.cleanup();
    }
  });

  describe('context merge with sessionId for template filtering', () => {
    it('should properly merge context parameter into InboundConnection.context', async () => {
      // This test verifies the core bug fix: when a client connects with
      // context containing sessionId, it should be merged into the
      // InboundConnection.context for proper session-scoped filtering

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      } as any;

      const opts = {
        tags: ['serena'],
        enablePagination: false,
        presetName: 'dev-backend',
        tagFilterMode: 'preset' as const,
      };

      // Connect with context that includes sessionId
      await connectionManager.connectTransport(mockTransport, sessionId, opts, mockContext);

      // Verify the connection was created
      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      expect(server?.context).toBeDefined();
      expect(server?.context?.sessionId).toBe(sessionId);
    });

    it('should preserve context when opts.context is also provided', async () => {
      // Test that opts.context doesn't override the context parameter's sessionId
      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      } as any;

      const opts = {
        tags: ['serena'],
        enablePagination: false,
        presetName: 'dev-backend',
        tagFilterMode: 'preset' as const,
        context: {
          project: {
            path: '/opts/project',
            name: 'opts-project',
            environment: 'production',
          },
        },
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, mockContext);

      const server = connectionManager.getServer(sessionId);
      expect(server?.context).toBeDefined();
      // The sessionId from context parameter should be preserved
      expect(server?.context?.sessionId).toBe(sessionId);
      // opts.context properties should be merged
      expect(server?.context?.project?.path).toBe('/opts/project');
    });

    it('should use opts.context when context parameter is undefined', async () => {
      // Test backward compatibility: when no context parameter is provided,
      // opts.context should be used
      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      } as any;

      const altSessionId = `alt-session-${randomBytes(4).toString('hex')}`;

      const opts = {
        tags: ['serena'],
        enablePagination: false,
        presetName: 'dev-backend',
        tagFilterMode: 'preset' as const,
        context: {
          sessionId: altSessionId,
          project: {
            path: '/opts/project',
            name: 'opts-project',
            environment: 'production',
          },
        },
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, undefined);

      const server = connectionManager.getServer(sessionId);
      expect(server?.context).toBeDefined();
      expect(server?.context?.sessionId).toBe(altSessionId);
    });
  });

  describe('preset and template filtering integration', () => {
    it('should filter templates by preset tag query', async () => {
      // Create preset with tag query
      await presetManager.savePreset('dev-backend', {
        description: 'Development backend servers',
        strategy: 'or',
        tagQuery: { tag: 'serena' },
      });

      // Create MCP config with template servers
      const mcpConfig = {
        templateSettings: {
          cacheContext: true,
          validateTemplates: true,
        },
        mcpServers: {},
        mcpTemplates: {
          serena: {
            command: 'node',
            args: ['--version'],
            tags: ['serena'],
            template: {
              shareable: true,
            },
          },
          'other-server': {
            command: 'echo',
            args: ['test'],
            tags: ['other'],
            template: {
              shareable: true,
            },
          },
        },
      };

      await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Get matching templates using the preset's tag query
      const templates = Object.entries(mcpConfig.mcpTemplates || {});

      const connectionConfig = {
        tags: undefined,
        tagFilterMode: 'preset' as const,
        presetName: 'dev-backend',
        tagQuery: { tag: 'serena' },
        enablePagination: false,
      };

      const filteredTemplates = TemplateFilteringService.getMatchingTemplates(templates, connectionConfig);

      // Should only include serena template (has 'serena' tag)
      expect(filteredTemplates).toHaveLength(1);
      expect(filteredTemplates[0][0]).toBe('serena');

      // Should NOT include other-server (has 'other' tag, not 'serena')
      const hasOtherServer = filteredTemplates.some(([name]) => name === 'other-server');
      expect(hasOtherServer).toBe(false);
    });

    it('should handle MongoDB-style tag queries in presets', async () => {
      // Create preset with complex tag query
      await presetManager.savePreset('complex-preset', {
        description: 'Complex tag query preset',
        strategy: 'and',
        tagQuery: {
          $and: [{ tag: 'backend' }, { tag: 'api' }],
        },
      });

      // Create MCP config with various template servers
      const mcpConfig = {
        templateSettings: {
          cacheContext: true,
        },
        mcpServers: {},
        mcpTemplates: {
          'backend-api': {
            command: 'node',
            args: ['api.js'],
            tags: ['backend', 'api'],
            template: { shareable: true },
          },
          'backend-worker': {
            command: 'node',
            args: ['worker.js'],
            tags: ['backend', 'worker'],
            template: { shareable: true },
          },
          'frontend-api': {
            command: 'node',
            args: ['server.js'],
            tags: ['frontend', 'api'],
            template: { shareable: true },
          },
        },
      };

      await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      const templates = Object.entries(mcpConfig.mcpTemplates || {});

      const connectionConfig = {
        tags: undefined,
        tagFilterMode: 'preset' as const,
        presetName: 'complex-preset',
        tagQuery: {
          $and: [{ tag: 'backend' }, { tag: 'api' }],
        },
        enablePagination: false,
      };

      const filteredTemplates = TemplateFilteringService.getMatchingTemplates(templates, connectionConfig);

      // Should only include backend-api (has both 'backend' AND 'api' tags)
      expect(filteredTemplates).toHaveLength(1);
      expect(filteredTemplates[0][0]).toBe('backend-api');
    });
  });

  describe('session-to-renderedHash mapping', () => {
    it('should track session to rendered hash mappings', async () => {
      // Verify that TemplateServerManager properly tracks which rendered hash
      // is used by each session for shareable template servers

      const templateName = 'test-template';
      const renderedHash = 'abc123def456';

      // Manually set up internal state for testing
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([[sessionId, new Map([[templateName, renderedHash]])]]);

      // Verify getRenderedHashForSession works
      const retrievedHash = templateServerManager.getRenderedHashForSession(sessionId, templateName);
      expect(retrievedHash).toBe(renderedHash);

      // Verify getAllRenderedHashesForSession works
      const allHashes = templateServerManager.getAllRenderedHashesForSession(sessionId);
      expect(allHashes).toBeInstanceOf(Map);
      expect(allHashes?.size).toBe(1);
      expect(allHashes?.get(templateName)).toBe(renderedHash);
    });

    it('should return undefined for non-existent session', () => {
      const hash = templateServerManager.getRenderedHashForSession('non-existent-session', 'test-template');
      expect(hash).toBeUndefined();
    });

    it('should return undefined for non-existent template', () => {
      // Set up a session with one template
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([[sessionId, new Map([['template-1', 'hash1']])]]);

      // Query for a different template
      const hash = templateServerManager.getRenderedHashForSession(sessionId, 'non-existent-template');
      expect(hash).toBeUndefined();
    });
  });

  describe('multiple sessions with same template', () => {
    it('should handle multiple sessions using the same shareable template', async () => {
      // Verify that multiple sessions can use the same shareable template server
      // (same rendered hash) without conflicts

      const session1Id = `session-1-${randomBytes(4).toString('hex')}`;
      const session2Id = `session-2-${randomBytes(4).toString('hex')}`;
      const templateName = 'shared-template';
      const sharedHash = 'shared-rendered-hash-123';

      // Set up internal state - both sessions use the same rendered hash
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([
        [session1Id, new Map([[templateName, sharedHash]])],
        [session2Id, new Map([[templateName, sharedHash]])],
      ]);

      // Both sessions should get the same hash
      const hash1 = templateServerManager.getRenderedHashForSession(session1Id, templateName);
      const hash2 = templateServerManager.getRenderedHashForSession(session2Id, templateName);

      expect(hash1).toBe(sharedHash);
      expect(hash2).toBe(sharedHash);
      expect(hash1).toBe(hash2); // Same hash for shareable template
    });

    it('should handle different rendered hashes for different contexts', async () => {
      // Verify that the same template with different contexts gets different hashes

      const session1Id = `session-context-1-${randomBytes(4).toString('hex')}`;
      const session2Id = `session-context-2-${randomBytes(4).toString('hex')}`;
      const templateName = 'context-sensitive-template';

      // Different contexts produce different rendered hashes
      const hash1 = 'hash-context-1-abc';
      const hash2 = 'hash-context-2-def';

      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([
        [session1Id, new Map([[templateName, hash1]])],
        [session2Id, new Map([[templateName, hash2]])],
      ]);

      const retrievedHash1 = templateServerManager.getRenderedHashForSession(session1Id, templateName);
      const retrievedHash2 = templateServerManager.getRenderedHashForSession(session2Id, templateName);

      expect(retrievedHash1).toBe(hash1);
      expect(retrievedHash2).toBe(hash2);
      expect(retrievedHash1).not.toBe(retrievedHash2);
    });
  });
});
