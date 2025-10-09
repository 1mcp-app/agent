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

describe('InstructionAggregator - Complex Template Scenarios', () => {
  let instructionAggregator: InstructionAggregator;

  beforeEach(() => {
    instructionAggregator = new InstructionAggregator();
  });

  describe('Real-World Production Templates', () => {
    it('should render a comprehensive server status dashboard', () => {
      const template = `
# 🖥️ Server Infrastructure Dashboard

## 📊 Overview
- **Total Servers**: {{connectedServerCount}} {{connectedPluralServers}} {{connectedIsAre}} connected
- **Operational**: {{instructionalServerCount}} {{pluralServers}} {{isAre}} providing services
- **Health**: {{#if hasServers}}✅ {{math instructionalServerCount '/' connectedServerCount '*' 100}}% operational{{else}}❌ No services running{{/if}}

{{#if connectedServerCount}}
## 🔌 Connection Status
{{#each servers}}
### {{#if hasInstructions}}🟢{{else}}🔴{{/if}} {{name}}
- **Status**: {{#if hasInstructions}}OPERATIONAL{{else}}CONNECTED (No Services){{/if}}
- **Type**: {{#if (contains name "api")}}API Server{{else if (contains name "db")}}Database{{else if (contains name "web")}}Web Server{{else}}Service{{/if}}
{{#if hasInstructions}}
- **Details**: {{instructions}}
{{/if}}

{{/each}}

{{#if hasServers}}
## 🚀 Available Services
Quick access to operational servers:
\`\`\`
{{serverList}}
\`\`\`

{{#if (gt connectedServerCount instructionalServerCount)}}
## ⚠️ Maintenance Required
{{subtract connectedServerCount instructionalServerCount}} {{#if (eq (subtract connectedServerCount instructionalServerCount) 1)}}server requires{{else}}servers require{{/if}} attention:
{{#each servers}}
{{#unless hasInstructions}}
- **{{name}}**: Service configuration needed
{{/unless}}
{{/each}}
{{/if}}
{{else}}
## 🔧 Maintenance Mode
All connected servers are in maintenance mode. No services are currently available.
{{/if}}

{{else}}
## ❌ System Offline
No servers are currently connected to the system.
{{/if}}

---
*Dashboard updated: {{timestamp}}*
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['api-primary', createTestConnection('api-primary')],
        ['api-secondary', createTestConnection('api-secondary')],
        ['db-master', createTestConnection('db-master')],
        ['web-frontend', createTestConnection('web-frontend')],
        ['cache-redis', createTestConnection('cache-redis')],
      ]) as OutboundConnections;

      // Realistic mixed state
      instructionAggregator.setInstructions(
        'api-primary',
        'Primary API server handling user requests and authentication',
      );
      instructionAggregator.setInstructions('db-master', 'Master database server with read/write access');
      instructionAggregator.setInstructions('web-frontend', 'Frontend web server serving React application');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('**Total Servers**: 5 servers are connected');
      expect(result).toContain('**Operational**: 3 servers are providing services');
      expect(result).toContain('✅ 60% operational');

      expect(result).toContain('🟢 api-primary');
      expect(result).toContain('**Status**: OPERATIONAL');
      expect(result).toContain('**Type**: API Server');
      expect(result).toContain('Primary API server handling user requests');

      expect(result).toContain('🔴 api-secondary');
      expect(result).toContain('**Status**: CONNECTED (No Services)');

      expect(result).toContain('⚠️ Maintenance Required');
      expect(result).toContain('2 servers require attention');
      expect(result).toContain('- **api-secondary**: Service configuration needed');
      expect(result).toContain('- **cache-redis**: Service configuration needed');

      expect(result).toContain('api-primary\ndb-master\nweb-frontend');
    });

    it('should render a service discovery template for developers', () => {
      const template = `
# 🔍 Service Discovery
{{#if hasServers}}
Found {{instructionalServerCount}} active {{pluralServers}} out of {{connectedServerCount}} connected.

## 📋 Service Registry
{{#each servers}}
{{#if hasInstructions}}
### \`{{name}}\`
{{instructions}}
{{/if}}
{{/each}}

## 🛠️ Developer Quick Reference
Available services:
{{#each serverNames}}
- \`{{this}}\` → Tools available with pattern \`{{../toolPattern}}\`
{{/each}}

{{#if filterContext}}
*Filtered view{{filterContext}}*
{{/if}}

{{else}}
{{#if connectedServerCount}}
# ⏳ Services Starting Up
{{connectedServerCount}} {{connectedPluralServers}} {{connectedIsAre}} connected but not ready yet.

Please wait for services to initialize...
{{else}}
# 🚫 No Services Available
No servers are currently connected.
{{/if}}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['api', 'microservice'],
        customTemplate: template,
        toolPattern: '{server}::{tool}',
      };

      const connections = new Map([
        ['user-service', createTestConnection('user-service', ['api', 'microservice', 'users'])],
        ['auth-service', createTestConnection('auth-service', ['api', 'microservice', 'auth'])],
        ['notification-service', createTestConnection('notification-service', ['api', 'microservice'])],
        ['web-app', createTestConnection('web-app', ['frontend', 'web'])],
        ['database', createTestConnection('database', ['storage', 'persistence'])],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions(
        'user-service',
        '**User Management API**\n- GET /users - List users\n- POST /users - Create user\n- Authentication required',
      );
      instructionAggregator.setInstructions(
        'auth-service',
        '**Authentication Service**\n- POST /auth/login - User login\n- POST /auth/refresh - Refresh token\n- JWT-based authentication',
      );

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Found 2 active servers out of 3 connected');
      expect(result).toContain('(filtered by tags: api, microservice)');

      expect(result).toContain('### `user-service`');
      expect(result).toContain('**User Management API**');
      expect(result).toContain('GET /users - List users');

      expect(result).toContain('### `auth-service`');
      expect(result).toContain('**Authentication Service**');
      expect(result).toContain('JWT-based authentication');

      expect(result).toContain('- `user-service` → Tools available with pattern `{server}::{tool}`');
      expect(result).toContain('- `auth-service` → Tools available with pattern `{server}::{tool}`');
      expect(result).not.toContain('notification-service'); // No instructions
      expect(result).not.toContain('web-app'); // Filtered out
    });

    it('should render a monitoring and alerting template', () => {
      const template = `
# 📊 System Monitoring Alert

{{#if connectedServerCount}}
## 🔍 Infrastructure Status
- **Monitored**: {{connectedServerCount}} {{connectedPluralServers}}
- **Healthy**: {{instructionalServerCount}} {{pluralServers}}
- **Critical**: {{subtract connectedServerCount instructionalServerCount}} {{#if (eq (subtract connectedServerCount instructionalServerCount) 1)}}server{{else}}servers{{/if}}

{{#if hasServers}}
### ✅ Healthy Services
{{#each servers}}
{{#if hasInstructions}}
- **{{name}}**: {{#if (gt (len instructions) 50)}}{{substring instructions 0 50}}...{{else}}{{instructions}}{{/if}}
{{/if}}
{{/each}}
{{/if}}

{{#if (gt connectedServerCount instructionalServerCount)}}
### 🚨 CRITICAL ALERTS
{{#each servers}}
{{#unless hasInstructions}}
- **{{name}}**: Service down or not responding
  - Action: Check server logs and restart if necessary
  - Priority: HIGH
{{/unless}}
{{/each}}

### 📈 Health Ratio
Current health: {{math instructionalServerCount '/' connectedServerCount '*' 100}}%
{{#if (lt (math instructionalServerCount '/' connectedServerCount '*' 100) 80)}}
⚠️ **WARNING**: Health ratio below 80% threshold
{{/if}}
{{/if}}

{{else}}
# 🔴 SYSTEM DOWN
**CRITICAL**: No servers are connected to the monitoring system.

Immediate action required:
1. Check network connectivity
2. Verify server infrastructure
3. Contact operations team
{{/if}}

---
*Monitoring Status: {{#if hasServers}}ACTIVE{{else}}{{#if connectedServerCount}}DEGRADED{{else}}OFFLINE{{/if}}{{/if}}*
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['web-01', createTestConnection('web-01')],
        ['web-02', createTestConnection('web-02')],
        ['api-01', createTestConnection('api-01')],
        ['api-02', createTestConnection('api-02')],
        ['db-primary', createTestConnection('db-primary')],
      ]) as OutboundConnections;

      // Simulate degraded state - some servers down
      instructionAggregator.setInstructions('web-01', 'Frontend server responding normally, load: 45%');
      instructionAggregator.setInstructions('api-01', 'API server operational, handling requests at normal rate');
      instructionAggregator.setInstructions(
        'db-primary',
        'Database server running, connections stable, disk usage: 67%',
      );

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('**Monitored**: 5 servers');
      expect(result).toContain('**Healthy**: 3 servers');
      expect(result).toContain('**Critical**: 2 servers');

      expect(result).toContain('### ✅ Healthy Services');
      expect(result).toContain('- **web-01**: Frontend server responding normally, load: 45%');
      expect(result).toContain('- **api-01**: API server operational, handling requests at norma...');
      expect(result).toContain('- **db-primary**: Database server running, connections stable, disk ...');

      expect(result).toContain('### 🚨 CRITICAL ALERTS');
      expect(result).toContain('- **web-02**: Service down or not responding');
      expect(result).toContain('- **api-02**: Service down or not responding');
      expect(result).toContain('Priority: HIGH');

      expect(result).toContain('Current health: 60%');
      expect(result).toContain('⚠️ **WARNING**: Health ratio below 80% threshold');
      expect(result).toContain('*Monitoring Status: ACTIVE*');
    });
  });

  describe('Advanced Template Features', () => {
    it('should handle complex conditional logic with multiple variable combinations', () => {
      const template = `
{{#if (and connectedServerCount hasServers)}}
  {{#if (eq connectedServerCount instructionalServerCount)}}
    Status: ALL_OPERATIONAL ({{connectedServerCount}}/{{connectedServerCount}})
  {{else}}
    Status: PARTIAL_OPERATIONAL ({{instructionalServerCount}}/{{connectedServerCount}})
    {{#if (gt (subtract connectedServerCount instructionalServerCount) (div connectedServerCount 2))}}
      Alert: MAJORITY_DOWN
    {{else}}
      Alert: MINORITY_DOWN
    {{/if}}
  {{/if}}
{{else if connectedServerCount}}
  Status: ALL_DOWN (0/{{connectedServerCount}})
  Alert: CRITICAL
{{else}}
  Status: NO_SERVERS
  Alert: INFRASTRUCTURE_FAILURE
{{/if}}

Performance: {{#if connectedServerCount}}{{math instructionalServerCount '/' connectedServerCount '*' 100}}%{{else}}0%{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test Case 1: All operational
      const connections1 = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('server1', 'Server 1 active');
      instructionAggregator.setInstructions('server2', 'Server 2 active');

      const result1 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result1).toContain('Status: ALL_OPERATIONAL (2/2)');
      expect(result1).toContain('Performance: 100%');

      // Test Case 2: Minority down
      instructionAggregator.clear();
      instructionAggregator.setInstructions('server1', 'Server 1 active');
      // server2 has no instructions

      const result2 = instructionAggregator.getFilteredInstructions(config, connections1);
      expect(result2).toContain('Status: PARTIAL_OPERATIONAL (1/2)');
      expect(result2).toContain('Alert: MINORITY_DOWN');
      expect(result2).toContain('Performance: 50%');

      // Test Case 3: Majority down
      const connections3 = new Map([
        ['server1', createTestConnection('server1')],
        ['server2', createTestConnection('server2')],
        ['server3', createTestConnection('server3')],
        ['server4', createTestConnection('server4')],
      ]) as OutboundConnections;

      instructionAggregator.clear();
      instructionAggregator.setInstructions('server1', 'Server 1 active');
      // 3 out of 4 servers down

      const result3 = instructionAggregator.getFilteredInstructions(config, connections3);
      expect(result3).toContain('Status: PARTIAL_OPERATIONAL (1/4)');
      expect(result3).toContain('Alert: MAJORITY_DOWN');
      expect(result3).toContain('Performance: 25%');

      // Test Case 4: All down
      instructionAggregator.clear();
      const result4 = instructionAggregator.getFilteredInstructions(config, connections3);
      expect(result4).toContain('Status: ALL_DOWN (0/4)');
      expect(result4).toContain('Alert: CRITICAL');
      expect(result4).toContain('Performance: 0%');

      // Test Case 5: No servers
      const emptyConnections = new Map() as OutboundConnections;
      const result5 = instructionAggregator.getFilteredInstructions(config, emptyConnections);
      expect(result5).toContain('Status: NO_SERVERS');
      expect(result5).toContain('Alert: INFRASTRUCTURE_FAILURE');
      expect(result5).toContain('Performance: 0%');
    });

    it('should handle dynamic content generation based on server state', () => {
      const template = `
# Dynamic Configuration Generator

{{#if hasServers}}
## Load Balancer Configuration
{{#each servers}}
{{#if hasInstructions}}
upstream {{name}} {
    server {{name}}.internal:8080;
    # {{instructions}}
}
{{/if}}
{{/each}}

server {
    listen 80;

    {{#each serverNames}}
    location /{{this}}/ {
        proxy_pass http://{{this}};
        proxy_set_header Host $host;
    }
    {{/each}}
}

## Health Check Endpoints
{{#each serverNames}}
- http://{{this}}.internal:8080/health
{{/each}}

## Summary
Total endpoints: {{instructionalServerCount}}
Redundancy: {{#if (gt instructionalServerCount 1)}}ENABLED{{else}}DISABLED{{/if}}
{{else}}
## Emergency Configuration
# No backend servers available
server {
    listen 80;
    return 503 "Service Temporarily Unavailable";
}
{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      const connections = new Map([
        ['auth-api', createTestConnection('auth-api')],
        ['user-api', createTestConnection('user-api')],
        ['payment-api', createTestConnection('payment-api')],
      ]) as OutboundConnections;

      instructionAggregator.setInstructions('auth-api', 'Authentication and authorization service');
      instructionAggregator.setInstructions('user-api', 'User management and profile service');

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('## Load Balancer Configuration');
      expect(result).toContain('upstream auth-api {');
      expect(result).toContain('server auth-api.internal:8080;');
      expect(result).toContain('# Authentication and authorization service');
      expect(result).toContain('upstream user-api {');
      expect(result).not.toContain('upstream payment-api {'); // No instructions

      expect(result).toContain('location /auth-api/ {');
      expect(result).toContain('proxy_pass http://auth-api;');
      expect(result).toContain('location /user-api/ {');
      expect(result).not.toContain('location /payment-api/'); // No instructions

      expect(result).toContain('- http://auth-api.internal:8080/health');
      expect(result).toContain('- http://user-api.internal:8080/health');

      expect(result).toContain('Total endpoints: 2');
      expect(result).toContain('Redundancy: ENABLED');
    });
  });

  describe('Error Handling and Fallbacks', () => {
    it('should gracefully handle template errors while preserving variable functionality', () => {
      const template = `
Basic Info: {{connectedServerCount}} connected, {{instructionalServerCount}} active

{{#if hasServers}}
Server Details:
{{#each servers}}
{{#if hasInstructions}}
- {{name}}: {{instructions}}
{{/if}}
{{/each}}
{{else}}
No active servers available.
{{/if}}

Status: {{#if hasServers}}OPERATIONAL{{else}}STANDBY{{/if}}
      `.trim();

      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        customTemplate: template,
      };

      // Test with various edge cases
      const connections = new Map([['test-server', createTestConnection('test-server')]]) as OutboundConnections;

      // Test with instruction containing special template characters
      instructionAggregator.setInstructions(
        'test-server',
        'Server with {{special}} characters and {{variables}} that should not be parsed',
      );

      const result = instructionAggregator.getFilteredInstructions(config, connections);

      expect(result).toContain('Basic Info: 1 connected, 1 active');
      expect(result).toContain('- test-server: Server with {{special}} characters');
      expect(result).toContain('Status: OPERATIONAL');
    });
  });
});
