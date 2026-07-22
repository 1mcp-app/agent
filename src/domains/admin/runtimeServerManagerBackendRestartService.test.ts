import { describe, expect, it, vi } from 'vitest';

import { RuntimeServerManagerBackendRestartService } from './runtimeServerManagerBackendRestartService.js';

describe('RuntimeServerManagerBackendRestartService', () => {
  it('reports a configured template with no active instances without creating one', async () => {
    const templateManager = {
      getTemplateInstances: vi.fn().mockReturnValue([]),
      resolveTemplateInstance: vi.fn(),
      restartTemplateInstance: vi.fn(),
    };
    const service = new RuntimeServerManagerBackendRestartService({
      serverManager: {
        getTemplateServerManager: () => templateManager,
        getClient: vi.fn(),
        loadMcpServer: vi.fn(),
      } as any,
      resolveTarget: () => ({ source: 'mcpTemplates', serverConfig: { command: 'node' } }),
    });

    await expect(service.restart({ targetName: 'demo', selection: { mode: 'target_default' } })).resolves.toEqual({
      targetName: 'demo',
      targetType: 'template',
      outcome: 'no_active_instances',
      restartedInstanceIds: [],
    });
    expect(templateManager.restartTemplateInstance).not.toHaveBeenCalled();
  });

  it('restarts only unhealthy template instances by default and returns short IDs', async () => {
    const healthy = { id: 'a'.repeat(64), referenceCount: 1, supervision: { state: 'connected' } };
    const unhealthy = { id: 'b'.repeat(64), referenceCount: 1, supervision: { state: 'crash-loop' } };
    const templateManager = {
      getTemplateInstances: vi.fn().mockReturnValue([healthy, unhealthy]),
      resolveTemplateInstance: vi.fn(),
      restartTemplateInstance: vi.fn().mockResolvedValue(undefined),
    };
    const service = new RuntimeServerManagerBackendRestartService({
      serverManager: { getTemplateServerManager: () => templateManager } as any,
      resolveTarget: () => ({ source: 'mcpTemplates', serverConfig: { command: 'node' } }),
    });

    await expect(service.restart({ targetName: 'demo', selection: { mode: 'target_default' } })).resolves.toEqual({
      targetName: 'demo',
      targetType: 'template',
      outcome: 'restarted',
      restartedInstanceIds: ['bbbbbbbbbbbb'],
    });
    expect(templateManager.restartTemplateInstance).toHaveBeenCalledWith(unhealthy);
  });

  it('does not treat a declared template without a template property as a static server', async () => {
    const templateManager = {
      getTemplateInstances: vi.fn().mockReturnValue([]),
      resolveTemplateInstance: vi.fn(),
      restartTemplateInstance: vi.fn(),
    };
    const loadMcpServer = vi.fn();
    const service = new RuntimeServerManagerBackendRestartService({
      serverManager: { getTemplateServerManager: () => templateManager, loadMcpServer } as any,
      resolveTarget: () => ({ source: 'mcpTemplates', serverConfig: { command: 'node' } }),
    });

    await expect(service.restart({ targetName: 'demo', selection: { mode: 'target_default' } })).resolves.toMatchObject(
      {
        targetType: 'template',
        outcome: 'no_active_instances',
      },
    );
    expect(loadMcpServer).not.toHaveBeenCalled();
  });

  it('distinguishes healthy active instances from a template with no active instances', async () => {
    const healthy = { id: 'a'.repeat(64), referenceCount: 1, supervision: { state: 'connected' } };
    const templateManager = {
      getTemplateInstances: vi.fn().mockReturnValue([healthy]),
      resolveTemplateInstance: vi.fn(),
      restartTemplateInstance: vi.fn(),
    };
    const service = new RuntimeServerManagerBackendRestartService({
      serverManager: { getTemplateServerManager: () => templateManager } as any,
      resolveTarget: () => ({ source: 'mcpTemplates', serverConfig: { command: 'node' } }),
    });

    await expect(service.restart({ targetName: 'demo', selection: { mode: 'target_default' } })).resolves.toMatchObject(
      {
        targetType: 'template',
        outcome: 'no_unhealthy_instances',
      },
    );
    expect(templateManager.restartTemplateInstance).not.toHaveBeenCalled();
  });

  it('does not target zero-membership pooled template instances', async () => {
    const idle = { id: 'a'.repeat(64), referenceCount: 0, supervision: { state: 'crash-loop' } };
    const templateManager = {
      getTemplateInstances: vi.fn().mockReturnValue([idle]),
      resolveTemplateInstance: vi.fn(),
      restartTemplateInstance: vi.fn(),
    };
    const service = new RuntimeServerManagerBackendRestartService({
      serverManager: { getTemplateServerManager: () => templateManager } as any,
      resolveTarget: () => ({ source: 'mcpTemplates', serverConfig: { command: 'node' } }),
    });

    await expect(service.restart({ targetName: 'demo', selection: { mode: 'all_instances' } })).resolves.toMatchObject({
      targetType: 'template',
      outcome: 'no_active_instances',
    });
    await expect(
      service.restart({ targetName: 'demo', selection: { mode: 'instance', instanceIdOrPrefix: 'a' } }),
    ).resolves.toMatchObject({
      targetType: 'template',
      outcome: 'no_active_instances',
    });
    expect(templateManager.restartTemplateInstance).not.toHaveBeenCalled();
  });
});
