import {
  createMockOutboundConnection,
  createMockOutboundConnections,
  createMockTransport,
} from '@test/unit-utils/MockFactories.js';

import { ConfigManager } from '@src/config/configManager.js';
import {
  authorizeTemplateContext,
  createTemplateContextProof,
  type TemplateContextCapability,
} from '@src/core/context/templateContextTrust.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdminInstructionPreviewRuntime } from './adminInstructionPreviewRuntime.js';

describe('createAdminInstructionPreviewRuntime', () => {
  afterEach(async () => {
    await ServerManager.resetInstance();
    vi.restoreAllMocks();
  });

  it('renders a trusted contextual template instance and leaves it unresolved without context', async () => {
    const clients = createMockOutboundConnections();
    const transports = {};
    const serverManager = ServerManager.getOrCreateInstance(
      { name: 'preview-test', version: '1.0.0' },
      { capabilities: {} },
      clients,
      transports,
    );
    const aggregator = new InstructionAggregator();
    serverManager.setInstructionAggregator(aggregator);
    clients.set(
      'contextual:other-session',
      createMockOutboundConnection({ name: 'contextual', transport: { ...createMockTransport(), tags: ['docs'] } }),
    );
    aggregator.setInstructions(
      { source: 'mcpTemplates', name: 'contextual' },
      'Other session instructions',
      'contextual:other-session',
    );

    const contextualConfig = { type: 'stdio' as const, command: 'node', args: ['contextual-server.js'] };
    const configManager = ConfigManager.getInstance();
    vi.spyOn(configManager, 'loadDeclaredServerConfigs').mockReturnValue({
      staticServers: {},
      templateServers: { contextual: { type: 'stdio', command: '{{project.name}}' } },
      errors: [],
    });
    vi.spyOn(configManager, 'loadConfigWithTemplates').mockResolvedValue({
      staticServers: {},
      templateServers: { contextual: contextualConfig },
      errors: [],
    });

    const templateServerManager = serverManager.getTemplateServerManager();
    vi.spyOn(templateServerManager, 'getRenderedHashForSession').mockReturnValue(undefined);
    vi.spyOn(templateServerManager, 'createTemplateBasedServers').mockImplementation(async (sessionId) => {
      const outboundKey = `contextual:${sessionId}`;
      clients.set(
        outboundKey,
        createMockOutboundConnection({
          name: 'contextual',
          transport: { ...createMockTransport(), tags: ['docs'] },
        }),
      );
      aggregator.setInstructions(
        { source: 'mcpTemplates', name: 'contextual' },
        'Contextual upstream instructions',
        outboundKey,
      );
    });
    const cleanupTemplateServers = vi
      .spyOn(templateServerManager, 'cleanupTemplateServers')
      .mockImplementation(async (sessionId) => {
        for (const key of clients.keys()) {
          if (key === `contextual:${sessionId}`) clients.delete(key);
        }
      });
    vi.spyOn(serverManager.getServerRegistry(), 'has').mockReturnValue(false);
    vi.spyOn(serverManager.getServerRegistry(), 'registerTemplate').mockImplementation(() => undefined);

    const capability: TemplateContextCapability = {
      version: 1,
      runtimeScopeId: 'admin-preview-test',
      secret: Buffer.alloc(32, 7).toString('base64url'),
    };
    const authorizeContext = (context: ContextData) => {
      const authorization = authorizeTemplateContext({
        mode: 'verified',
        context,
        proof: createTemplateContextProof(context, capability),
        capability,
        transportSessionId: context.sessionId,
      });
      return authorization.status === 'trusted' ? authorization.context : undefined;
    };
    const preview = createAdminInstructionPreviewRuntime(serverManager, undefined, authorizeContext);

    const withoutContext = await preview({
      identity: 'draft',
      surface: 'cli',
      template: '{{instructions}}',
      selection: { mode: 'all' },
    });

    expect(withoutContext.rendered).not.toContain('Contextual upstream instructions');
    expect(withoutContext.rendered).not.toContain('Other session instructions');
    expect(withoutContext.unresolvedTemplates).toEqual(['contextual']);
    expect(templateServerManager.createTemplateBasedServers).not.toHaveBeenCalled();
    expect(clients.has('contextual:other-session')).toBe(true);

    const withContext = await preview({
      identity: 'draft',
      surface: 'cli',
      template: '{{instructions}}',
      selection: { mode: 'all' },
      requestContext: {
        version: '1.0.0',
        project: { name: 'preview-project' },
        user: {},
        environment: {},
      },
    });

    expect(withContext.effectiveServers).toContainEqual({
      target: { source: 'mcpTemplates', name: 'contextual' },
      hasInstructions: true,
    });
    expect(withContext.rendered).toContain('Contextual upstream instructions');
    expect(withContext.rendered).not.toContain('Other session instructions');
    expect(withContext.unresolvedTemplates).toEqual([]);
    expect(templateServerManager.createTemplateBasedServers).toHaveBeenCalledOnce();
    expect(cleanupTemplateServers).toHaveBeenCalledOnce();
    expect(clients.has('contextual:other-session')).toBe(true);
    expect(Array.from(clients.keys()).filter((key) => key.startsWith('contextual:'))).toEqual([
      'contextual:other-session',
    ]);
  });

  it('leaves contextual templates unresolved without explicit context and creates no preview instance', async () => {
    const runtime = fixture();

    const result = await createAdminInstructionPreviewRuntime(
      runtime.serverManager as never,
      undefined,
      (context) => context as never,
    )({
      identity: 'draft',
      surface: 'cli',
      template: 'preview {{instructions}}',
      selection: { mode: 'all' },
    });

    expect(result).toMatchObject({ surface: 'cli', rendered: 'rendered', unresolvedTemplates: ['contextual'] });
    expect(runtime.loadConfigWithTemplates).not.toHaveBeenCalled();
    expect(runtime.createTemplateBasedServers).not.toHaveBeenCalled();
    expect(runtime.cleanupTemplateServers).not.toHaveBeenCalled();
  });

  it.each([
    ['Operator guidance', true],
    ['', false],
  ])('includes a disconnected static target with a %s override', async (instructionOverride, hasInstructions) => {
    const runtime = fixture();
    runtime.clients.clear();
    const aggregator = runtime.aggregator;
    aggregator.previewInstructions.mockImplementation((_template, _filter, connections) =>
      Array.from((connections ?? new Map()).keys()).join(','),
    );
    aggregator.getEffectiveServerInstructions.mockReturnValue(instructionOverride);

    const result = await createAdminInstructionPreviewRuntime(runtime.serverManager as never)({
      identity: 'draft',
      surface: 'cli',
      template: '{{instructions}}',
      selection: { mode: 'all' },
    });

    expect(aggregator.previewInstructions).toHaveBeenCalledWith(
      '{{instructions}}',
      expect.anything(),
      expect.objectContaining(new Map([['alpha', expect.anything()]])),
    );
    expect(result.effectiveServers).toContainEqual({
      target: { source: 'mcpServers', name: 'alpha' },
      hasInstructions,
    });
  });

  it('prepares and always cleans an explicit admin preview context', async () => {
    const runtime = fixture();
    runtime.loadConfigWithTemplates.mockResolvedValue({
      templateServers: { contextual: { type: 'stdio', command: 'node' } },
    });

    const result = await createAdminInstructionPreviewRuntime(
      runtime.serverManager as never,
      undefined,
      (context) => context as never,
    )({
      identity: 'draft',
      surface: 'initialization',
      template: 'preview {{instructions}}',
      selection: { mode: 'tags', tags: ['docs'] },
      requestContext: { project: { name: 'preview' }, user: {}, environment: {} },
    });

    expect(result.surface).toBe('initialize');
    expect(runtime.createTemplateBasedServers).toHaveBeenCalledWith(
      expect.stringMatching(/^rest-/),
      expect.objectContaining({ project: { name: 'preview' } }),
      expect.objectContaining({ tagFilterMode: 'simple-or', tags: ['docs'] }),
      expect.objectContaining({ mcpTemplates: { contextual: expect.any(Object) } }),
      runtime.clients,
      runtime.transports,
      'ephemeral',
    );
    expect(runtime.cleanupTemplateServers).toHaveBeenCalledWith(
      expect.stringMatching(/^rest-/),
      runtime.clients,
      runtime.transports,
    );
  });

  it('rejects raw context when the runtime authority does not trust it', async () => {
    const runtime = fixture();

    const result = await createAdminInstructionPreviewRuntime(
      runtime.serverManager as never,
      undefined,
      () => undefined,
    )({
      identity: 'draft',
      surface: 'cli',
      template: 'preview',
      selection: { mode: 'all' },
      requestContext: { project: { name: 'preview' }, user: {}, environment: {} },
    });

    expect(result.validation).toMatchObject({ code: 'request_context_untrusted' });
    expect(runtime.createTemplateBasedServers).not.toHaveBeenCalled();
  });

  it('cleans the preview session when capability refresh fails after instance creation', async () => {
    const runtime = fixture();
    runtime.loadConfigWithTemplates.mockResolvedValue({
      templateServers: { contextual: { type: 'stdio', command: 'node' } },
    });
    runtime.refreshCapabilities.mockRejectedValue(new Error('/private/runtime/config.json'));

    const result = await createAdminInstructionPreviewRuntime(
      runtime.serverManager as never,
      undefined,
      (context) => context as never,
    )({
      identity: 'draft',
      surface: 'cli',
      template: 'preview',
      selection: { mode: 'all' },
      requestContext: { project: { name: 'preview' }, user: {}, environment: {} },
    });

    expect(result.validation).toEqual({
      valid: false,
      code: 'instruction_preview_failed',
      message: 'Instruction preview preparation failed',
    });
    expect(JSON.stringify(result)).not.toContain('/private/runtime');
    expect(runtime.cleanupTemplateServers).toHaveBeenCalledTimes(1);
  });

  it('returns preset_not_found instead of widening an unknown preset to all servers', async () => {
    const runtime = fixture();
    const result = await createAdminInstructionPreviewRuntime(
      runtime.serverManager as never,
      {
        resolvePresetToExpression: vi.fn(() => undefined),
      } as never,
    )({
      identity: 'draft',
      surface: 'cli',
      template: 'preview',
      selection: { mode: 'preset', preset: 'missing' },
    });

    expect(result.validation).toMatchObject({ code: 'preset_not_found' });
    expect(runtime.createTemplateBasedServers).not.toHaveBeenCalled();
  });

  it('does not expose cleanup failure details', async () => {
    const runtime = fixture();
    runtime.loadConfigWithTemplates.mockResolvedValue({
      templateServers: { contextual: { type: 'stdio', command: 'node' } },
    });
    runtime.cleanupTemplateServers.mockRejectedValue(new Error('/private/runtime/config.json'));

    const result = await createAdminInstructionPreviewRuntime(
      runtime.serverManager as never,
      undefined,
      (context) => context as never,
    )({
      identity: 'draft',
      surface: 'cli',
      template: 'preview',
      selection: { mode: 'all' },
      requestContext: { project: { name: 'preview' }, user: {}, environment: {} },
    });

    expect(result.rendered).toBe('rendered');
    expect(JSON.stringify(result)).not.toContain('/private/runtime');
  });
});

