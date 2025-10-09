import type { InboundConnectionConfig, OutboundConnections } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { InstructionAggregator } from './instructionAggregator.js';

// Helper function to create test connections
function createTestConnection(name: string, tags: string[] = []) {
  return {
    name,
    transport: { tags, timeout: 5000 },
    client: {} as any,
    status: 'connected' as any,
  } as any;
}

describe('InstructionAggregator - Template Conditionals', () => {
  let instructionAggregator: InstructionAggregator;

  beforeEach(() => {
    instructionAggregator = new InstructionAggregator();
  });

  describe('hasServers vs hasInstructionalServers Logic', () => {
    it('should have hasServers=false and hasInstructionalServers=false when no servers connected', () => {
      const template = `
hasServers: {{hasServers}}
hasInstructionalServers: {{hasInstructionalServers}}
connectedServerCount: {{connectedServerCount}}
instructionalServerCount: {{instructionalServerCount}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const emptyConnections = new Map() as OutboundConnections;
      const result = instructionAggregator.getFilteredInstructions(config, emptyConnections);

      expect(result).toContain('hasServers: false');
      expect(result).toContain('hasInstructionalServers: false');
      expect(result).toContain('connectedServerCount: 0');
      expect(result).toContain('instructionalServerCount: 0');
    });

    it('should have hasServers=false when servers connected but no instructions', () => {
      const template = `
hasServers: {{hasServers}}
hasInstructionalServers: {{hasInstructionalServers}}
connectedServerCount: {{connectedServerCount}}
instructionalServerCount: {{instructionalServerCount}}
serverCount: {{serverCount}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Servers connected but no instructions set
      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('hasServers: false');
      expect(result).toContain('hasInstructionalServers: false');
      expect(result).toContain('connectedServerCount: 2');
      expect(result).toContain('instructionalServerCount: 0');
      expect(result).toContain('serverCount: 0');
    });

    it('should have hasServers=true when servers have instructions', () => {
      const template = `
hasServers: {{hasServers}}
hasInstructionalServers: {{hasInstructionalServers}}
connectedServerCount: {{connectedServerCount}}
instructionalServerCount: {{instructionalServerCount}}
serverCount: {{serverCount}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      // Add instructions for server1 only
      instructionAggregator.setInstructions('server1', 'Server 1 instructions');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('hasServers: true');
      expect(result).toContain('hasInstructionalServers: true');
      expect(result).toContain('connectedServerCount: 2');
      expect(result).toContain('instructionalServerCount: 1');
      expect(result).toContain('serverCount: 1');
    });

    it('should show different values for connected vs instructional when mixed state', () => {
      const template = `
{{#if hasServers}}
  Has instructional servers: YES
  Instructional count: {{instructionalServerCount}}
  Connected count: {{connectedServerCount}}
  Grammar: {{pluralServers}} {{isAre}} providing instructions
  Connected grammar: {{connectedPluralServers}} {{connectedIsAre}} connected
{{else}}
  Has instructional servers: NO
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
      ]) as OutboundConnections;

      // Only server1 has instructions
      instructionAggregator.setInstructions('server1', 'Server 1 instructions');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Has instructional servers: YES');
      expect(result).toContain('Instructional count: 1');
      expect(result).toContain('Connected count: 3');
      expect(result).toContain('server is providing'); // singular for instructional
      expect(result).toContain('servers are connected'); // plural for connected
    });
  });

  describe('Conditional Template Scenarios', () => {
    it('should render different content based on hasServers vs connectedServerCount', () => {
      const template = `
{{#if hasServers}}
  ## Active Servers
  {{instructionalServerCount}} servers providing instructions
  {{#if connectedServerCount}}
    Total connected: {{connectedServerCount}}
  {{/if}}
{{else}}
  {{#if connectedServerCount}}
    ## Waiting for Instructions
    {{connectedServerCount}} servers connected but no instructions yet
  {{else}}
    ## No Servers
    No servers connected
  {{/if}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test case 1: Servers connected but no instructions
      const connections1 = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      const result1 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result1).toContain('## Waiting for Instructions');
      expect(result1).toContain('2 servers connected but no instructions yet');
      expect(result1).not.toContain('## Active Servers');

      // Test case 2: Some servers with instructions
      instructionAggregator.setInstructions('server1', 'Server 1 instructions');
      const result2 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result2).toContain('## Active Servers');
      expect(result2).toContain('1 servers providing instructions');
      expect(result2).toContain('Total connected: 2');
      expect(result2).not.toContain('## Waiting for Instructions');

      // Test case 3: No servers at all
      const emptyConnections = new Map() as OutboundConnections;
      const result3 = instructionAggregator.getFilteredInstructions(config, emptyConnections);
      expect(result3).toContain('## No Servers');
      expect(result3).toContain('No servers connected');
      expect(result3).not.toContain('## Active Servers');
      expect(result3).not.toContain('## Waiting for Instructions');
    });

    it('should handle complex nested conditionals correctly', () => {
      const template = `
Status: {{#if hasServers}}{{#if hasInstructionalServers}}ACTIVE{{else}}WAITING{{/if}}{{else}}OFFLINE{{/if}}

{{#if connectedServerCount}}
Connected: {{connectedServerCount}} {{connectedPluralServers}}
  {{#if hasServers}}
  Active: {{instructionalServerCount}} {{pluralServers}} providing instructions
    {{#unless hasInstructionalServers}}
    (No instructions available)
    {{/unless}}
  {{else}}
  Status: All servers waiting for instructions
  {{/if}}
{{else}}
No servers connected
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test different states
      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      // State 1: Connected but no instructions
      const result1 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result1).toContain('Status: OFFLINE'); // hasServers is false
      expect(result1).toContain('Connected: 2 servers');
      expect(result1).toContain('Status: All servers waiting');

      // State 2: With instructions
      instructionAggregator.setInstructions('server1', 'Server 1 instructions');
      const result2 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result2).toContain('Status: ACTIVE'); // hasServers and hasInstructionalServers both true
      expect(result2).toContain('Connected: 2 servers');
      expect(result2).toContain('Active: 1 server providing');
      expect(result2).not.toContain('(No instructions available)');
    });
  });

  describe('Grammar Helper Variables', () => {
    it('should use correct grammar for different counts', () => {
      const template = `
Instructional: {{instructionalServerCount}} {{pluralServers}} {{isAre}} active
Connected: {{connectedServerCount}} {{connectedPluralServers}} {{connectedIsAre}} online
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test singular vs plural
      const connections1 = new Map([['server1', createTestConnection('server1')]]) as OutboundConnections;

      instructionAggregator.setInstructions('server1', 'Server 1 instructions');
      const result1 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result1).toContain('1 server is active');
      expect(result1).toContain('1 server is online');

      // Test plural
      const connections2 = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server2', 'Server 2 instructions');
      const result2 = instructionAggregator.getFilteredInstructions(config, connections2);
      expect(result2).toContain('2 servers are active'); // server1 + server2
      expect(result2).toContain('3 servers are online'); // all connected
    });
  });

  describe('Server Lists in Different States', () => {
    it('should show correct server lists based on instructions', () => {
      const template = `
All connected servers:
{{#each servers}}
- {{name}} ({{#if hasInstructions}}with instructions{{else}}no instructions{{/if}})
{{/each}}

Servers with instructions only:
{{#each serverNames}}
- {{this}}
{{/each}}

Server list (newline-separated):
{{serverList}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['alpha-server', createTestConnection('alpha-server')],
        ['beta-server', createTestConnection('beta-server')],
        ['gamma-server', createTestConnection('gamma-server')],
      ]) as OutboundConnections;

      // Only alpha and gamma have instructions
      instructionAggregator.setInstructions('alpha-server', 'Alpha instructions');
      instructionAggregator.setInstructions('gamma-server', 'Gamma instructions');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      // All servers should appear in the servers array
      expect(result).toContain('- alpha-server (with instructions)');
      expect(result).toContain('- beta-server (no instructions)');
      expect(result).toContain('- gamma-server (with instructions)');

      // Only servers with instructions should appear in serverNames
      expect(result).toMatch(/Servers with instructions only:\s+- alpha-server\s+- gamma-server/);

      // serverList should only include servers with instructions
      expect(result).toContain('alpha-server\ngamma-server');
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle empty instructions gracefully', () => {
      const template = `
{{#if hasServers}}
  Instructions available
{{else}}
  {{#if connectedServerCount}}
    Servers connected: {{connectedServerCount}}
    But no instructions: {{instructionalServerCount}}
  {{else}}
    No servers at all
  {{/if}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([['server1', createTestConnection('server1')]]) as OutboundConnections;

      // Set empty instruction
      instructionAggregator.setInstructions('server1', '');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Servers connected: 1');
      expect(result).toContain('But no instructions: 0');
      expect(result).not.toContain('Instructions available');
    });

    it('should handle whitespace-only instructions as empty', () => {
      const template = `hasServers: {{hasServers}}, instructionalServerCount: {{instructionalServerCount}}`;

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([['server1', createTestConnection('server1')]]) as OutboundConnections;

      // Set whitespace-only instruction
      instructionAggregator.setInstructions('server1', '   \n\t  ');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('hasServers: false');
      expect(result).toContain('instructionalServerCount: 0');
    });
  });
});
