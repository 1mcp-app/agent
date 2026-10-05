import { describe, expect, it } from 'vitest';

import { normalizeEvent } from './normalize.js';

describe('template lifecycle diagnostics', () => {
  it('identifies templates and instances without exposing rendered config or session identities', () => {
    const fields = {
      templateName: 'serena_1mcp',
      instanceId: '0123456789abcdef'.repeat(4),
      renderedHash: 'config-with-secret',
      instanceKey: 'serena_1mcp:config-with-secret:session-secret',
      sessionId: 'session-secret',
      clientCount: 2,
    };
    const result = normalizeEvent('templateServerManager.connected.to.template.client.instance.871228b8', fields);
    expect(result).toMatchObject({ templateName: 'serena_1mcp', instanceId: fields.instanceId, clientCount: 2 });
    expect(result?.message).not.toContain('<private>');
    expect(result?.sessionId_fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(result?.instanceKey_fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(result)).not.toContain('session-secret');
    expect(JSON.stringify(result)).not.toContain('config-with-secret');
    const other = normalizeEvent('templateServerManager.connected.to.template.client.instance.871228b8', {
      ...fields,
      templateName: 'codegraph',
      instanceId: 'fedcba9876543210'.repeat(4),
    });
    expect(other?.templateName).not.toBe(result?.templateName);
    expect(other?.instanceId).not.toBe(result?.instanceId);
  });

  it('retains counts and rejects credential-bearing or unbounded names and forged instance IDs', () => {
    const result = normalizeEvent('templateServerManager.creating.template.based.servers.for.session.63a3dddd', {
      templateCount: 3,
      sessionId: 'session-secret',
    });
    expect(result).toMatchObject({ templateCount: 3 });
    expect(result?.message).not.toContain('<private>');
    for (const templateName of [
      'api_key=secret',
      'Bearer secret',
      'https://user:pass@host',
      'a'.repeat(257),
      'name\nforged',
    ]) {
      const invalid = normalizeEvent('templateServerManager.connected.to.template.client.instance.871228b8', {
        templateName,
        instanceId: 'token=secret',
      });
      expect(invalid).not.toHaveProperty('templateName');
      expect(invalid).not.toHaveProperty('instanceId');
      expect(invalid).toHaveProperty('dropped_values', 2);
    }
  });
});
