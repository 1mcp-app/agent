import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstructionAggregator } from '../instructions/instructionAggregator.js';
import { ClientStatus } from '../types/client.js';
import { TagExpression } from '../../utils/tagQueryParser.js';
import type { OutboundConnections, OutboundConnection, InboundConnectionConfig } from '../types/index.js';

// Mock dependencies
vi.mock('../../logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('InstructionAggregator - Filtered Instructions', () => {
  let instructionAggregator: InstructionAggregator;
  let mockOutboundConnections: OutboundConnections;

  beforeEach(() => {
    // Create mock outbound connections with different tags and instructions
    mockOutboundConnections = new Map([
      [
        'web-server',
        {
          name: 'web-server',
          transport: { tags: ['web', 'frontend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Web server instructions for frontend development',
        } as OutboundConnection,
      ],
      [
        'database-server',
        {
          name: 'database-server',
          transport: { tags: ['database', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Database server instructions for data management',
        } as OutboundConnection,
      ],
      [
        'api-server',
        {
          name: 'api-server',
          transport: { tags: ['api', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'API server instructions for backend services',
        } as OutboundConnection,
      ],
      [
        'dev-tools',
        {
          name: 'dev-tools',
          transport: { tags: ['development', 'tools'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Development tools instructions',
        } as OutboundConnection,
      ],
    ]);

    // Create instruction aggregator and populate it
    instructionAggregator = new InstructionAggregator();
    for (const [name, conn] of mockOutboundConnections) {
      if (conn.instructions) {
        instructionAggregator.setInstructions(name, conn.instructions);
      }
    }
  });

  describe('getFilteredInstructions', () => {
    it('should return educational template with all instructions when no filter is specified', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain educational template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('You are interacting with 1MCP');
      expect(filteredInstructions).toContain('4 MCP servers are currently available');
      expect(filteredInstructions).toContain('api-server');
      expect(filteredInstructions).toContain('database-server');
      expect(filteredInstructions).toContain('dev-tools');
      expect(filteredInstructions).toContain('web-server');

      // Should contain server instructions in XML-like tags
      expect(filteredInstructions).toContain('<api-server>');
      expect(filteredInstructions).toContain('API server instructions for backend services');
      expect(filteredInstructions).toContain('</api-server>');
      expect(filteredInstructions).toContain('<web-server>');
      expect(filteredInstructions).toContain('Web server instructions for frontend development');
      expect(filteredInstructions).toContain('</web-server>');
    });

    it('should use custom template when provided', () => {
      const customTemplate = 'Custom: {{serverCount}} servers - {{#each serverNames}}{{this}},{{/each}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate,
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(filteredInstructions).toBe('Custom: 4 servers - api-server,database-server,dev-tools,web-server,');
    });

    it('should use custom template with filtering', () => {
      const customTemplate = 'Filtered: {{serverCount}} servers{{filterContext}} - {{serverList}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
        customTemplate,
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(filteredInstructions).toContain('Filtered: 2 servers (filtered by tags: backend) - api-server');
      expect(filteredInstructions).toContain('database-server');
    });

    it('should fallback to default template on custom template error', () => {
      const invalidTemplate = '{{invalid syntax {{unclosed';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: invalidTemplate,
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should fall back to default template, not show error template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('You are interacting with 1MCP');
      expect(filteredInstructions).toContain('Currently Connected Servers');
      expect(filteredInstructions).not.toContain('Template Rendering Error');
    });

    it('should filter instructions by simple tags', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web', 'frontend'],
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain educational template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('(filtered by tags: web, frontend)');
      expect(filteredInstructions).toContain('1 MCP server is currently available');
      expect(filteredInstructions).toContain('web-server');

      // Should only contain web-server instructions
      expect(filteredInstructions).toContain('<web-server>');
      expect(filteredInstructions).toContain('Web server instructions for frontend development');
      expect(filteredInstructions).toContain('</web-server>');

      // Should not contain other servers
      expect(filteredInstructions).not.toContain('<database-server>');
      expect(filteredInstructions).not.toContain('<api-server>');
      expect(filteredInstructions).not.toContain('<dev-tools>');
    });

    it('should filter instructions by backend tags', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain educational template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('(filtered by tags: backend)');
      expect(filteredInstructions).toContain('2 MCP servers are currently available');

      // Should contain both backend servers (alphabetically: api-server, database-server)
      expect(filteredInstructions).toContain('api-server');
      expect(filteredInstructions).toContain('database-server');
      expect(filteredInstructions).toContain('<api-server>');
      expect(filteredInstructions).toContain('API server instructions for backend services');
      expect(filteredInstructions).toContain('<database-server>');
      expect(filteredInstructions).toContain('Database server instructions for data management');

      // Should not contain frontend/tools servers
      expect(filteredInstructions).not.toContain('<web-server>');
      expect(filteredInstructions).not.toContain('<dev-tools>');
    });

    it('should filter instructions by advanced tag expressions', () => {
      const tagExpression: TagExpression = {
        type: 'and',
        children: [
          { type: 'tag', value: 'backend' },
          { type: 'tag', value: 'api' },
        ],
      };

      const config: InboundConnectionConfig = {
        tagFilterMode: 'advanced',
        tagExpression,
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain educational template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('(filtered by advanced expression)');
      expect(filteredInstructions).toContain('1 MCP server is currently available');

      // Should only contain api-server (has both backend AND api tags)
      expect(filteredInstructions).toContain('api-server');
      expect(filteredInstructions).toContain('<api-server>');
      expect(filteredInstructions).toContain('API server instructions for backend services');

      // Should not contain other servers
      expect(filteredInstructions).not.toContain('<database-server>');
      expect(filteredInstructions).not.toContain('<web-server>');
      expect(filteredInstructions).not.toContain('<dev-tools>');
    });

    it('should filter instructions by preset tag query', () => {
      const tagQuery = {
        $or: [{ tag: 'development' }, { tag: 'tools' }],
      };

      const config: InboundConnectionConfig = {
        tagFilterMode: 'preset',
        tagQuery,
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain educational template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('(filtered by preset)');
      expect(filteredInstructions).toContain('1 MCP server is currently available');

      // Should only contain dev-tools
      expect(filteredInstructions).toContain('dev-tools');
      expect(filteredInstructions).toContain('<dev-tools>');
      expect(filteredInstructions).toContain('Development tools instructions');

      // Should not contain other servers
      expect(filteredInstructions).not.toContain('<web-server>');
      expect(filteredInstructions).not.toContain('<database-server>');
      expect(filteredInstructions).not.toContain('<api-server>');
    });

    it('should return no-servers template when no servers match the filter', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['nonexistent'],
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain no-servers template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('No MCP servers are currently connected');
      expect(filteredInstructions).toContain('1MCP will automatically detect and connect');
    });

    it('should handle servers without instructions gracefully', () => {
      // Add a server without instructions
      const connectionsWithoutInstructions = new Map(mockOutboundConnections);
      connectionsWithoutInstructions.set('empty-server', {
        name: 'empty-server',
        transport: { tags: ['empty'], timeout: 5000 },
        client: {} as any,
        status: ClientStatus.Connected,
        instructions: undefined,
      } as OutboundConnection);

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['empty'],
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(
        config,
        connectionsWithoutInstructions,
      );

      // Should return no-servers template since no server has instructions
      expect(filteredInstructions).toContain('No MCP servers are currently connected');
    });

    it('should exclude disconnected servers from filtering', () => {
      // Create a copy with one disconnected server
      const connectionsWithDisconnected = new Map(mockOutboundConnections);
      connectionsWithDisconnected.set('disconnected-server', {
        name: 'disconnected-server',
        transport: { tags: ['web'], timeout: 5000 },
        client: {} as any,
        status: ClientStatus.Disconnected,
        instructions: 'Disconnected server instructions',
      } as OutboundConnection);

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web'],
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, connectionsWithDisconnected);

      // Should only contain the connected web-server, not the disconnected one
      expect(filteredInstructions).toContain('<web-server>');
      expect(filteredInstructions).not.toContain('<disconnected-server>');
      expect(filteredInstructions).not.toContain('Disconnected server instructions');
    });

    it('should maintain alphabetical order in filtered results', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Verify that api-server comes before database-server (alphabetical order)
      const apiIndex = filteredInstructions.indexOf('<api-server>');
      const dbIndex = filteredInstructions.indexOf('<database-server>');
      expect(apiIndex).toBeLessThan(dbIndex);
      expect(apiIndex).toBeGreaterThan(-1);
      expect(dbIndex).toBeGreaterThan(-1);
    });

    it('should handle empty connections map', () => {
      const emptyConnections = new Map<string, OutboundConnection>();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
      };

      const filteredInstructions = instructionAggregator.getFilteredInstructions(config, emptyConnections);

      // Should return no-servers template
      expect(filteredInstructions).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(filteredInstructions).toContain('No MCP servers are currently connected');
    });
  });
});
