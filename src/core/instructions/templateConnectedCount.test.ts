import { describe, it, expect, beforeEach } from 'vitest';
import { InstructionAggregator } from './instructionAggregator.js';
import type { InboundConnectionConfig, OutboundConnections } from '@src/core/types/index.js';

// Helper function to create test connections
function createTestConnection(name: string, tags: string[] = []) {
  return {
    name,
    transport: { tags, timeout: 5000 },
    client: {} as any,
    status: 'connected' as any,
  } as any;
}

describe('InstructionAggregator - Connected Server Count Scenarios', () => {
  let instructionAggregator: InstructionAggregator;

  beforeEach(() => {
    instructionAggregator = new InstructionAggregator();
  });

  describe('connectedServerCount vs instructionalServerCount', () => {
    it('should show different counts when some servers lack instructions', () => {
      const template = `
Connected: {{connectedServerCount}}
Instructional: {{instructionalServerCount}}
Available: {{serverCount}}
HasServers: {{hasServers}}
HasInstructional: {{hasInstructionalServers}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server-a', createTestConnection('server-a')],
        ['server-b', createTestConnection('server-b')],
        ['server-c', createTestConnection('server-c')],
        ['server-d', createTestConnection('server-d')],
      ]) as OutboundConnections;

      // Only 2 out of 4 servers have instructions
      instructionAggregator.setInstructions('server-a', 'Server A instructions');
      instructionAggregator.setInstructions('server-c', 'Server C instructions');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Connected: 4'); // All connected servers
      expect(result).toContain('Instructional: 2'); // Only servers with instructions
      expect(result).toContain('Available: 2'); // Same as instructional (legacy)
      expect(result).toContain('HasServers: true'); // Has instructional servers
      expect(result).toContain('HasInstructional: true'); // Has instructional servers
    });

    it('should handle filtering correctly with mixed server states', () => {
      const template = `
{{#if hasServers}}
Working servers: {{instructionalServerCount}}/{{connectedServerCount}}
Server names: {{#each serverNames}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{else}}
No working servers ({{connectedServerCount}} connected)
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
        customTemplate: template,
      };

      const connections = new Map([
        ['api-server', createTestConnection('api-server', ['backend', 'api'])],
        ['web-server', createTestConnection('web-server', ['frontend', 'web'])],
        ['db-server', createTestConnection('db-server', ['backend', 'database'])],
        ['cache-server', createTestConnection('cache-server', ['backend'])],
      ]) as OutboundConnections;

      // Only some backend servers have instructions
      instructionAggregator.setInstructions('api-server', 'API instructions');
      instructionAggregator.setInstructions('web-server', 'Web instructions');
      instructionAggregator.setInstructions('db-server', 'DB instructions');
      // cache-server has no instructions

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      // Should filter to backend servers only (api-server, db-server, cache-server)
      // But only api-server and db-server have instructions
      expect(result).toContain('Working servers: 2/3');
      expect(result).toContain('api-server, db-server'); // Only instructional servers in list
      expect(result).not.toContain('web-server'); // Filtered out by tags
      expect(result).not.toContain('cache-server'); // No instructions
    });

    it('should show connected but not working when all servers lack instructions', () => {
      const template = `
{{#if connectedServerCount}}
  {{#if hasServers}}
    Status: {{instructionalServerCount}} of {{connectedServerCount}} servers working
  {{else}}
    Status: {{connectedServerCount}} servers connected but none working
  {{/if}}
{{else}}
  Status: No servers connected
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      // No instructions set for any server
      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Status: 2 servers connected but none working');
      expect(result).not.toContain('servers working');
    });
  });

  describe('Real-world Template Scenarios', () => {
    it('should render dashboard-style template correctly', () => {
      const template = `
# Server Dashboard

## Overview
- **Connected**: {{connectedServerCount}} {{connectedPluralServers}}
- **Active**: {{instructionalServerCount}} {{pluralServers}} providing instructions
- **Status**: {{#if hasServers}}✅ Operational{{else}}⚠️ Waiting for instructions{{/if}}

{{#if connectedServerCount}}
## Connected Servers
{{#each servers}}
{{#if hasInstructions}}
### ✅ {{name}}
{{instructions}}
{{else}}
### ⏳ {{name}}
*Waiting for instructions*
{{/if}}

{{/each}}
{{else}}
## No Servers
No servers are currently connected.
{{/if}}

{{#if hasServers}}
## Quick Access
Available servers: {{serverList}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['primary-api', createTestConnection('primary-api')],
        ['secondary-api', createTestConnection('secondary-api')],
        ['cache-service', createTestConnection('cache-service')],
      ]) as OutboundConnections;

      // Mixed state: some servers working, some not
      instructionAggregator.setInstructions('primary-api', 'Primary API server for main operations');
      instructionAggregator.setInstructions('cache-service', 'Cache service for performance');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('**Connected**: 3 servers');
      expect(result).toContain('**Active**: 2 servers providing instructions');
      expect(result).toContain('**Status**: ✅ Operational');

      expect(result).toContain('### ✅ primary-api');
      expect(result).toContain('Primary API server for main operations');
      expect(result).toContain('### ⏳ secondary-api');
      expect(result).toContain('*Waiting for instructions*');
      expect(result).toContain('### ✅ cache-service');

      expect(result).toContain('Available servers: cache-service\nprimary-api');
      expect(result.split('Available servers:')[1]).not.toContain('secondary-api'); // Not in the quick access list
    });

    it('should handle monitoring template with alerts', () => {
      const template = `
{{#if connectedServerCount}}
Monitoring {{connectedServerCount}} {{connectedPluralServers}}

{{#if hasServers}}
✅ {{instructionalServerCount}} {{pluralServers}} {{isAre}} healthy and providing instructions
{{else}}
🚨 ALERT: All servers are connected but none are providing instructions!
{{/if}}

{{else}}
🔴 CRITICAL: No servers connected
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test case 1: All servers working
      const connections1 = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server1', 'Instructions 1');
      instructionAggregator.setInstructions('server2', 'Instructions 2');

      const result1 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result1).toContain('✅ 2 servers are healthy');
      expect(result1).not.toContain('🚨 ALERT');

      // Test case 2: Some servers not working
      instructionAggregator.clear();
      instructionAggregator.setInstructions('server1', 'Instructions 1');
      // server2 has no instructions

      const result2 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result2).toContain('✅ 1 server is healthy');
      expect(result2).not.toContain('🚨 ALERT');

      // Test case 3: No servers working
      instructionAggregator.clear();
      const result3 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result3).toContain('🚨 ALERT: All servers are connected but none are providing instructions!');
      expect(result3).not.toContain('✅');
    });
  });

  describe('Filtering Impact on Counts', () => {
    it('should filter both connected and instructional counts correctly', () => {
      const template = `
Total servers (before filtering):
- Connected: {{connectedServerCount}}
- Instructional: {{instructionalServerCount}}

Filtering context: {{filterContext}}

Server breakdown:
{{#each servers}}
- {{name}}: {{#if hasInstructions}}HAS instructions{{else}}NO instructions{{/if}}
{{/each}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['production'],
        customTemplate: template,
      };

      const connections = new Map([
        ['prod-api', createTestConnection('prod-api', ['production', 'api'])],
        ['dev-api', createTestConnection('dev-api', ['development', 'api'])],
        ['prod-db', createTestConnection('prod-db', ['production', 'database'])],
        ['staging-db', createTestConnection('staging-db', ['staging', 'database'])],
      ]) as OutboundConnections;

      // Instructions for some servers
      instructionAggregator.setInstructions('prod-api', 'Production API');
      instructionAggregator.setInstructions('dev-api', 'Development API');
      instructionAggregator.setInstructions('prod-db', 'Production DB');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      // Should only show production servers (prod-api, prod-db)
      expect(result).toContain('Connected: 2'); // Only production servers
      expect(result).toContain('Instructional: 2'); // Both prod servers have instructions
      expect(result).toContain('(filtered by tags: production)');

      expect(result).toContain('- prod-api: HAS instructions');
      expect(result).toContain('- prod-db: HAS instructions');
      expect(result).not.toContain('dev-api');
      expect(result).not.toContain('staging-db');
    });

    it('should handle preset filtering correctly', () => {
      const template = `
Preset filtering active{{filterContext}}
{{connectedServerCount}} total, {{instructionalServerCount}} with instructions

{{#unless hasServers}}
No servers with instructions match the preset filter.
{{/unless}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'preset',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server1', 'Instructions 1');
      instructionAggregator.setInstructions('server2', 'Instructions 2');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Preset filtering active (filtered by preset)');
      // Exact counts depend on preset logic, but structure should be correct
      expect(result).toMatch(/\d+ total, \d+ with instructions/);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large numbers of servers efficiently', () => {
      const template = `
Scale test: {{connectedServerCount}} connected, {{instructionalServerCount}} instructional
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Create many servers
      const connections = new Map() as OutboundConnections;
      for (let i = 1; i <= 100; i++) {
        connections.set(`server${i}`, createTestConnection(`server${i}`));

        // Every 3rd server has instructions
        if (i % 3 === 0) {
          instructionAggregator.setInstructions(`server${i}`, `Instructions for server ${i}`);
        }
      }

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Scale test: 100 connected, 33 instructional');
      // Should complete without timeout or memory issues
    });

    it('should handle special characters in server names', () => {
      const template = `
Servers:
{{#each servers}}
- "{{name}}" ({{#if hasInstructions}}✓{{else}}✗{{/if}})
{{/each}}

List: {{serverList}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server-with-dashes', createTestConnection('server-with-dashes')],
        ['server_with_underscores', createTestConnection('server_with_underscores')],
        ['server.with.dots', createTestConnection('server.with.dots')],
        ['server@domain.com', createTestConnection('server@domain.com')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server-with-dashes', 'Dash server instructions');
      instructionAggregator.setInstructions('server.with.dots', 'Dot server instructions');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('"server-with-dashes" (✓)');
      expect(result).toContain('"server_with_underscores" (✗)');
      expect(result).toContain('"server.with.dots" (✓)');
      expect(result).toContain('"server@domain.com" (✗)');

      expect(result).toContain('server-with-dashes\nserver.with.dots');
    });
  });
});
