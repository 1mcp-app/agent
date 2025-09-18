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
    describe('Template Cache Management', () => {
      it('should handle template size limits', () => {
        // Test template too large (over 1MB)
        const largeTemplate = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte

        expect(() => {
          // @ts-ignore - accessing private method for testing
          aggregator.getCompiledTemplate(largeTemplate);
        }).toThrow('Template too large');
      });

      it('should use cache keys efficiently for large templates', () => {
        const largeTemplate = 'Large template content: ' + 'x'.repeat(1000);

        // First compilation should work and cache the template
        // @ts-ignore - accessing private method for testing
        const compiled1 = aggregator.getCompiledTemplate(largeTemplate);

        // Second compilation should use cached version
        // @ts-ignore - accessing private method for testing
        const compiled2 = aggregator.getCompiledTemplate(largeTemplate);

        expect(compiled1).toBe(compiled2);
      });

      it('should handle cache overflow gracefully', () => {
        // Fill cache beyond normal capacity
        for (let i = 0; i < 150; i++) {
          // More than max 100
          const template = `Template ${i}: {{serverCount}}`;
          // @ts-ignore - accessing private method for testing
          aggregator.getCompiledTemplate(template);
        }

        // Should not throw and cache size should be limited
        const stats = aggregator.getTemplateCacheStats();
        expect(stats.size).toBeLessThanOrEqual(100);
      });

      it('should invalidate cache on instruction changes', () => {
        // Cache a template
        const template = '{{serverCount}} servers';
        // @ts-ignore - accessing private method for testing
        aggregator.getCompiledTemplate(template);

        const statsBefore = aggregator.getTemplateCacheStats();
        expect(statsBefore.size).toBeGreaterThan(0);

        // Trigger instruction change event
        aggregator.setInstructions('server1', 'New instructions');

        // Cache should be cleared
        const statsAfter = aggregator.getTemplateCacheStats();
        expect(statsAfter.size).toBe(0);
      });

      it('should provide cache statistics', () => {
        const stats = aggregator.getTemplateCacheStats();
        expect(stats).toHaveProperty('size');
        expect(stats).toHaveProperty('maxSize');
        expect(stats).toHaveProperty('calculatedSize');
        expect(typeof stats.size).toBe('number');
        expect(typeof stats.maxSize).toBe('number');
      });

      it('should allow forced cache invalidation', () => {
        // Cache a template
        const template = '{{serverList}}';
        // @ts-ignore - accessing private method for testing
        aggregator.getCompiledTemplate(template);

        expect(aggregator.getTemplateCacheStats().size).toBeGreaterThan(0);

        // Force invalidation
        aggregator.forceTemplateCacheInvalidation('test-reason');

        expect(aggregator.getTemplateCacheStats().size).toBe(0);
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

        // Should return detailed error template with troubleshooting guidance
        expect(result).toContain('Template Rendering Error');
        expect(result).toContain('Template rendering failed');
        expect(result).toContain('Troubleshooting Steps');
        expect(result).toContain('Check Template Syntax');
        expect(result).toContain('Built-in template');
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

        // Cache some templates
        const template = '{{serverCount}} servers';
        // @ts-ignore - accessing private method for testing
        aggregator.getCompiledTemplate(template);

        // Verify state before cleanup
        expect(aggregator.getServerCount()).toBe(2);
        expect(aggregator.getTemplateCacheStats().size).toBeGreaterThan(0);

        // Perform cleanup
        aggregator.cleanup();

        // Verify cleanup
        expect(aggregator.getServerCount()).toBe(0);
        expect(aggregator.getTemplateCacheStats().size).toBe(0);
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
        expect(aggregator.getTemplateCacheStats().size).toBe(0);
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

    describe('Hash Collision Prevention', () => {
      it('should use cryptographically secure hash for cache keys', () => {
        const template1 = 'Template with content A';
        const template2 = 'Template with content B';

        // Get cache keys by accessing the private hashString method
        // @ts-ignore - accessing private method for testing
        const hash1 = aggregator.hashString(template1);
        // @ts-ignore - accessing private method for testing
        const hash2 = aggregator.hashString(template2);

        // Hashes should be different for different inputs
        expect(hash1).not.toBe(hash2);

        // Hash should be consistent for same input
        // @ts-ignore - accessing private method for testing
        const hash1Repeat = aggregator.hashString(template1);
        expect(hash1).toBe(hash1Repeat);

        // Hash should be hex string of reasonable length (SHA-256 truncated to 16 chars)
        expect(hash1).toMatch(/^[a-f0-9]{16}$/);
        expect(hash2).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should handle large templates without hash collisions', () => {
        const largeTemplate1 = 'Large template: ' + 'A'.repeat(10000);
        const largeTemplate2 = 'Large template: ' + 'B'.repeat(10000);

        // @ts-ignore - accessing private method for testing
        const hash1 = aggregator.hashString(largeTemplate1);
        // @ts-ignore - accessing private method for testing
        const hash2 = aggregator.hashString(largeTemplate2);

        expect(hash1).not.toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{16}$/);
        expect(hash2).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should generate different hashes for similar templates', () => {
        const templates = [
          '{{serverCount}} servers available',
          '{{serverCount}} servers available!',
          '{{serverCount}} servers available.',
          ' {{serverCount}} servers available',
        ];

        const hashes = templates.map((template) =>
          // @ts-ignore - accessing private method for testing
          aggregator.hashString(template),
        );

        // All hashes should be unique
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(templates.length);
      });

      it('should handle edge case inputs for hashing', () => {
        const edgeCases = [
          '',
          ' ',
          '\n\t\r',
          '🎉 Unicode content 🚀',
          'Very\x00strange\x01content',
          'Content with "quotes" and \'apostrophes\'',
        ];

        const hashes = edgeCases.map((template) =>
          // @ts-ignore - accessing private method for testing
          aggregator.hashString(template),
        );

        // All hashes should be valid hex strings
        hashes.forEach((hash) => {
          expect(hash).toMatch(/^[a-f0-9]{16}$/);
        });

        // All hashes should be unique
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(edgeCases.length);
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
