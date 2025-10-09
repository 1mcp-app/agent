import type { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenEstimationService } from './tokenEstimationService.js';

// Mock tiktoken
vi.mock('tiktoken', () => ({
  get_encoding: vi.fn(() => ({
    encode: vi.fn((text: string) => Array.from({ length: Math.ceil(text.length / 3.5) }, (_, i) => i)),
    free: vi.fn(),
  })),
}));

describe('TokenEstimationService', () => {
  let service: TokenEstimationService;

  beforeEach(() => {
    service = new TokenEstimationService();
  });

  afterEach(() => {
    service.dispose();
  });

  describe('estimateServerTokens', () => {
    it('should estimate tokens for a server with tools', () => {
      const tools: Tool[] = [
        {
          name: 'test-tool',
          description: 'A test tool for demonstration',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string', description: 'First parameter' },
              param2: { type: 'number', description: 'Second parameter' },
            },
            required: ['param1'],
          },
        },
      ];

      const result = service.estimateServerTokens('test-server', tools, [], [], true);

      expect(result.serverName).toBe('test-server');
      expect(result.connected).toBe(true);
      expect(result.breakdown.tools).toHaveLength(1);
      expect(result.breakdown.tools[0].name).toBe('test-tool');
      expect(result.breakdown.tools[0].tokens).toBeGreaterThan(0);
      expect(result.breakdown.totalTokens).toBeGreaterThan(result.breakdown.serverOverhead);
    });

    it('should estimate tokens for a server with resources', () => {
      const resources: Resource[] = [
        {
          uri: 'file://test-resource.txt',
          name: 'Test Resource',
          description: 'A test resource for demonstration',
          mimeType: 'text/plain',
        },
      ];

      const result = service.estimateServerTokens('test-server', [], resources, [], true);

      expect(result.serverName).toBe('test-server');
      expect(result.connected).toBe(true);
      expect(result.breakdown.resources).toHaveLength(1);
      expect(result.breakdown.resources[0].uri).toBe('file://test-resource.txt');
      expect(result.breakdown.resources[0].tokens).toBeGreaterThan(0);
      expect(result.breakdown.totalTokens).toBeGreaterThan(result.breakdown.serverOverhead);
    });

    it('should estimate tokens for a server with prompts', () => {
      const prompts: Prompt[] = [
        {
          name: 'test-prompt',
          description: 'A test prompt for demonstration',
          arguments: [
            {
              name: 'context',
              description: 'Context for the prompt',
              required: true,
            },
            {
              name: 'format',
              description: 'Output format',
              required: false,
            },
          ],
        },
      ];

      const result = service.estimateServerTokens('test-server', [], [], prompts, true);

      expect(result.serverName).toBe('test-server');
      expect(result.connected).toBe(true);
      expect(result.breakdown.prompts).toHaveLength(1);
      expect(result.breakdown.prompts[0].name).toBe('test-prompt');
      expect(result.breakdown.prompts[0].tokens).toBeGreaterThan(0);
      expect(result.breakdown.prompts[0].argumentsTokens).toBeGreaterThan(0);
      expect(result.breakdown.totalTokens).toBeGreaterThan(result.breakdown.serverOverhead);
    });

    it('should handle mixed capabilities', () => {
      const tools: Tool[] = [
        {
          name: 'search',
          description: 'Search for information',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
      ];

      const resources: Resource[] = [
        {
          uri: 'database://users',
          name: 'Users Database',
          description: 'User information database',
        },
      ];

      const prompts: Prompt[] = [
        {
          name: 'analyze',
          description: 'Analyze data with context',
          arguments: [
            {
              name: 'data',
              description: 'Data to analyze',
              required: true,
            },
          ],
        },
      ];

      const result = service.estimateServerTokens('mixed-server', tools, resources, prompts, true);

      expect(result.serverName).toBe('mixed-server');
      expect(result.connected).toBe(true);
      expect(result.breakdown.tools).toHaveLength(1);
      expect(result.breakdown.resources).toHaveLength(1);
      expect(result.breakdown.prompts).toHaveLength(1);

      const expectedTotal =
        result.breakdown.tools.reduce((sum, tool) => sum + tool.tokens, 0) +
        result.breakdown.resources.reduce((sum, resource) => sum + resource.tokens, 0) +
        result.breakdown.prompts.reduce((sum, prompt) => sum + prompt.tokens, 0) +
        result.breakdown.serverOverhead;

      expect(result.breakdown.totalTokens).toBe(expectedTotal);
    });

    it('should handle disconnected servers', () => {
      const result = service.estimateServerTokens('disconnected-server', [], [], [], false);

      expect(result.serverName).toBe('disconnected-server');
      expect(result.connected).toBe(false);
      expect(result.breakdown.tools).toHaveLength(0);
      expect(result.breakdown.resources).toHaveLength(0);
      expect(result.breakdown.prompts).toHaveLength(0);
      expect(result.breakdown.totalTokens).toBe(result.breakdown.serverOverhead);
    });

    it('should handle empty capabilities', () => {
      const result = service.estimateServerTokens('empty-server', [], [], [], true);

      expect(result.serverName).toBe('empty-server');
      expect(result.connected).toBe(true);
      expect(result.breakdown.tools).toHaveLength(0);
      expect(result.breakdown.resources).toHaveLength(0);
      expect(result.breakdown.prompts).toHaveLength(0);
      expect(result.breakdown.totalTokens).toBe(result.breakdown.serverOverhead);
    });
  });

  describe('calculateAggregateStats', () => {
    it('should calculate correct aggregate statistics', () => {
      const estimates = [
        {
          serverName: 'server1',
          connected: true,
          breakdown: {
            tools: [{ name: 'tool1', tokens: 100, description: 'Test tool 1' }],
            resources: [{ uri: 'resource1', tokens: 50, name: 'Test resource 1' }],
            prompts: [{ name: 'prompt1', tokens: 75, description: 'Test prompt 1', argumentsTokens: 25 }],
            serverOverhead: 75,
            totalTokens: 300,
          },
        },
        {
          serverName: 'server2',
          connected: true,
          breakdown: {
            tools: [
              { name: 'tool2', tokens: 120, description: 'Test tool 2' },
              { name: 'tool3', tokens: 80, description: 'Test tool 3' },
            ],
            resources: [],
            prompts: [],
            serverOverhead: 75,
            totalTokens: 275,
          },
        },
        {
          serverName: 'server3',
          connected: false,
          breakdown: {
            tools: [],
            resources: [],
            prompts: [],
            serverOverhead: 75,
            totalTokens: 75,
          },
          error: 'Connection failed',
        },
      ];

      const stats = service.calculateAggregateStats(estimates);

      expect(stats.totalServers).toBe(3);
      expect(stats.connectedServers).toBe(2);
      expect(stats.totalTools).toBe(3); // tool1, tool2, tool3
      expect(stats.totalResources).toBe(1); // resource1
      expect(stats.totalPrompts).toBe(1); // prompt1
      expect(stats.overallTokens).toBe(575); // 300 + 275 (excluding disconnected server)
      expect(stats.serverBreakdown).toEqual({
        server1: 300,
        server2: 275,
      });
    });

    it('should handle empty estimates array', () => {
      const stats = service.calculateAggregateStats([]);

      expect(stats.totalServers).toBe(0);
      expect(stats.connectedServers).toBe(0);
      expect(stats.totalTools).toBe(0);
      expect(stats.totalResources).toBe(0);
      expect(stats.totalPrompts).toBe(0);
      expect(stats.overallTokens).toBe(0);
      expect(stats.serverBreakdown).toEqual({});
    });

    it('should exclude servers with errors from connected count', () => {
      const estimates = [
        {
          serverName: 'good-server',
          connected: true,
          breakdown: {
            tools: [],
            resources: [],
            prompts: [],
            serverOverhead: 75,
            totalTokens: 75,
          },
        },
        {
          serverName: 'error-server',
          connected: true,
          breakdown: {
            tools: [],
            resources: [],
            prompts: [],
            serverOverhead: 75,
            totalTokens: 75,
          },
          error: 'Some error occurred',
        },
      ];

      const stats = service.calculateAggregateStats(estimates);

      expect(stats.totalServers).toBe(2);
      expect(stats.connectedServers).toBe(1); // Should exclude error-server
      expect(stats.overallTokens).toBe(75); // Should only count good-server
    });
  });

  describe('dispose', () => {
    it('should dispose encoder without throwing', () => {
      expect(() => service.dispose()).not.toThrow();
    });

    it('should handle missing encoder', () => {
      // Create a service where encoder initialization failed
      const serviceWithNoEncoder = new TokenEstimationService();
      (serviceWithNoEncoder as any).encoder = null;

      expect(() => serviceWithNoEncoder.dispose()).not.toThrow();
    });
  });
});

// Test with tiktoken encoder failure
describe('TokenEstimationService with tiktoken failure', () => {
  beforeEach(() => {
    // Mock tiktoken to throw an error
    vi.doMock('tiktoken', () => ({
      get_encoding: vi.fn(() => {
        throw new Error('tiktoken initialization failed');
      }),
    }));
  });

  it('should fallback to character-based estimation when tiktoken fails', () => {
    // This will trigger the fallback mechanism
    const service = new TokenEstimationService();

    const tools: Tool[] = [
      {
        name: 'fallback-tool',
        description: 'A tool to test fallback estimation',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input parameter' },
          },
        },
      },
    ];

    const result = service.estimateServerTokens('fallback-server', tools, [], [], true);

    expect(result.serverName).toBe('fallback-server');
    expect(result.connected).toBe(true);
    expect(result.breakdown.tools).toHaveLength(1);
    expect(result.breakdown.tools[0].tokens).toBeGreaterThan(0);
    expect(result.breakdown.totalTokens).toBeGreaterThan(result.breakdown.serverOverhead);

    service.dispose();
  });
});
