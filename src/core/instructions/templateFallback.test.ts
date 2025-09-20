import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstructionAggregator } from './instructionAggregator.js';
import { ClientStatus } from '../types/client.js';
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

describe('InstructionAggregator - Template Fallback Behavior', () => {
  let instructionAggregator: InstructionAggregator;
  let mockOutboundConnections: OutboundConnections;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Spy on console.error to verify error messages are printed
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create mock outbound connections
    mockOutboundConnections = new Map([
      [
        'server1',
        {
          name: 'server1',
          transport: { tags: ['test'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Server 1 test instructions',
        } as OutboundConnection,
      ],
      [
        'server2',
        {
          name: 'server2',
          transport: { tags: ['test'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          instructions: 'Server 2 test instructions',
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

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    instructionAggregator.cleanup();
  });

  describe('Console Error Output for Template Failures', () => {
    it('should print parse errors to console for invalid Handlebars syntax', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '{{invalid syntax {{unclosed',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Verify console.error was called with the expected message
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Custom template parsing failed:',
        expect.stringContaining('Parse error on line 1'),
      );

      // Verify fallback to default template occurred
      expect(result).toContain('1MCP - Model Context Protocol Proxy');
      expect(result).not.toContain('Template Rendering Error');
    });

    it('should print errors for templates with missing closing tags', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '{{#if hasServers}}Connected servers: {{serverCount}}', // Missing {{/if}}
      };

      instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Custom template parsing failed:',
        expect.stringContaining('Parse error'),
      );
    });

    it('should print errors for templates with invalid helper usage', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '{{#each}}content{{/each}}', // Missing iterator for #each
      };

      instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Custom template parsing failed:',
        expect.stringContaining('Must pass iterator'),
      );
    });
  });

  describe('Fallback to Default Template', () => {
    it('should return default template content when custom template fails', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '{{malformed template syntax',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should contain default template markers
      expect(result).toContain('1MCP - Model Context Protocol Proxy');
      expect(result).toContain('You are interacting with 1MCP');
      expect(result).toContain('Currently Connected Servers');
      expect(result).toContain('2 MCP servers are currently available');

      // Should include server instructions in XML format
      expect(result).toContain('<server1>');
      expect(result).toContain('Server 1 test instructions');
      expect(result).toContain('</server1>');
      expect(result).toContain('<server2>');
      expect(result).toContain('Server 2 test instructions');
      expect(result).toContain('</server2>');

      // Should not contain error template content
      expect(result).not.toContain('Template Rendering Error');
      expect(result).not.toContain('Troubleshooting Steps');
    });
  });

  describe('Crypto/ES Module Compatibility (Original Issue)', () => {
    it('should handle large templates that trigger hash computation without require errors', () => {
      // Create a large template that will trigger the hashString method
      const largeTemplate = '# {{title}}\n' + '{{serverCount}} servers\n'.repeat(100);

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: largeTemplate,
      };

      // This should not throw "require is not defined" error
      expect(() => {
        const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
        expect(result).toContain('1MCP - Model Context Protocol Proxy'); // Custom title should be rendered
      }).not.toThrow();

      // Should not have any console errors for valid template
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should not throw require errors when template caching is triggered', () => {
      const template = '# Custom Template\n{{serverCount}} servers: {{serverList}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Call multiple times to trigger caching behavior
      expect(() => {
        instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
        instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
        instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);
      }).not.toThrow();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error Types and Messages', () => {
    it('should handle compilation errors during template parsing', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '{{#each}}{{/each}}', // Invalid each usage
      };

      instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Custom template parsing failed:',
        expect.stringContaining('Must pass iterator'),
      );
    });

    it('should handle valid templates with undefined variables gracefully', () => {
      // This template is valid but references undefined variables
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: 'Server: {{nonexistentVariable}} Count: {{serverCount}}',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should succeed with undefined variables rendered as empty strings
      expect(result).toContain('Server:  Count: 2'); // undefined variable becomes empty string
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should not call console.error for valid templates', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '# {{title}}\n{{serverCount}} servers available',
      };

      instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should not have called console.error
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('No Custom Template Scenarios', () => {
    it('should use default template directly when no custom template provided', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        // No customTemplate property
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Should use default template
      expect(result).toContain('1MCP - Model Context Protocol Proxy');
      expect(result).toContain('2 MCP servers are currently available');

      // Should not have called console.error
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should use default template when customTemplate is undefined', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: undefined,
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('1MCP - Model Context Protocol Proxy');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should use default template when customTemplate is empty string', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: '',
      };

      const result = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(result).toContain('1MCP - Model Context Protocol Proxy');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Template Cache Behavior with New Hash Function', () => {
    it('should cache templates properly with ES module crypto import', () => {
      const template = '# {{title}}\nServers: {{serverList}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // First call should compile and cache
      const result1 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Second call should use cached template
      const result2 = instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      // Results should be identical
      expect(result1).toBe(result2);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle cache stats without errors', () => {
      const template = '# Test Template\n{{serverCount}}';
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      instructionAggregator.getFilteredInstructions(config, mockOutboundConnections);

      expect(() => {
        const stats = instructionAggregator.getTemplateCacheStats();
        expect(stats).toHaveProperty('size');
        expect(stats).toHaveProperty('maxSize');
        expect(stats).toHaveProperty('calculatedSize');
      }).not.toThrow();
    });
  });
});
