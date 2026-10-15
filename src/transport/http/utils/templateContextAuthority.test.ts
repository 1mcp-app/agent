import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as templateContextTrust from '@src/core/context/templateContextTrust.js';
import {
  bindProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
  validateProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeRequestTemplateContext,
  getRequestProjectPreparationAuthority,
  redactContextForAudit,
  redactTemplateContextBodyForLogging,
  redactTemplateContextQueryForLogging,
} from './templateContextAuthority.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('template context session policy', () => {
  it('mints only at the verified-local boundary and rechecks live trust and TTL for a retained binding', () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preparation-authority-'));
    let trust: 'verified' | 'legacy' = 'verified';
    vi.spyOn(AgentConfigManager, 'getInstance').mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === 'runtimeScopeStoragePath') return storageDir;
        if (key === 'templateContext') return { trust };
        if (key === 'auth') return { sessionTtlMinutes: 1 };
        return undefined;
      }),
    } as unknown as AgentConfigManager);
    try {
      const runtimeScopeId = new RuntimeIdentityService({ storageDir }).getRuntimeScopeId();
      const capability = new templateContextTrust.TemplateContextCapabilityStore({
        storageDir,
        runtimeScopeId,
      }).getOrCreate();
      const context: ContextData = { project: { path: '/repo' }, user: {}, environment: {}, sessionId: 'session-a' };
      const proof = templateContextTrust.createTemplateContextProof(context, capability);
      const result = authorizeRequestTemplateContext({
        context,
        proof,
        transportSessionId: 'session-a',
        source: 'meta',
      });
      const receipt = getRequestProjectPreparationAuthority(result);
      expect(receipt).toBeDefined();
      const bound = bindProjectPreparationAuthority(
        normalizeProjectPreparationAuthority(receipt, context, context),
        'binding-a',
        context,
      );
      const admission = { bindingId: 'binding-a', context, ownerSessionId: 'session-a' };
      expect(validateProjectPreparationAuthority(bound, admission)).toBe(true);
      expect(getRequestProjectPreparationAuthority({ ...result })).toBeUndefined();
      trust = 'legacy';
      expect(validateProjectPreparationAuthority(bound, admission)).toBe(false);
      expect(
        getRequestProjectPreparationAuthority(
          authorizeRequestTemplateContext({ context, proof, transportSessionId: 'session-a', source: 'meta' }),
        ),
      ).toBeUndefined();
      trust = 'verified';
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse(proof.issuedAt) + 60001);
      expect(validateProjectPreparationAuthority(bound, admission)).toBe(false);
    } finally {
      vi.useRealTimers();
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });
  it('uses the same effective TTL for transport sessions and proof verification', () => {
    const sessionTtlMinutes = 37;
    vi.spyOn(AgentConfigManager, 'getInstance').mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === 'features') return { sessionPersistence: false };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 60 };
        if (key === 'templateContext') return { trust: 'disabled' };
        if (key === 'runtimeScopeStoragePath') return undefined;
        if (key === 'auth') return { sessionTtlMinutes };
        return undefined;
      }),
      getSessionBackgroundFlushSeconds: vi.fn(() => 60),
      getSessionTtlMinutes: vi.fn(() => sessionTtlMinutes),
    } as unknown as AgentConfigManager);
    const context: ContextData = {
      project: { name: 'agent', path: '/work/agent' },
      user: {},
      environment: {},
      sessionId: 'session-a',
    };
    const authorizeSpy = vi.spyOn(templateContextTrust, 'authorizeTemplateContext').mockReturnValue({
      status: 'disabled',
      reason: 'trust_disabled',
      contextHash: 'context-hash',
    });
    const repository = new StreamableSessionRepository({ writeData: vi.fn() } as never);
    const now = Date.now();

    repository.create('session-a', { context });
    authorizeRequestTemplateContext({ source: 'persisted', context, transportSessionId: 'session-a' });

    expect(repository.getSessionData('session-a')?.expires).toBeGreaterThanOrEqual(now + sessionTtlMinutes * 60 * 1000);
    expect(authorizeSpy).toHaveBeenCalledWith(expect.objectContaining({ maxAgeMs: sessionTtlMinutes * 60 * 1000 }));
    repository.stopPeriodicFlush();
  });
});

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
