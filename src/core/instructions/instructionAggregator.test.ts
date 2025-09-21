import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstructionAggregator } from './instructionAggregator.js';

describe('InstructionAggregator', () => {
  let aggregator: InstructionAggregator;

  beforeEach(() => {
    aggregator = new InstructionAggregator();
  });

  describe('setInstructions', () => {
    it('should store instructions for a server', () => {
      const instructions = 'Test server instructions';

      aggregator.setInstructions('server1', instructions);

      expect(aggregator.hasInstructions('server1')).toBe(true);
      expect(aggregator.getServerInstructions('server1')).toBe(instructions);
      expect(aggregator.getServerCount()).toBe(1);
    });

    it('should update existing instructions for a server', () => {
      const oldInstructions = 'Old instructions';
      const newInstructions = 'New instructions';

      aggregator.setInstructions('server1', oldInstructions);
      aggregator.setInstructions('server1', newInstructions);

      expect(aggregator.getServerInstructions('server1')).toBe(newInstructions);
      expect(aggregator.getServerCount()).toBe(1);
    });

    it('should remove server when instructions are undefined', () => {
      aggregator.setInstructions('server1', 'Test instructions');
      aggregator.setInstructions('server1', undefined);

      expect(aggregator.hasInstructions('server1')).toBe(false);
      expect(aggregator.getServerCount()).toBe(0);
    });

    it('should remove server when instructions are empty string', () => {
      aggregator.setInstructions('server1', 'Test instructions');
      aggregator.setInstructions('server1', '');

      expect(aggregator.hasInstructions('server1')).toBe(false);
      expect(aggregator.getServerCount()).toBe(0);
    });

    it('should trim whitespace from instructions', () => {
      const instructions = '  Test instructions with whitespace  ';
      const expectedTrimmed = 'Test instructions with whitespace';

      aggregator.setInstructions('server1', instructions);

      expect(aggregator.getServerInstructions('server1')).toBe(expectedTrimmed);
    });

    it('should emit instructions-changed event when instructions change', () => {
      const mockListener = vi.fn();
      aggregator.on('instructions-changed', mockListener);

      aggregator.setInstructions('server1', 'Test instructions');

      expect(mockListener).toHaveBeenCalledWith();
      expect(mockListener).toHaveBeenCalledTimes(1);
    });

    it('should not emit event when instructions do not change', () => {
      const instructions = 'Test instructions';
      const mockListener = vi.fn();

      aggregator.setInstructions('server1', instructions);
      aggregator.on('instructions-changed', mockListener);
      aggregator.setInstructions('server1', instructions);

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('removeServer', () => {
    it('should remove server and emit event if server had instructions', () => {
      const mockListener = vi.fn();

      aggregator.setInstructions('server1', 'Test instructions');
      aggregator.on('instructions-changed', mockListener);
      mockListener.mockClear(); // Clear the setup call

      aggregator.removeServer('server1');

      expect(aggregator.hasInstructions('server1')).toBe(false);
      expect(aggregator.getServerCount()).toBe(0);
      expect(mockListener).toHaveBeenCalledWith();
    });

    it('should not emit event if server had no instructions', () => {
      const mockListener = vi.fn();
      aggregator.on('instructions-changed', mockListener);

      aggregator.removeServer('nonexistent');

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('getServerNames', () => {
    it('should return empty array when no servers', () => {
      expect(aggregator.getServerNames()).toEqual([]);
    });

    it('should return sorted list of server names', () => {
      aggregator.setInstructions('zebra', 'Z');
      aggregator.setInstructions('alpha', 'A');
      aggregator.setInstructions('bravo', 'B');

      expect(aggregator.getServerNames()).toEqual(['alpha', 'bravo', 'zebra']);
    });
  });

  describe('clear', () => {
    it('should clear all instructions and emit event', () => {
      const mockListener = vi.fn();

      aggregator.setInstructions('server1', 'Instructions 1');
      aggregator.setInstructions('server2', 'Instructions 2');
      aggregator.on('instructions-changed', mockListener);
      mockListener.mockClear(); // Clear setup calls

      aggregator.clear();

      expect(aggregator.getServerCount()).toBe(0);
      expect(mockListener).toHaveBeenCalledWith();
    });

    it('should not emit event when clearing empty aggregator', () => {
      const mockListener = vi.fn();
      aggregator.on('instructions-changed', mockListener);

      aggregator.clear();

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('getSummary', () => {
    it('should return summary with no servers', () => {
      expect(aggregator.getSummary()).toBe('0 servers with instructions: ');
    });

    it('should return summary with server names', () => {
      aggregator.setInstructions('server2', 'Instructions 2');
      aggregator.setInstructions('server1', 'Instructions 1');

      expect(aggregator.getSummary()).toBe('2 servers with instructions: server1, server2');
    });
  });

  describe('Edge Cases from Review', () => {
    describe('Template Size Limits', () => {
      it('should handle template size limits with default configuration', () => {
        // Test template too large (over 1MB)
        const largeTemplate = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
        const config = { tagFilterMode: 'none' as const };
        const connections = new Map();

        expect(() => {
          aggregator.getFilteredInstructions(config, connections);
        }).not.toThrow(); // This should work with default template

        // But a large custom template should fall back to default template
        const configWithLargeTemplate = {
          tagFilterMode: 'none' as const,
          customTemplate: largeTemplate,
        };

        const result = aggregator.getFilteredInstructions(configWithLargeTemplate, connections);
        // Should fall back to default template
        expect(result).toContain('1MCP - Model Context Protocol Proxy');
      });

      it('should respect custom template size limits', () => {
        const smallTemplate = 'x'.repeat(1000); // 1KB
        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: smallTemplate,
          templateSizeLimit: 500, // 500 bytes limit
        };
        const connections = new Map();

        // This will fail because even the default template is larger than 500 bytes
        // The renderTemplate method applies the same size limit to the fallback template
        expect(() => {
          aggregator.getFilteredInstructions(config, connections);
        }).toThrow('Template too large');
      });

      it('should allow templates within size limit', () => {
        const smallTemplate = '{{serverCount}} servers available';
        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: smallTemplate,
          templateSizeLimit: 1000, // 1KB limit
        };
        const connections = new Map();

        expect(() => {
          const result = aggregator.getFilteredInstructions(config, connections);
          expect(typeof result).toBe('string');
        }).not.toThrow();
      });
    });

    describe('Template Compilation', () => {
      it('should compile templates directly without caching', () => {
        const template = 'Simple template: {{serverCount}}';
        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: template,
        };
        const connections = new Map();

        // Multiple calls should work (no cache errors)
        const result1 = aggregator.getFilteredInstructions(config, connections);
        const result2 = aggregator.getFilteredInstructions(config, connections);

        expect(result1).toBe(result2);
        expect(result1).toContain('0'); // serverCount should be 0
      });

      it('should handle template compilation errors gracefully', () => {
        const invalidTemplate = '{{invalid syntax {{unclosed';
        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: invalidTemplate,
        };
        const connections = new Map();

        // Should fall back to default template, not throw
        expect(() => {
          const result = aggregator.getFilteredInstructions(config, connections);
          expect(result).toContain('1MCP'); // Should use default template
        }).not.toThrow();
      });
    });

    describe('Empty Server Scenarios', () => {
      it('should handle getFilteredInstructions with no servers', () => {
        const config = { tagFilterMode: 'none' as const };
        const emptyConnections = new Map();

        const result = aggregator.getFilteredInstructions(config, emptyConnections);

        // Should not throw and should return a valid result
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });

      it('should handle getFilteredInstructions with servers but no instructions', () => {
        const config = { tagFilterMode: 'none' as const };
        const connections = new Map([
          ['server1', { name: 'server1' } as any],
          ['server2', { name: 'server2' } as any],
        ]);

        // No instructions set for these servers
        const result = aggregator.getFilteredInstructions(config, connections);

        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });

      it('should handle filtering that results in empty server set', () => {
        // Set up servers with instructions
        aggregator.setInstructions('server1', 'Server 1 instructions');
        aggregator.setInstructions('server2', 'Server 2 instructions');

        const config = {
          tagFilterMode: 'simple-or' as const,
          tags: ['nonexistent-tag'],
        };

        const connections = new Map([
          ['server1', { name: 'server1', tags: ['web'] } as any],
          ['server2', { name: 'server2', tags: ['db'] } as any],
        ]);

        const result = aggregator.getFilteredInstructions(config, connections);

        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe('Malformed Template Handling', () => {
      it('should handle template compilation errors gracefully', () => {
        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: '{{invalid syntax {{unclosed',
        };
        const connections = new Map([['server1', { name: 'server1' } as any]]);

        aggregator.setInstructions('server1', 'Test instructions');

        const result = aggregator.getFilteredInstructions(config, connections);

        // Should fall back to default template, not show error template
        expect(result).toContain('1MCP - Model Context Protocol Proxy');
        expect(result).toContain('You are interacting with 1MCP');
        expect(result).not.toContain('Template Rendering Error');
      });

      it('should handle templates with undefined variables', () => {
        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: 'Server: {{nonexistentVariable}}',
        };
        const connections = new Map([['server1', { name: 'server1' } as any]]);

        aggregator.setInstructions('server1', 'Test instructions');

        const result = aggregator.getFilteredInstructions(config, connections);

        // Should render with empty string for undefined variables
        expect(result).toBe('Server: ');
      });

      it('should handle extremely complex templates without crashing', () => {
        const complexTemplate = `
          {{#each servers}}
            {{#if hasInstructions}}
              {{#each instructions}}
                {{#if @index}}, {{/if}}{{this}}
              {{/each}}
            {{else}}
              No instructions for {{name}}
            {{/if}}
          {{/each}}

          {{#if hasServers}}
            Total: {{serverCount}} {{pluralServers}} {{isAre}} available
            {{#each serverNames}}
              - {{this}}
            {{/each}}
          {{else}}
            No servers found
          {{/if}}
        `;

        const config = {
          tagFilterMode: 'none' as const,
          customTemplate: complexTemplate,
        };
        const connections = new Map([
          ['server1', { name: 'server1' } as any],
          ['server2', { name: 'server2' } as any],
        ]);

        aggregator.setInstructions('server1', 'Instructions 1');
        aggregator.setInstructions('server2', 'Instructions 2');

        // Should not throw
        const result = aggregator.getFilteredInstructions(config, connections);
        expect(typeof result).toBe('string');
      });
    });

    describe('Cleanup and Memory Management', () => {
      it('should cleanup all event listeners and caches', () => {
        const mockListener = vi.fn();

        // Add some instructions and listeners
        aggregator.setInstructions('server1', 'Instructions 1');
        aggregator.setInstructions('server2', 'Instructions 2');
        aggregator.on('instructions-changed', mockListener);

        // Verify state before cleanup
        expect(aggregator.getServerCount()).toBe(2);

        // Perform cleanup
        aggregator.cleanup();

        // Verify cleanup
        expect(aggregator.getServerCount()).toBe(0);
        expect(aggregator.getServerNames()).toEqual([]);

        // Verify event listeners are removed
        aggregator.setInstructions('server3', 'New instructions');
        expect(mockListener).not.toHaveBeenCalled(); // Should not be called after cleanup
      });

      it('should handle cleanup when already empty', () => {
        // Cleanup empty aggregator should not throw
        expect(() => aggregator.cleanup()).not.toThrow();

        // Verify state
        expect(aggregator.getServerCount()).toBe(0);
      });

      it('should allow reuse after cleanup', () => {
        // Use aggregator
        aggregator.setInstructions('server1', 'Instructions 1');
        expect(aggregator.getServerCount()).toBe(1);

        // Cleanup
        aggregator.cleanup();
        expect(aggregator.getServerCount()).toBe(0);

        // Reuse after cleanup
        aggregator.setInstructions('server2', 'Instructions 2');
        expect(aggregator.getServerCount()).toBe(1);
        expect(aggregator.hasInstructions('server2')).toBe(true);
      });

      it('should prevent memory leaks with repeated cleanup calls', () => {
        aggregator.setInstructions('server1', 'Instructions 1');

        // Multiple cleanups should be safe
        aggregator.cleanup();
        aggregator.cleanup();
        aggregator.cleanup();

        expect(aggregator.getServerCount()).toBe(0);
      });
    });

    describe('Memory Pressure Scenarios', () => {
      it('should handle rapid instruction updates', () => {
        // Simulate rapid server instruction changes
        for (let i = 0; i < 1000; i++) {
          aggregator.setInstructions(`server${i % 10}`, `Instructions ${i}`);
        }

        expect(aggregator.getServerCount()).toBeLessThanOrEqual(10);
        expect(() => aggregator.getSummary()).not.toThrow();
      });

      it('should handle large instruction content', () => {
        const largeInstructions = 'Very long instructions: ' + 'x'.repeat(100000); // 100KB

        aggregator.setInstructions('server1', largeInstructions);

        expect(aggregator.hasInstructions('server1')).toBe(true);
        expect(aggregator.getServerInstructions('server1')).toBe(largeInstructions);
      });

      it('should handle many servers with instructions', () => {
        // Add many servers
        for (let i = 0; i < 1000; i++) {
          aggregator.setInstructions(`server${i}`, `Instructions for server ${i}`);
        }

        expect(aggregator.getServerCount()).toBe(1000);
        expect(aggregator.getServerNames()).toHaveLength(1000);

        // Should handle operations efficiently
        const summary = aggregator.getSummary();
        expect(summary).toContain('1000 servers with instructions');
      });

      it('should clean up properly when servers are removed', () => {
        // Add many servers
        const serverCount = 100;
        for (let i = 0; i < serverCount; i++) {
          aggregator.setInstructions(`server${i}`, `Instructions ${i}`);
        }

        expect(aggregator.getServerCount()).toBe(serverCount);

        // Remove all servers
        for (let i = 0; i < serverCount; i++) {
          aggregator.removeServer(`server${i}`);
        }

        expect(aggregator.getServerCount()).toBe(0);
        expect(aggregator.getServerNames()).toHaveLength(0);
      });
    });
  });
});
