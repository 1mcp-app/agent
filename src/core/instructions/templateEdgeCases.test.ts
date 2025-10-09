import type { InboundConnectionConfig, OutboundConnections } from '@src/core/types/index.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';

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

describe('InstructionAggregator - Edge Cases and Mixed States', () => {
  let instructionAggregator: InstructionAggregator;

  beforeEach(() => {
    instructionAggregator = new InstructionAggregator();
  });

  describe('Dynamic Server State Changes', () => {
    it('should handle servers losing and gaining instructions dynamically', () => {
      const template = `
State: {{#if hasServers}}ACTIVE{{else}}INACTIVE{{/if}}
Counts: {{instructionalServerCount}}/{{connectedServerCount}}
{{#if hasServers}}Servers: {{#each serverNames}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      // Initial state: no instructions
      const result1 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result1).toContain('State: INACTIVE');
      expect(result1).toContain('Counts: 0/2');
      expect(result1).not.toContain('Servers: '); // Empty server list

      // Add instruction to server1
      instructionAggregator.setInstructions('server1', 'Server 1 instructions');
      const result2 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result2).toContain('State: ACTIVE');
      expect(result2).toContain('Counts: 1/2');
      expect(result2).toContain('Servers: server1');

      // Add instruction to server2
      instructionAggregator.setInstructions('server2', 'Server 2 instructions');
      const result3 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result3).toContain('State: ACTIVE');
      expect(result3).toContain('Counts: 2/2');
      expect(result3).toContain('Servers: server1, server2');

      // Remove instruction from server1 (set to empty)
      instructionAggregator.setInstructions('server1', '');
      const result4 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result4).toContain('State: ACTIVE');
      expect(result4).toContain('Counts: 1/2');
      expect(result4).toContain('Servers: server2');

      // Remove all instructions
      instructionAggregator.clear();
      const result5 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result5).toContain('State: INACTIVE');
      expect(result5).toContain('Counts: 0/2');
    });

    it('should handle connection changes with existing instructions', () => {
      const template = `Connected: {{connectedServerCount}}, Active: {{instructionalServerCount}}`;
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Start with one server and add instruction
      const connections1 = new Map([['server1', createTestConnection('server1')]]) as OutboundConnections;

      instructionAggregator.setInstructions('server1', 'Server 1 instructions');
      const result1 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result1).toContain('Connected: 1, Active: 1');

      // Add more servers (some with instructions, some without)
      const connections2 = new Map([
        ['server1', createTestConnection('server1')], // Has instructions
        ['server2', createTestConnection('server2')], // No instructions yet
        ['server3', createTestConnection('server3')], // Will get instructions
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server3', 'Server 3 instructions');
      const result2 = instructionAggregator.getFilteredInstructions(config, connections2);
      expect(result2).toContain('Connected: 3, Active: 2');

      // Remove a server from connections but keep its instructions
      const connections3 = new Map([
        ['server1', createTestConnection('server1')],
        ['server3', createTestConnection('server3')],
      ]) as OutboundConnections;

      const result3 = instructionAggregator.getFilteredInstructions(config, connections3);
      expect(result3).toContain('Connected: 2, Active: 2');
    });
  });

  describe('Instruction Content Edge Cases', () => {
    it('should handle various whitespace and empty instruction scenarios', () => {
      const template = `
{{#each servers}}
{{name}}: {{#if hasInstructions}}"{{instructions}}"{{else}}EMPTY{{/if}}
{{/each}}
Active: {{instructionalServerCount}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
        ['server4', createTestConnection('server4')],
        ['server5', createTestConnection('server5')],
      ]) as OutboundConnections;

      // Various empty/whitespace scenarios
      instructionAggregator.setInstructions('server1', 'Valid instructions');
      instructionAggregator.setInstructions('server2', ''); // Empty string
      instructionAggregator.setInstructions('server3', '   '); // Spaces only
      instructionAggregator.setInstructions('server4', '\n\t  \n'); // Whitespace chars
      // server5 - no instructions set at all

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('server1: "Valid instructions"');
      expect(result).toContain('server2: EMPTY');
      expect(result).toContain('server3: EMPTY');
      expect(result).toContain('server4: EMPTY');
      expect(result).toContain('server5: EMPTY');
      expect(result).toContain('Active: 1'); // Only server1 counts
    });

    it('should handle instructions with special characters and formatting', () => {
      const template = `
{{#if hasServers}}
{{#each servers}}
{{#if hasInstructions}}
## {{name}}
{{instructions}}

{{/if}}
{{/each}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['json-server', createTestConnection('json-server')],
        ['xml-server', createTestConnection('xml-server')],
        ['markdown-server', createTestConnection('markdown-server')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions(
        'json-server',
        '{"type": "api", "endpoints": ["/users", "/posts"], "auth": "bearer"}',
      );
      instructionAggregator.setInstructions(
        'xml-server',
        '<config>\n  <endpoint>http://api.example.com</endpoint>\n  <timeout>30s</timeout>\n</config>',
      );
      instructionAggregator.setInstructions(
        'markdown-server',
        '# API Server\n\n**Features:**\n- Authentication\n- Rate limiting\n- Caching\n\n`GET /api/v1/status`',
      );

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('## json-server');
      expect(result).toContain('"type": "api"');
      expect(result).toContain('## xml-server');
      expect(result).toContain('<config>');
      expect(result).toContain('## markdown-server');
      expect(result).toContain('# API Server');
      expect(result).toContain('`GET /api/v1/status`');
    });
  });

  describe('Complex Filtering Scenarios', () => {
    it('should handle multiple tag filtering with mixed instruction states', () => {
      const template = `
Filter: {{filterContext}}
Results: {{connectedServerCount}} connected, {{instructionalServerCount}} active

{{#if hasServers}}
Active filtered servers:
{{#each serverNames}}
- {{this}}
{{/each}}
{{else}}
{{#if connectedServerCount}}
No active servers match filter ({{connectedServerCount}} connected)
{{else}}
No servers match filter
{{/if}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'advanced',
        tagExpression: TagQueryParser.parseAdvanced('production AND backend'),
        customTemplate: template,
      };

      const connections = new Map([
        ['prod-api', createTestConnection('prod-api', ['production', 'backend', 'api'])],
        ['dev-api', createTestConnection('dev-api', ['development', 'backend', 'api'])],
        ['prod-frontend', createTestConnection('prod-frontend', ['production', 'frontend'])],
        ['prod-db', createTestConnection('prod-db', ['production', 'backend', 'database'])],
        ['staging-backend', createTestConnection('staging-backend', ['staging', 'backend'])],
      ]) as OutboundConnections;

      // Only some servers have instructions
      instructionAggregator.setInstructions('prod-api', 'Production API instructions');
      instructionAggregator.setInstructions('dev-api', 'Development API instructions');
      instructionAggregator.setInstructions('prod-frontend', 'Frontend instructions');
      // prod-db and staging-backend have no instructions

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      // Should filter to production+backend servers: prod-api, prod-db
      // But only prod-api has instructions
      expect(result).toContain('(filtered by advanced expression)');
      expect(result).toContain('Results: 2 connected, 1 active');
      expect(result).toContain('- prod-api');
      expect(result).not.toContain('- prod-db'); // No instructions
      expect(result).not.toContain('dev-api'); // Wrong tags
      expect(result).not.toContain('prod-frontend'); // Wrong tags
    });

    it('should handle advanced tag expressions with mixed states', () => {
      const template = `
Expression filter{{filterContext}}
{{#if hasServers}}
Matching servers with instructions: {{instructionalServerCount}}
{{else}}
{{#if connectedServerCount}}
{{connectedServerCount}} servers match filter but none have instructions
{{else}}
No servers match the expression
{{/if}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'advanced',
        tagExpression: TagQueryParser.parseAdvanced(
          '(backend AND (production OR staging)) OR (frontend AND production)',
        ),
        customTemplate: template,
      };

      const connections = new Map([
        ['prod-api', createTestConnection('prod-api', ['production', 'backend'])],
        ['staging-api', createTestConnection('staging-api', ['staging', 'backend'])],
        ['prod-web', createTestConnection('prod-web', ['production', 'frontend'])],
        ['dev-api', createTestConnection('dev-api', ['development', 'backend'])],
        ['staging-web', createTestConnection('staging-web', ['staging', 'frontend'])],
      ]) as OutboundConnections;

      // Test case 1: Some matching servers have instructions
      instructionAggregator.setInstructions('prod-api', 'Prod API instructions');
      instructionAggregator.setInstructions('prod-web', 'Prod web instructions');

      const result1 = instructionAggregator.getFilteredInstructions(config, connections);
      // Should match: prod-api, staging-api, prod-web (3 total, 2 with instructions)
      expect(result1).toContain('(filtered by advanced expression)');
      expect(result1).toContain('Matching servers with instructions: 2');

      // Test case 2: No matching servers have instructions
      instructionAggregator.clear();
      const result2 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result2).toContain('3 servers match filter but none have instructions');
    });
  });

  describe('Template Rendering Edge Cases', () => {
    it('should handle deeply nested conditionals correctly', () => {
      const template = `
{{#if connectedServerCount}}
  {{#if hasServers}}
    Multiple active servers ({{instructionalServerCount}})
    {{#each serverNames}}
      {{#if @first}}First: {{this}}{{/if}}
      {{#if @last}}Last: {{this}}{{/if}}
    {{/each}}
  {{else}}
    {{connectedServerCount}} servers connected but none active
  {{/if}}
{{else}}
  No servers connected
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test multiple scenarios
      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
      ]) as OutboundConnections;

      // Scenario 1: Multiple active servers
      instructionAggregator.setInstructions('server1', 'Instructions 1');
      instructionAggregator.setInstructions('server3', 'Instructions 3');
      const result1 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result1).toContain('Multiple active servers (2)');
      expect(result1).toContain('First: server1');
      expect(result1).toContain('Last: server3');

      // Scenario 2: Single active server
      instructionAggregator.clear();
      instructionAggregator.setInstructions('server2', 'Instructions 2');
      const result2 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result2).toContain('Multiple active servers (1)');

      // Scenario 3: Connected but none active
      instructionAggregator.clear();
      const result3 = instructionAggregator.getFilteredInstructions(config, connections);
      expect(result3).toContain('3 servers connected but none active');

      // Scenario 4: No connections
      const emptyConnections = new Map() as OutboundConnections;
      const result4 = instructionAggregator.getFilteredInstructions(config, emptyConnections);
      expect(result4).toContain('No servers connected');
    });

    it('should handle template with loops and conditions', () => {
      const template = `
{{#if connectedServerCount}}
Server Status Report:
{{#each servers}}
{{@index}}. {{name}}
   Connection: ✓
   Instructions: {{#if hasInstructions}}✓ ({{instructions}}){{else}}✗ (waiting){{/if}}
   Status: {{#if hasInstructions}}ACTIVE{{else}}STANDBY{{/if}}
{{/each}}

Summary:
- Total Connected: {{connectedServerCount}}
- Active: {{instructionalServerCount}}
{{else}}
No servers to report
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['alpha', createTestConnection('alpha')],
        ['beta', createTestConnection('beta')],
        ['gamma', createTestConnection('gamma')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('alpha', 'Alpha service ready');
      instructionAggregator.setInstructions('gamma', 'Gamma service operational');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('0. alpha');
      expect(result).toContain('Instructions: ✓ (Alpha service ready)');
      expect(result).toContain('Status: ACTIVE');

      expect(result).toContain('1. beta');
      expect(result).toContain('Instructions: ✗ (waiting)');
      expect(result).toContain('Status: STANDBY');

      expect(result).toContain('2. gamma');
      expect(result).toContain('Instructions: ✓ (Gamma service operational)');
      expect(result).toContain('Status: ACTIVE');

      expect(result).toContain('- Total Connected: 3');
      expect(result).toContain('- Active: 2');
    });
  });

  describe('Variable Consistency and State Management', () => {
    it('should maintain consistent variable relationships across all operations', () => {
      const template = `
Consistency Check Values:
- hasServers: {{hasServers}}
- hasInstructionalServers: {{hasInstructionalServers}}
- serverCount: {{serverCount}}
- instructionalServerCount: {{instructionalServerCount}}
- connectedServerCount: {{connectedServerCount}}
- serverNames: {{#each serverNames}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
        ['server4', createTestConnection('server4')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server1', 'Instructions 1');
      instructionAggregator.setInstructions('server3', 'Instructions 3');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      // Verify actual values
      expect(result).toContain('hasServers: true');
      expect(result).toContain('hasInstructionalServers: true');
      expect(result).toContain('serverCount: 2');
      expect(result).toContain('instructionalServerCount: 2');
      expect(result).toContain('connectedServerCount: 4');
      expect(result).toContain('serverNames: server1, server3');
    });
  });
});
