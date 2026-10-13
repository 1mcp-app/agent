import { describe, expect, it } from 'vitest';

import { ModernTemplateContextSessions } from './modernTemplateContext.js';

const context = {
  sessionId: 'proxy-a',
  project: { path: '/projects/a' },
  user: { username: 'alice' },
  environment: {},
  timestamp: '2026-10-12T00:00:00Z',
  transport: { type: 'stdio-proxy', connectionTimestamp: '2026-10-12T00:00:00Z' },
};

describe('modern logical template context binding', () => {
  it('rejects changes to effective project, environment and client facts within one session', () => {
    const sessions = new ModernTemplateContextSessions();
    sessions.bind(context);
    for (const changed of [
      { ...context, project: { path: '/projects/b' } },
      { ...context, environment: { variables: { REGION: 'b' } } },
      { ...context, transport: { ...context.transport, client: { name: 'other', version: '2' } } },
    ])
      expect(() => sessions.bind(changed)).toThrow('start a new Request Session');
    expect(sessions.bind({ ...context, sessionId: 'proxy-b' }).id).not.toBe(sessions.bind(context).id);
  });

  it('revokes an expired binding before the same session can acquire a new generation', () => {
    const sessions = new ModernTemplateContextSessions();
    const old = sessions.bind(context);
    expect(sessions.forget('proxy-a')).toBe(old);
    expect(sessions.bind(context).id).not.toBe(old.id);
  });

  it('preserves the first session facts across timestamp changes and reordered keys', () => {
    const sessions = new ModernTemplateContextSessions();
    const first = sessions.bind(context);
    const next = sessions.bind({
      ...context,
      project: { path: '/projects/a' },
      timestamp: '2026-10-12T00:01:00Z',
      transport: { connectionTimestamp: '2026-10-12T00:01:00Z', type: 'stdio-proxy' },
    });
    expect(next).toBe(first);
    expect(next.context.timestamp).toBe('2026-10-12T00:00:00Z');
  });
});
