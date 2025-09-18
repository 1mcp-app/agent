import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstructionAggregator } from './instructionAggregator.js';
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
}));

describe('InstructionAggregator - Template Variables', () => {
  let instructionAggregator: InstructionAggregator;
  let mockOutboundConnections: OutboundConnections;

  beforeEach(() => {
    mockOutboundConnections = new Map([
      [
        'web-server',
        {
          name: 'web-server',
          transport: { tags: ['web', 'frontend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Web server instructions',
        } as OutboundConnection,
      ],
      [
        'api-server',
        {
          name: 'api-server',
          transport: { tags: ['api', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'API server instructions',
        } as OutboundConnection,
      ],
      [
        'database-server',
        {
          name: 'database-server',
          transport: { tags: ['database', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Database server instructions',
        } as OutboundConnection,
      ],
      [
        'no-instructions-server',
        {
          name: 'no-instructions-server',
          transport: { tags: ['empty'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: undefined,
        } as OutboundConnection,
      ],
    ]);

    instructionAggregator = new InstructionAggregator();
    for (const [name, conn] of mockOutboundConnections) {
      if (conn.instructions) {
        instructionAggregator.setInstructions(name, conn.instructions);
      }
    }
  });

  describe('Server State Variables', () => {
    it('should generate correct serverCount for all servers', () => {
      const template = '{{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('3'); // Only servers with instructions
    });

    it('should generate hasServers correctly', () => {
      // With servers
      const templateWithServers = '{{hasServers}}';
      const configWithServers: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: templateWithServers,
      };

      const resultWithServers = instructionAggregator.getFilteredInstructions(
        configWithServers,
        mockOutboundConnections,
      );
      expect(resultWithServers).toBe('true');

      // Without servers
      const emptyConnections = new Map<string, OutboundConnection>();
      const resultWithoutServers = instructionAggregator.getFilteredInstructions(configWithServers, emptyConnections);
      expect(resultWithoutServers).toBe('false');
    });

    it('should generate serverList with newline separation', () => {
      const template = '{{serverList}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('api-server\ndatabase-server\nweb-server'); // Alphabetical order
    });

    it('should generate serverNames array', () => {
      const template = '{{#each serverNames}}{{this}},{{/each}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('api-server,database-server,web-server,'); // Alphabetical order
    });

    it('should generate pluralServers correctly', () => {
      // Plural case
      const templatePlural = '{{pluralServers}}';
      const configPlural: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: templatePlural,
      };

      const resultPlural = instructionAggregator.getFilteredInstructions(configPlural, mockOutboundConnections);
      expect(resultPlural).toBe('servers');

      // Singular case
      const singleServerConnections = new Map([['web-server', mockOutboundConnections.get('web-server')!]]);

      const resultSingular = instructionAggregator.getFilteredInstructions(configPlural, singleServerConnections);
      expect(resultSingular).toBe('server');
    });

    it('should generate isAre correctly', () => {
      // Plural case
      const template = '{{isAre}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const resultPlural = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
      expect(resultPlural).toBe('are');

      // Singular case
      const singleServerConnections = new Map([['web-server', mockOutboundConnections.get('web-server')!]]);

      const resultSingular = instructionAggregator.getFilteredInstructions(config, singleServerConnections);
      expect(resultSingular).toBe('is');
    });
  });

  describe('Content Variables', () => {
    it('should generate instructions with XML wrapping', () => {
      const template = '{{{instructions}}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('<api-server>\nAPI server instructions\n</api-server>');
      expect(result).toContain('<database-server>\nDatabase server instructions\n</database-server>');
      expect(result).toContain('<web-server>\nWeb server instructions\n</web-server>');
    });

    it('should generate filterContext for different filter modes', () => {
      const template = '{{filterContext}}';

      // No filter
      const configNone: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };
      const resultNone = instructionAggregator.getFilteredInstructions(configNone, mockOutboundConnections);
      expect(resultNone).toBe('');

      // Simple tags filter
      const configSimple: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend', 'api'],
        customTemplate: template,
      };
      const resultSimple = instructionAggregator.getFilteredInstructions(configSimple, mockOutboundConnections);
      expect(resultSimple).toBe(' (filtered by tags: backend, api)');

      // Advanced filter
      const tagExpression: TagExpression = {
        type: 'and',
        children: [
          { type: 'tag', value: 'backend' },
          { type: 'tag', value: 'api' },
        ],
      };
      const configAdvanced: InboundConnectionConfig = {
        tagFilterMode: 'advanced',
        tagExpression,
        customTemplate: template,
      };
      const resultAdvanced = instructionAggregator.getFilteredInstructions(configAdvanced, mockOutboundConnections);
      expect(resultAdvanced).toBe(' (filtered by advanced expression)');

      // Preset filter
      const configPreset: InboundConnectionConfig = {
        tagFilterMode: 'preset',
        tagQuery: { $or: [{ tag: 'web' }] },
        customTemplate: template,
      };
      const resultPreset = instructionAggregator.getFilteredInstructions(configPreset, mockOutboundConnections);
      expect(resultPreset).toBe(' (filtered by preset)');
    });
  });

  describe('Configuration Variables', () => {
    it('should use default title when not specified', () => {
      const template = '{{title}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('1MCP - Model Context Protocol Proxy');
    });

    it('should use custom title when specified', () => {
      const template = '{{title}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
        title: 'My Custom Proxy',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('My Custom Proxy');
    });

    it('should use default tool pattern when not specified', () => {
      const template = '{{toolPattern}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('{server}_1mcp_{tool}');
    });

    it('should use custom tool pattern when specified', () => {
      const template = '{{toolPattern}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
        toolPattern: '{server}::{tool}',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('{server}::{tool}');
    });

    it('should generate default examples', () => {
      const template = '{{#each examples}}{{name}}: {{description}}\\n{{/each}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('filesystem_1mcp_read_file: Read files through filesystem server');
      expect(result).toContain('web_1mcp_search: Search the web through web server');
      expect(result).toContain('database_1mcp_query: Query databases through database server');
    });

    it('should use custom examples when specified', () => {
      const template = '{{#each examples}}{{name}}: {{description}}\\n{{/each}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
        examples: [
          { name: 'custom_tool', description: 'Custom tool description' },
          { name: 'another_tool', description: 'Another tool description' },
        ],
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('custom_tool: Custom tool description');
      expect(result).toContain('another_tool: Another tool description');
      expect(result).not.toContain('filesystem_1mcp_read_file');
    });
  });

  describe('Filtering Integration', () => {
    it('should generate variables for filtered connections only', () => {
      const template = '{{serverCount}}: {{serverList}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('2: api-server\ndatabase-server');
    });

    it('should handle empty filtered results', () => {
      const template = '{{hasServers}}: {{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['nonexistent'],
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('false: 0');
    });

    it('should exclude servers without instructions', () => {
      const template = '{{serverCount}}: {{#each serverNames}}{{this}},{{/each}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['empty'], // This will match 'no-instructions-server' but it has no instructions
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('0: '); // No servers with instructions match the filter
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty connections map', () => {
      const template = '{{hasServers}}: {{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const emptyConnections = new Map<string, OutboundConnection>();
      const result = instructionAggregator.getFilteredInstructions(config, emptyConnections);

      expect(result).toBe('false: 0');
    });

    it('should handle connections with empty instructions', () => {
      const connectionsWithEmpty = new Map(mockOutboundConnections);
      connectionsWithEmpty.set('empty-server', {
        name: 'empty-server',
        transport: { tags: ['test'], timeout: 5000 },
        client: {} as any,
        status: ClientStatus.Connected,
        instructions: '',
      } as OutboundConnection);

      const template = '{{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, connectionsWithEmpty);

      expect(result).toBe('3'); // Empty instructions should not be counted
    });

    it('should maintain alphabetical ordering', () => {
      const template = '{{#each serverNames}}{{this}}-{{/each}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('api-server-database-server-web-server-');
    });
  });
});
