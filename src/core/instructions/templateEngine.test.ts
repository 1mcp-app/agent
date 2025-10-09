import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstructionAggregator } from './instructionAggregator.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { OutboundConnections, OutboundConnection, InboundConnectionConfig } from '@src/core/types/index.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('InstructionAggregator - Template Engine', () => {
  let instructionAggregator: InstructionAggregator;
  let mockOutboundConnections: OutboundConnections;

  beforeEach(() => {
    // Create mock outbound connections with different servers
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
        'database-server',
        {
          name: 'database-server',
          transport: { tags: ['database', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Database server instructions for data management',
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

  describe('Basic Template Variables', () => {
    it('should render simple template with server count', () => {
      const template = 'Connected servers: {{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('Connected servers: 3');
    });

    it('should render template with server list', () => {
      const template = 'Servers:\n{{serverList}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('Servers:\napi-server\ndatabase-server\nweb-server');
    });

    it('should render template with plural/singular forms', () => {
      const template = '{{serverCount}} {{pluralServers}} {{isAre}} available';

      // Test plural
      const configPlural: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };
      const resultPlural = instructionAggregator.getFilteredInstructions(configPlural, mockOutboundConnections);
      expect(resultPlural).toBe('3 servers are available');

      // Test singular
      const singleServerConnections = new Map([['web-server', mockOutboundConnections.get('web-server')!]]);
      const configSingular: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };
      const resultSingular = instructionAggregator.getFilteredInstructions(configSingular, singleServerConnections);
      expect(resultSingular).toBe('1 server is available');
    });

    it('should render template with custom title and tool pattern', () => {
      const template = '# {{title}}\nTool pattern: {{toolPattern}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
        title: 'My Custom MCP Proxy',
        toolPattern: '{server}::{tool}',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('# My Custom MCP Proxy\nTool pattern: {server}::{tool}');
    });
  });

  describe('Conditional Templates', () => {
    it('should render conditional content when servers are available', () => {
      const template = `{{#if hasServers}}
{{serverCount}} servers connected:
{{serverList}}
{{else}}
No servers available
{{/if}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('3 servers connected');
      expect(result).toContain('api-server');
      expect(result).not.toContain('No servers available');
    });

    it('should render else content when no servers are available', () => {
      const template = `{{#if hasServers}}
Servers: {{serverList}}
{{else}}
No servers available
{{/if}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const emptyConnections = new Map<string, OutboundConnection>();
      const result = instructionAggregator.getFilteredInstructions(config, emptyConnections);

      expect(result).toContain('No servers available');
      expect(result).not.toContain('Servers:');
    });
  });

  describe('Loop Templates', () => {
    it('should render server names using each loop', () => {
      const template = `{{#each serverNames}}
- Server: {{this}}
{{/each}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('- Server: api-server');
      expect(result).toContain('- Server: database-server');
      expect(result).toContain('- Server: web-server');
    });

    it('should render examples using each loop', () => {
      const template = `{{#each examples}}
- {{name}}: {{description}}
{{/each}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('filesystem_1mcp_read_file: Read files through filesystem server');
      expect(result).toContain('web_1mcp_search: Search the web through web server');
      expect(result).toContain('database_1mcp_query: Query databases through database server');
    });
  });

  describe('Instructions Content', () => {
    it('should render server instructions in XML format', () => {
      const template = 'Instructions:\\n{{{instructions}}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('<api-server>');
      expect(result).toContain('API server instructions for backend services');
      expect(result).toContain('</api-server>');
      expect(result).toContain('<web-server>');
      expect(result).toContain('Web server instructions for frontend development');
      expect(result).toContain('</web-server>');
    });

    it('should handle empty instructions gracefully', () => {
      const template = '{{#if hasServers}}{{{instructions}}}{{else}}No instructions{{/if}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Clear all instructions
      instructionAggregator.clear();
      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toBe('No instructions');
    });
  });

  describe('Filtering with Templates', () => {
    it('should render filtered results correctly', () => {
      const template = `Filtered servers ({{serverCount}}):
{{#each serverNames}}
- {{this}}
{{/each}}
{{filterContext}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('Filtered servers (2)');
      expect(result).toContain('- api-server');
      expect(result).toContain('- database-server');
      expect(result).not.toContain('- web-server');
      expect(result).toContain('(filtered by tags: backend)');
    });

    it('should handle empty filter results', () => {
      const template = `{{#if hasServers}}
Found {{serverCount}} servers
{{else}}
No matching servers found
{{/if}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['nonexistent'],
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('No matching servers found');
      expect(result).not.toContain('Found');
    });
  });

  describe('Template Error Handling', () => {
    it('should fallback to default template on invalid syntax', () => {
      const template = '{{invalid syntax {{unclosed';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should fall back to default template, not show error template
      expect(result).toContain('# 1MCP - Model Context Protocol Proxy');
      expect(result).toContain('You are interacting with 1MCP');
      expect(result).toContain('Currently Connected Servers');
      expect(result).toContain('3 MCP servers are currently available');
      expect(result).not.toContain('Template Rendering Error');
    });

    it('should handle template with undefined variables gracefully', () => {
      const template = 'Server: {{nonexistentVariable}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should render empty string for undefined variables
      expect(result).toBe('Server: ');
    });
  });

  describe('Template Caching', () => {
    it('should cache compiled templates', () => {
      const template = 'Servers: {{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // First render
      const result1 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Second render (should use cached template)
      const result2 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result1).toBe(result2);
      expect(result1).toBe('Servers: 3');
    });

    it('should handle multiple template renders without caching', () => {
      const template = 'Test: {{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Multiple renders should work (no cache issues)
      const result1 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
      const result2 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
      const result3 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result1).toBe('Test: 3');
      expect(result2).toBe('Test: 3');
      expect(result3).toBe('Test: 3');
    });
  });

  describe('Complex Template Examples', () => {
    it('should render advanced template with multiple features', () => {
      const template = `# {{title}}

## Status
{{#if hasServers}}
✅ **{{serverCount}} {{pluralServers}} active**{{filterContext}}

### Connected Servers
{{#each serverNames}}
- ✅ {{this}}
{{/each}}

### Instructions
{{{instructions}}}

### Examples
{{#each examples}}
- \`{{name}}\` - {{description}}
{{/each}}

---
*Tools follow pattern: \`{{toolPattern}}\`*
{{else}}
⏳ **Waiting for connections...**
{{/if}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
        customTemplate: template,
        title: 'My MCP Gateway',
        toolPattern: '{server}::{tool}',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('# My MCP Gateway');
      expect(result).toContain('✅ **2 servers active** (filtered by tags: backend)');
      expect(result).toContain('- ✅ api-server');
      expect(result).toContain('- ✅ database-server');
      expect(result).toContain('<api-server>');
      expect(result).toContain('API server instructions for backend services');
      expect(result).toContain('*Tools follow pattern: `{server}::{tool}`*');
      expect(result).not.toContain('web-server');
    });
  });
});
