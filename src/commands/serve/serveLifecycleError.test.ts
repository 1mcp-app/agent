import { RuntimeScopeOwnedError } from '@src/core/server/runtimeScopeOwnership.js';

import { describe, expect, it, vi } from 'vitest';

import { describeServeLifecycleFailure, markServeLifecycleFailure } from './serveLifecycleError.js';

describe('closed serve lifecycle guidance', () => {
  it.each([
    ['ownership', /already owns this Runtime Scope.*ownership.*recovery/],
    ['activation', /activation.*did not become ready/],
    ['recovery', /unreachable.*ownership retained.*recovery/],
    ['drain-aborted', /aborted.*drain deadline.*no stop was requested/],
    ['drain-timeout', /aborted at the drain deadline.*resume admission.*--drain-timeout.*will not be replayed/],
    ['transport', /requires HTTP transport/],
    ['configuration', /configuration is invalid/],
  ] as const)('preserves actionable %s guidance without exception contents', (code, expected) => {
    const error = new Error('credential-CANARY cause-CANARY /private/scope-CANARY', {
      cause: new Error('nested-CANARY'),
    });
    const marked = markServeLifecycleFailure(code, error);
    expect(marked).toBe(error);
    const output = describeServeLifecycleFailure(marked);
    expect(output).toMatch(expected);
    expect(output).not.toContain('CANARY');
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(512);
  });

  it('projects the existing ownership error without copying its private path, owner, or detail', () => {
    const error = new RuntimeScopeOwnedError('/private/scope-CANARY', 'ambiguous', null, 'token=secret-CANARY');
    const output = describeServeLifecycleFailure(error);
    expect(output).toContain('already owns this Runtime Scope');
    expect(output).toContain('ownership');
    expect(output).toContain('recovery');
    expect(output).not.toContain('CANARY');
  });

  it('does not classify arbitrary messages or execute error accessors, proxies, or causes', () => {
    const trap = vi.fn(() => {
      throw new Error('private-CANARY');
    });
    const getter = Object.defineProperties(new Error(), {
      message: { get: trap },
      cause: { get: trap },
      code: { get: trap },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const prototypeProxy = Object.create(new Proxy({}, { getPrototypeOf: trap }));
    for (const error of [
      getter,
      revoked.proxy,
      prototypeProxy,
      new Error('drain deadline private-CANARY'),
      { code: 'drain-timeout', message: 'private-CANARY' },
      'private-CANARY',
      null,
    ]) {
      expect(describeServeLifecycleFailure(error)).toBe(
        'Server startup failed. See the configured log for bounded failure facts.',
      );
    }
    expect(trap).not.toHaveBeenCalled();
  });
});
