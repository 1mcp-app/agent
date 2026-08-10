import type { ContextData } from '@src/types/context.js';

import { describe, expect, it } from 'vitest';

import {
  redactContextForAudit,
  redactTemplateContextBodyForLogging,
  redactTemplateContextQueryForLogging,
} from './templateContextAuthority.js';

describe('template context audit redaction', () => {
  it('keeps useful structure while redacting environment, custom, and user values', () => {
    const context: ContextData = {
      project: {
        name: 'agent',
        path: '/work/agent',
        custom: { tenant: 'customer-a', commandOverride: 'suspicious' },
      },
      user: { username: 'alice', home: '/Users/alice', email: 'alice@example.com', shell: '/bin/zsh' },
      environment: { variables: { API_TOKEN: 'secret-token', NODE_ENV: 'production' } },
      sessionId: 'session-a',
      transport: { type: 'inspect' },
    };

    const redacted = redactContextForAudit(context);
    const serialized = JSON.stringify(redacted);

    expect(redacted).toMatchObject({
      project: {
        name: 'agent',
        path: '/work/agent',
        custom: { tenant: '[REDACTED]', commandOverride: '[REDACTED]' },
      },
      user: { username: 'alice', home: '[REDACTED]', email: '[REDACTED]', shell: '[REDACTED]' },
      environment: { variables: { API_TOKEN: '[REDACTED]', NODE_ENV: '[REDACTED]' } },
    });
    expect(serialized).not.toContain('customer-a');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('alice@example.com');
  });

  it('removes raw GET base64 and proof signatures from general request logs', () => {
    expect(
      redactTemplateContextQueryForLogging({ context: 'eyJzZWNyZXQiOiJ2YWx1ZSJ9', contextProof: 'signed-proof' }),
    ).toEqual({ context: '[DECODED_IN_TEMPLATE_CONTEXT_AUDIT]', contextProof: '[REDACTED]' });

    const body = redactTemplateContextBodyForLogging({
      params: {
        _meta: {
          context: {
            project: { name: 'agent', custom: { tenant: 'customer-a' } },
            user: { home: '/Users/alice' },
            environment: { variables: { API_TOKEN: 'secret-token' } },
          },
          contextProof: { signature: 'replayable-signature' },
        },
      },
    });
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('customer-a');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('replayable-signature');
  });

  it('marks malformed context without throwing from request logging', () => {
    expect(
      redactTemplateContextBodyForLogging({
        params: {
          _meta: {
            context: { unexpected: 'attacker-controlled' },
          },
        },
      }),
    ).toEqual({
      params: {
        _meta: {
          context: { invalid: true, keys: ['unexpected'] },
        },
      },
    });
  });
});