function fixture() {
  const clients = new Map([
    [
      'alpha',
      {
        name: 'alpha',
        status: ClientStatus.Connected,
        transport: { tags: ['docs'] },
        client: {},
      },
    ],
  ]);
  const transports = {};
  const loadConfigWithTemplates = vi.fn(async () => ({ templateServers: {} }));
  vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
    loadDeclaredServerConfigs: () => ({
      staticServers: { alpha: { type: 'stdio', command: 'node' } },
      templateServers: { contextual: { type: 'stdio', command: '{{project.name}}' } },
      errors: [],
    }),
    loadConfigWithTemplates,
  } as never);
  const createTemplateBasedServers = vi.fn(async () => undefined);
  const cleanupTemplateServers = vi.fn(async () => undefined);
  const refreshCapabilities = vi.fn(async () => undefined);
  const aggregator = {
    previewInstructions: vi.fn(
      (_template?: string, _filter?: unknown, _connections?: Map<string, unknown>) => 'rendered',
    ),
    getServerInstructions: vi.fn(() => 'upstream'),
    getEffectiveServerInstructions: vi.fn(() => 'upstream'),
  };
  const serverManager = {
    getInstructionAggregator: () => aggregator,
    getClients: () => clients,
    getClientTransports: () => transports,
    getTemplateServerManager: () => ({
      getRenderedHashForSession: vi.fn(() => undefined),
      getAllRenderedHashesForSession: vi.fn(() => undefined),
      touchEphemeralClient: vi.fn(),
      createTemplateBasedServers,
      cleanupTemplateServers,
    }),
    getServerRegistry: () => ({ has: vi.fn(() => false), registerTemplate: vi.fn() }),
    getLazyLoadingOrchestrator: () => ({ refreshCapabilities }),
  };
  return {
    serverManager,
    clients,
    transports,
    loadConfigWithTemplates,
    createTemplateBasedServers,
    cleanupTemplateServers,
    refreshCapabilities,
    aggregator,
  };
}
