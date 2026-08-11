import { ConfigManager } from '@src/config/configManager.js';
import { ClientStatus } from '@src/core/types/client.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdminInstructionPreviewRuntime } from './adminInstructionPreviewRuntime.js';

describe('createAdminInstructionPreviewRuntime', () => {
  afterEach(() => vi.restoreAllMocks());

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
  const serverManager = {
    getInstructionAggregator: () => ({
      previewInstructions: vi.fn(() => 'rendered'),
      getServerInstructions: vi.fn(() => 'upstream'),
      getEffectiveServerInstructions: vi.fn(() => 'upstream'),
    }),
    getClients: () => clients,
    getClientTransports: () => transports,
    getTemplateServerManager: () => ({
      getRenderedHashForSession: vi.fn(() => undefined),
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
  };
}
