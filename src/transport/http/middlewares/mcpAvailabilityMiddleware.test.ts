// @ts-nocheck
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { LoadingState, LoadingStateTracker, ServerLoadingInfo } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { MCPServerParams } from '@src/core/types/index.js';

import { NextFunction, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMcpAvailabilityMiddleware, McpRequest } from './mcpAvailabilityMiddleware.js';
import { getValidatedTags } from './scopeAuthMiddleware.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('./scopeAuthMiddleware.js', () => ({
  getValidatedTags: vi.fn(),
}));

vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
}));

describe('McpAvailabilityMiddleware - Tag Filtering', () => {
  let mockLoadingManager: Partial<McpLoadingManager>;
  let mockStateTracker: Partial<LoadingStateTracker>;
  let mockConfigManager: Partial<McpConfigManager>;
  let req: Partial<McpRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock state tracker
    mockStateTracker = {
      getAllServerStates: vi.fn(),
      isLoadingComplete: vi.fn().mockReturnValue(true),
      getServerState: vi.fn(),
    };

    // Mock loading manager
    mockLoadingManager = {
      getStateTracker: vi.fn().mockReturnValue(mockStateTracker),
      getSummary: vi.fn().mockReturnValue({
        totalServers: 3,
        ready: 2,
        failed: 1,
        loading: 0,
        pending: 0,
        awaitingOAuth: 0,
        cancelled: 0,
        successRate: 66.7,
        averageLoadTime: 2000,
      }),
    };

    // Mock config manager
    mockConfigManager = {
      getTransportConfig: vi.fn(),
    };

    vi.mocked(McpConfigManager.getInstance).mockReturnValue(mockConfigManager as McpConfigManager);

    req = {};
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    next = vi.fn() as unknown as NextFunction;
  });

  it('should filter servers by tags correctly', () => {
    // Setup server states
    const serverStates = new Map<string, ServerLoadingInfo>([
      ['server1', { name: 'server1', state: LoadingState.Ready, retryCount: 0 }],
      ['server2', { name: 'server2', state: LoadingState.Ready, retryCount: 0 }],
      ['server3', { name: 'server3', state: LoadingState.Failed, retryCount: 3 }],
    ]);

    // Setup server configurations with tags
    const transportConfig: Record<string, MCPServerParams> = {
      server1: { type: 'stdio', command: 'test1', tags: ['web', 'api'] },
      server2: { type: 'stdio', command: 'test2', tags: ['database', 'storage'] },
      server3: { type: 'stdio', command: 'test3', tags: ['web', 'frontend'] },
    };

    vi.mocked(mockStateTracker!.getAllServerStates).mockReturnValue(serverStates);
    vi.mocked(mockStateTracker!.getServerState).mockImplementation(
      (name: string) => serverStates.get(name) || undefined,
    );
    vi.mocked(mockConfigManager!.getTransportConfig).mockReturnValue(transportConfig);
    vi.mocked(getValidatedTags).mockReturnValue(['web']);

    const middleware = createMcpAvailabilityMiddleware(mockLoadingManager as McpLoadingManager);
    middleware(req as McpRequest, res as Response, next);

    // Should only include servers with 'web' tag (server1 and server3)
    expect(req.mcpAvailability).toBeDefined();
    expect(req.mcpAvailability?.requestedTags).toEqual(['web']);
    expect(req.mcpAvailability?.totalServersBeforeFiltering).toBe(3);

    // server1 is ready and has 'web' tag, server3 has 'web' tag but is failed
    expect(req.mcpAvailability?.availableServers).toEqual(['server1']);
    expect(req.mcpAvailability?.unavailableServers).toEqual(['server3']);
    expect(req.mcpAvailability?.loadingServers).toEqual([]);

    expect(next).toHaveBeenCalled();
  });

  it('should require ALL requested tags', () => {
    // Setup server states
    const serverStates = new Map<string, ServerLoadingInfo>([
      ['server1', { name: 'server1', state: LoadingState.Ready, retryCount: 0 }],
      ['server2', { name: 'server2', state: LoadingState.Ready, retryCount: 0 }],
      ['server3', { name: 'server3', state: LoadingState.Ready, retryCount: 0 }],
    ]);

    // Setup server configurations with tags
    const transportConfig: Record<string, MCPServerParams> = {
      server1: { type: 'stdio', command: 'test1', tags: ['web', 'api'] },
      server2: { type: 'stdio', command: 'test2', tags: ['web'] }, // Missing 'api'
      server3: { type: 'stdio', command: 'test3', tags: ['api'] }, // Missing 'web'
    };

    vi.mocked(mockStateTracker!.getAllServerStates).mockReturnValue(serverStates);
    vi.mocked(mockStateTracker!.getServerState).mockImplementation(
      (name: string) => serverStates.get(name) || undefined,
    );
    vi.mocked(mockConfigManager!.getTransportConfig).mockReturnValue(transportConfig);
    vi.mocked(getValidatedTags).mockReturnValue(['web', 'api']); // Request both tags

    const middleware = createMcpAvailabilityMiddleware(mockLoadingManager as McpLoadingManager);
    middleware(req as McpRequest, res as Response, next);

    // Only server1 has both 'web' AND 'api' tags
    expect(req.mcpAvailability?.availableServers).toEqual(['server1']);
    expect(req.mcpAvailability?.requestedTags).toEqual(['web', 'api']);
    expect(req.mcpAvailability?.totalServersBeforeFiltering).toBe(3);

    expect(next).toHaveBeenCalled();
  });

  it('should be case-insensitive when matching tags', () => {
    // Setup server states
    const serverStates = new Map<string, ServerLoadingInfo>([
      ['server1', { name: 'server1', state: LoadingState.Ready, retryCount: 0 }],
      ['server2', { name: 'server2', state: LoadingState.Ready, retryCount: 0 }],
    ]);

    // Setup server configurations with mixed case tags
    const transportConfig: Record<string, MCPServerParams> = {
      server1: { type: 'stdio', command: 'test1', tags: ['WEB', 'Api'] },
      server2: { type: 'stdio', command: 'test2', tags: ['database'] },
    };

    vi.mocked(mockStateTracker!.getAllServerStates).mockReturnValue(serverStates);
    vi.mocked(mockStateTracker!.getServerState).mockImplementation(
      (name: string) => serverStates.get(name) || undefined,
    );
    vi.mocked(mockConfigManager!.getTransportConfig).mockReturnValue(transportConfig);
    vi.mocked(getValidatedTags).mockReturnValue(['web', 'api']); // lowercase request

    const middleware = createMcpAvailabilityMiddleware(mockLoadingManager as McpLoadingManager);
    middleware(req as McpRequest, res as Response, next);

    // server1 should match despite case differences
    expect(req.mcpAvailability?.availableServers).toEqual(['server1']);

    expect(next).toHaveBeenCalled();
  });

  it('should exclude servers with no tags when tags are requested', () => {
    // Setup server states
    const serverStates = new Map<string, ServerLoadingInfo>([
      ['server1', { name: 'server1', state: LoadingState.Ready, retryCount: 0 }],
      ['server2', { name: 'server2', state: LoadingState.Ready, retryCount: 0 }],
      ['server3', { name: 'server3', state: LoadingState.Ready, retryCount: 0 }],
    ]);

    // Setup server configurations - server2 has no tags
    const transportConfig: Record<string, MCPServerParams> = {
      server1: { type: 'stdio', command: 'test1', tags: ['web'] },
      server2: { type: 'stdio', command: 'test2' }, // No tags property
      server3: { type: 'stdio', command: 'test3', tags: [] }, // Empty tags array
    };

    vi.mocked(mockStateTracker!.getAllServerStates).mockReturnValue(serverStates);
    vi.mocked(mockStateTracker!.getServerState).mockImplementation(
      (name: string) => serverStates.get(name) || undefined,
    );
    vi.mocked(mockConfigManager!.getTransportConfig).mockReturnValue(transportConfig);
    vi.mocked(getValidatedTags).mockReturnValue(['web']);

    const middleware = createMcpAvailabilityMiddleware(mockLoadingManager as McpLoadingManager);
    middleware(req as McpRequest, res as Response, next);

    // Only server1 should be included
    expect(req.mcpAvailability?.availableServers).toEqual(['server1']);
    expect(req.mcpAvailability?.totalServersBeforeFiltering).toBe(3);

    expect(next).toHaveBeenCalled();
  });

  it('should include all servers when no tags are requested', () => {
    // Setup server states
    const serverStates = new Map<string, ServerLoadingInfo>([
      ['server1', { name: 'server1', state: LoadingState.Ready, retryCount: 0 }],
      ['server2', { name: 'server2', state: LoadingState.Ready, retryCount: 0 }],
      ['server3', { name: 'server3', state: LoadingState.Failed, retryCount: 3 }],
    ]);

    // Setup server configurations with various tags
    const transportConfig: Record<string, MCPServerParams> = {
      server1: { type: 'stdio', command: 'test1', tags: ['web'] },
      server2: { type: 'stdio', command: 'test2' }, // No tags
      server3: { type: 'stdio', command: 'test3', tags: ['database'] },
    };

    vi.mocked(mockStateTracker!.getAllServerStates).mockReturnValue(serverStates);
    vi.mocked(mockStateTracker!.getServerState).mockImplementation(
      (name: string) => serverStates.get(name) || undefined,
    );
    vi.mocked(mockConfigManager!.getTransportConfig).mockReturnValue(transportConfig);
    vi.mocked(getValidatedTags).mockReturnValue([]); // No tags requested

    const middleware = createMcpAvailabilityMiddleware(mockLoadingManager as McpLoadingManager);
    middleware(req as McpRequest, res as Response, next);

    // All servers should be included regardless of tags
    expect(req.mcpAvailability?.availableServers).toEqual(['server1', 'server2']);
    expect(req.mcpAvailability?.unavailableServers).toEqual(['server3']);
    expect(req.mcpAvailability?.requestedTags).toBeUndefined();
    expect(req.mcpAvailability?.totalServersBeforeFiltering).toBeUndefined();

    expect(next).toHaveBeenCalled();
  });
});
