import type { MCPServerParams } from '@src/core/types/index.js';
import type { ContextData } from '@src/types/context.js';
import { createTrustedTemplateContext } from '@src/utils/context/templateContextTrust.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareRequestContext, type RequestContextPreparationDependencies } from './requestContextPreparation.js';

describe('requestContextPreparation', () => {
  const context: ContextData = {
    version: '1.0.0',
    sessionId: 'context-session',
    project: { name: 'project', path: '/repo' },
    user: { uid: 'user-1', username: 'user' },
    environment: { variables: {} },
    timestamp: '2026-05-19T00:00:00.000Z',
  };

  const templateConfig: MCPServerParams = {
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    template: { shareable: true },
  };

  let deps: RequestContextPreparationDependencies;

  beforeEach(() => {
    deps = {
      deriveSessionId: vi.fn(() => 'derived-session'),
      loadRenderedTemplates: vi.fn().mockResolvedValue({ serena: templateConfig }),
      getRenderedHashForSession: vi.fn(() => undefined),
      touchEphemeralClient: vi.fn(),
      createTemplateBasedServers: vi.fn().mockResolvedValue(undefined),
      hasTemplateAdapter: vi.fn(() => false),
      registerTemplateAdapter: vi.fn(),
      getOutboundConnections: vi.fn(() => new Map()),
      getClientTransports: vi.fn(() => ({})),
      refreshCapabilities: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('returns no_context without rendering templates when no context or transport session is present', async () => {
    const result = await prepareRequestContext({ deps, filterConfig: {} });

    expect(result).toEqual({ status: 'no_context' });
    expect(deps.loadRenderedTemplates).not.toHaveBeenCalled();
    expect(deps.createTemplateBasedServers).not.toHaveBeenCalled();
  });

  it('returns a routing-only session for header sessions without context', async () => {
    const result = await prepareRequestContext({ deps, transportSessionId: 'header-session', filterConfig: {} });

    expect(result).toEqual({ status: 'routing_only', sessionId: 'header-session' });
    expect(deps.loadRenderedTemplates).not.toHaveBeenCalled();
    expect(deps.createTemplateBasedServers).not.toHaveBeenCalled();
  });

  it('does not render templates for an untrusted context', async () => {
    const result = await prepareRequestContext({
      deps,
      context: context as never,
      filterConfig: {},
    });

    expect(result).toEqual({ status: 'no_context' });
    expect(deps.loadRenderedTemplates).not.toHaveBeenCalled();
    expect(deps.createTemplateBasedServers).not.toHaveBeenCalled();
  });

  it('prefers transport session over context session and derived session', async () => {
    const trustedContext = createTrustedTemplateContext(context);
    const result = await prepareRequestContext({
      deps,
      context: trustedContext,
      transportSessionId: 'header-session',
      filterConfig: { tags: ['dev'] },
    });

    expect(result).toEqual({
      status: 'prepared',
      sessionId: 'header-session',
      templateNames: ['serena'],
      createdTemplateNames: ['serena'],
    });
    expect(deps.deriveSessionId).not.toHaveBeenCalled();
    expect(deps.loadRenderedTemplates).toHaveBeenCalledWith({
      ...context,
      sessionId: 'header-session',
    });
    expect(deps.createTemplateBasedServers).toHaveBeenCalledWith(
      'header-session',
      { ...context, sessionId: 'header-session' },
      { tags: ['dev'] },
      { mcpTemplates: { serena: templateConfig } },
      expect.any(Map),
      {},
      'ephemeral',
    );
    expect(context.sessionId).toBe('context-session');
    expect(deps.refreshCapabilities).toHaveBeenCalledOnce();
  });

  it('derives a canonical session id instead of trusting context session id', async () => {
    const trustedContext = createTrustedTemplateContext(context);
    const result = await prepareRequestContext({ deps, context: trustedContext, filterConfig: {} });

    expect(result).toMatchObject({ status: 'prepared', sessionId: 'derived-session' });
    expect(deps.deriveSessionId).toHaveBeenCalledWith(trustedContext);
    expect(deps.loadRenderedTemplates).toHaveBeenCalledWith({
      ...context,
      sessionId: 'derived-session',
    });
    expect(context.sessionId).toBe('context-session');
  });

  it('derives a session id when context has no session id', async () => {
    const contextWithoutSession = { ...context, sessionId: undefined };
    const trustedContext = createTrustedTemplateContext(contextWithoutSession);

    const result = await prepareRequestContext({ deps, context: trustedContext, filterConfig: {} });

    expect(result).toMatchObject({ status: 'prepared', sessionId: 'derived-session' });
    expect(deps.deriveSessionId).toHaveBeenCalledWith(trustedContext);
    expect(deps.loadRenderedTemplates).toHaveBeenCalledWith({
      ...contextWithoutSession,
      sessionId: 'derived-session',
    });
    expect(deps.createTemplateBasedServers).toHaveBeenCalledWith(
      'derived-session',
      { ...contextWithoutSession, sessionId: 'derived-session' },
      {},
      { mcpTemplates: { serena: templateConfig } },
      expect.any(Map),
      {},
      'ephemeral',
    );
    expect(contextWithoutSession.sessionId).toBeUndefined();
  });

  it('registers missing adapters even when all template instances are already prepared', async () => {
    deps.getRenderedHashForSession = vi.fn(() => 'hash123');
    const trustedContext = createTrustedTemplateContext(context);

    const result = await prepareRequestContext({ deps, context: trustedContext, filterConfig: {} });

    expect(result).toEqual({
      status: 'already_prepared',
      sessionId: 'derived-session',
      templateNames: ['serena'],
      createdTemplateNames: [],
    });
    expect(deps.registerTemplateAdapter).toHaveBeenCalledWith('serena', templateConfig);
    expect(deps.createTemplateBasedServers).not.toHaveBeenCalled();
    expect(deps.touchEphemeralClient).toHaveBeenCalledWith('derived-session');
    expect(deps.refreshCapabilities).not.toHaveBeenCalled();
  });

  it('does not register duplicate adapters', async () => {
    deps.hasTemplateAdapter = vi.fn(() => true);
    const trustedContext = createTrustedTemplateContext(context);

    await prepareRequestContext({ deps, context: trustedContext, filterConfig: {} });

    expect(deps.registerTemplateAdapter).not.toHaveBeenCalled();
  });
});
