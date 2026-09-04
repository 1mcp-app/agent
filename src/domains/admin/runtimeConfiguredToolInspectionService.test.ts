import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import {
  publishConfiguredToolSnapshot,
  readConfiguredToolSnapshot,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import type { PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type OutboundConnection, type OutboundConnections } from '@src/core/types/index.js';
import type { Tool } from '@src/sdk/contracts/index.js';

import { describe, expect, it, vi } from 'vitest';

import { createConfiguredToolInventory } from './configuredToolInventory.js';
import { RuntimeConfiguredToolInspectionService } from './runtimeConfiguredToolInspectionService.js';

const config = { type: 'stdio' as const, command: 'node' };

function tool(name: string): Tool {
  return { name, inputSchema: { type: 'object' } };
}

function connection(name: string, listTools: ReturnType<typeof vi.fn>): OutboundConnection {
  let outbound: OutboundConnection;
  let rejectPending: ((reason: Error) => void) | undefined;
  outbound = createMockOutboundConnection({
    name,
    status: ClientStatus.Connected,
    adapter: {
      request: vi.fn(
        ({ params }) =>
          new Promise<never>((resolve, reject) => {
            rejectPending = reject;
            const invoke = listTools as unknown as (params: unknown, options: unknown) => Promise<unknown>;
            Promise.resolve(invoke(params, {})).then((value) => resolve(value as never), reject);
          }),
      ),
      cancel: vi.fn(async () => {
        const timeout = (outbound.requestTimeoutMs ?? 60_000) * 4;
        rejectPending?.(new Error(`Tool inspection exceeded the ${timeout}ms deadline`));
      }),
    },
  });
  return outbound;
}

function templateInstance(
  id: string,
  name: string,
  outboundKeys: string[],
  _outbound: OutboundConnection,
): PooledClientInstance {
  return {
    id,
    instanceKey: `${name}:${id}`,
    templateName: name,
    client: {} as PooledClientInstance['client'],
    transport: {} as PooledClientInstance['transport'],
    renderedHash: id,
    runtimeFingerprint: id,
    processedConfig: config,
    referenceCount: 1,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    status: 'active',
    outboundKeys: new Set(outboundKeys),
    clientIds: new Set([`client-${id}`]),
    idleTimeout: 60_000,
  };
}

function runtime(
  clients: OutboundConnections,
  instances: Record<string, PooledClientInstance[]> = {},
): RuntimeConfiguredToolInspectionService {
  const serverManager = {
    getClients: () => clients,
    getTemplateServerManager: () => ({
      getTemplateInstances: (targetName: string) => instances[targetName] ?? [],
    }),
  } as unknown as ServerManager;
  return new RuntimeConfiguredToolInspectionService(serverManager);
}

describe('RuntimeConfiguredToolInspectionService', () => {
  it('inspects every static page and publishes only the complete result', async () => {
    const listTools = vi.fn(async (params?: { cursor?: string }) =>
      params?.cursor ? { tools: [tool('second')] } : { tools: [tool('first')], nextCursor: 'page-2' },
    );
    const outbound = connection('static-target', listTools);
    const clients = new Map<string, OutboundConnection>([['static-target', outbound]]);
    const service = runtime(clients);

    const inventory = await service.refresh({
      targetName: 'static-target',
      source: 'mcpServers',
      config,
    });

    expect(listTools).toHaveBeenNthCalledWith(1, undefined, expect.any(Object));
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-2' }, expect.any(Object));
    expect(inventory.freshness).toBe('live');
    expect(inventory.inspection).toMatchObject({ status: 'complete', retryable: false });
    expect(inventory.rows.map((row) => row.name)).toEqual(['first', 'second']);

    const recalculated = await service.read({
      targetName: 'static-target',
      source: 'mcpServers',
      config,
      model: 'gpt-4o-mini',
    });
    expect(recalculated.generation).toBe(inventory.generation);
    expect(recalculated.model).toBe('gpt-4o-mini');
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('bounds the total duration of a paginated inspection', async () => {
    vi.useFakeTimers();
    try {
      const listTools = vi.fn(
        (_params?: { cursor?: string }, options?: { signal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
          }),
      );
      const outbound = connection('deadline', listTools);
      outbound.requestTimeoutMs = 25;
      const refresh = runtime(new Map([['deadline', outbound]])).refresh({
        targetName: 'deadline',
        source: 'mcpServers',
        config,
      });

      await vi.advanceTimersByTimeAsync(100);
      const inventory = await refresh;

      expect(inventory.inspection).toMatchObject({ status: 'failed', reason: 'inspection_failed' });
      expect(inventory.inspection?.instances).toEqual([
        expect.objectContaining({ error: 'Tool inspection exceeded the 100ms deadline' }),
      ]);
      expect(listTools).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['disabled', { disabled: true }, ClientStatus.Connected, 'target_disabled'],
    ['disconnected', {}, ClientStatus.Disconnected, 'target_disconnected'],
  ] as const)('does not inspect a %s static target', async (_label, extra, status, reason) => {
    const listTools = vi.fn();
    const outbound = connection('static-target', listTools);
    outbound.status = status;
    const service = runtime(new Map([['static-target', outbound]]));

    const inventory = await service.refresh({
      targetName: 'static-target',
      source: 'mcpServers',
      config: { ...config, ...extra },
    });

    expect(listTools).not.toHaveBeenCalled();
    expect(inventory).toMatchObject({
      freshness: 'unavailable',
      inspection: { status: 'unavailable', reason },
    });
  });

  it('retains the last complete rows and generation when a retry fails', async () => {
    const listTools = vi.fn().mockResolvedValueOnce({ tools: [tool('known')] });
    const outbound = connection('static-retained', listTools);
    const service = runtime(new Map([['static-retained', outbound]]));
    const first = await service.refresh({ targetName: 'static-retained', source: 'mcpServers', config });

    listTools.mockRejectedValueOnce(new Error('backend unavailable'));
    const failed = await service.refresh({ targetName: 'static-retained', source: 'mcpServers', config });

    expect(failed.inspection).toMatchObject({ status: 'failed', reason: 'inspection_failed', retryable: true });
    expect(failed.freshness).toBe('unavailable');
    expect(failed.generation).toBe(first.generation);
    expect(failed.rows).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'known', stale: true })]));
    expect(readConfiguredToolSnapshot(outbound)?.map((item) => item.name)).toEqual(['known']);
  });

  it('rejects repeated pagination cursors without publishing partial pages', async () => {
    const listTools = vi.fn(async () => ({ tools: [tool('partial')], nextCursor: 'same' }));
    const outbound = connection('cyclic', listTools);
    const inventory = await runtime(new Map([['cyclic', outbound]])).refresh({
      targetName: 'cyclic',
      source: 'mcpServers',
      config,
    });

    expect(inventory.inspection).toMatchObject({ status: 'failed', reason: 'inspection_failed' });
    expect(readConfiguredToolSnapshot(outbound)).toBeUndefined();
    expect(inventory.rows).toEqual([]);
  });

  it('unions all active template instances and reports partial occurrence', async () => {
    const firstList = vi.fn(async () => ({ tools: [tool('common'), tool('only-first')] }));
    const secondList = vi.fn(async () => ({ tools: [tool('common')] }));
    const first = connection('template-target', firstList);
    const second = connection('template-target', secondList);
    const clients = new Map<string, OutboundConnection>([
      ['template-target:first', first],
      ['template-target:second', second],
    ]);
    const instances = {
      'template-target': [
        templateInstance('first', 'template-target', ['template-target:first'], first),
        templateInstance('second', 'template-target', ['template-target:second'], second),
      ],
    };

    const inventory = await runtime(clients, instances).refresh({
      targetName: 'template-target',
      source: 'mcpTemplates',
      config,
    });

    expect(inventory).toMatchObject({ freshness: 'live', activeInstanceCount: 2 });
    expect(inventory.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'common', observedInstanceCount: 2, observedInSomeInstances: false }),
        expect.objectContaining({ name: 'only-first', observedInstanceCount: 1, observedInSomeInstances: true }),
      ]),
    );
  });

  it('inspects a logical template instance once when it has multiple outbound aliases', async () => {
    const listTools = vi.fn(async () => ({ tools: [tool('shared')] }));
    const firstAlias = connection('aliased', listTools);
    const secondAlias = { ...firstAlias } as OutboundConnection;
    const clients = new Map<string, OutboundConnection>([
      ['aliased:one', firstAlias],
      ['aliased:two', secondAlias],
    ]);
    const instances = {
      aliased: [templateInstance('logical', 'aliased', ['aliased:one', 'aliased:two'], firstAlias)],
    };

    const inventory = await runtime(clients, instances).refresh({
      targetName: 'aliased',
      source: 'mcpTemplates',
      config,
    });

    expect(listTools).toHaveBeenCalledTimes(1);
    expect(inventory.activeInstanceCount).toBe(1);
    expect(readConfiguredToolSnapshot(firstAlias)?.map((item) => item.name)).toEqual(['shared']);
    expect(readConfiguredToolSnapshot(secondAlias)?.map((item) => item.name)).toEqual(['shared']);

    const passive = await runtime(clients, instances).read({
      targetName: 'aliased',
      source: 'mcpTemplates',
      config,
      model: 'gpt-4o-mini',
    });
    expect(passive.activeInstanceCount).toBe(1);
    expect(passive.generation).toBe(inventory.generation);
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('keeps passive template inventory unavailable when any active logical instance lacks a snapshot', async () => {
    const first = connection('passive-partial', vi.fn());
    const second = connection('passive-partial', vi.fn());
    publishConfiguredToolSnapshot(first, [tool('partial')]);
    const clients = new Map<string, OutboundConnection>([
      ['passive-partial:first', first],
      ['passive-partial:second', second],
    ]);
    const instances = {
      'passive-partial': [
        templateInstance('first', 'passive-partial', ['passive-partial:first'], first),
        templateInstance('second', 'passive-partial', ['passive-partial:second'], second),
      ],
    };

    const inventory = await runtime(clients, instances).read({
      targetName: 'passive-partial',
      source: 'mcpTemplates',
      config,
    });

    expect(inventory.inspection).toMatchObject({ status: 'unavailable', reason: 'snapshot_unavailable' });
    expect(inventory.freshness).toBe('unavailable');
    expect(inventory.rows.some((row) => row.observedInSomeInstances)).toBe(false);
    expect(first.adapter.request).not.toHaveBeenCalled();
    expect(second.adapter.request).not.toHaveBeenCalled();
  });

  it('publishes nothing when one active template instance fails', async () => {
    const firstList = vi.fn(async () => ({ tools: [tool('partial')] }));
    const secondList = vi.fn(async () => {
      throw new Error('failed instance');
    });
    const first = connection('partial-template', firstList);
    const second = connection('partial-template', secondList);
    const clients = new Map<string, OutboundConnection>([
      ['partial-template:first', first],
      ['partial-template:second', second],
    ]);
    const instances = {
      'partial-template': [
        templateInstance('first', 'partial-template', ['partial-template:first'], first),
        templateInstance('second', 'partial-template', ['partial-template:second'], second),
      ],
    };

    const inventory = await runtime(clients, instances).refresh({
      targetName: 'partial-template',
      source: 'mcpTemplates',
      config,
    });

    expect(inventory.inspection).toMatchObject({ status: 'failed' });
    expect(inventory.rows.some((row) => row.observedInSomeInstances)).toBe(false);
    expect(readConfiguredToolSnapshot(first)).toBeUndefined();
    expect(readConfiguredToolSnapshot(second)).toBeUndefined();
  });

  it('publishes nothing when the active template set changes during inspection', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listTools = vi.fn(async () => {
      await wait;
      return { tools: [tool('raced')] };
    });
    const outbound = connection('raced-template', listTools);
    const instances: Record<string, PooledClientInstance[]> = {
      'raced-template': [templateInstance('instance', 'raced-template', ['raced-template:instance'], outbound)],
    };
    const service = runtime(new Map([['raced-template:instance', outbound]]), instances);

    const refresh = service.refresh({ targetName: 'raced-template', source: 'mcpTemplates', config });
    await vi.waitFor(() => expect(listTools).toHaveBeenCalledTimes(1));
    instances['raced-template'] = [];
    release();
    const inventory = await refresh;

    expect(inventory.inspection).toMatchObject({ status: 'failed', reason: 'active_instances_changed' });
    expect(readConfiguredToolSnapshot(outbound)).toBeUndefined();
  });

  it('accepts the same active template instances returned in a different order', async () => {
    const first = connection('reordered-template', vi.fn());
    const second = connection(
      'reordered-template',
      vi.fn(async () => ({ tools: [tool('second')] })),
    );
    const instances = {
      'reordered-template': [
        templateInstance('first', 'reordered-template', ['reordered-template:first'], first),
        templateInstance('second', 'reordered-template', ['reordered-template:second'], second),
      ],
    };
    vi.mocked(first.adapter.request).mockImplementation(async () => {
      instances['reordered-template'].reverse();
      return { tools: [tool('first')] } as never;
    });
    const service = runtime(
      new Map([
        ['reordered-template:first', first],
        ['reordered-template:second', second],
      ]),
      instances,
    );

    const inventory = await service.refresh({
      targetName: 'reordered-template',
      source: 'mcpTemplates',
      config,
    });

    expect(inventory.inspection).toMatchObject({ status: 'complete', retryable: false });
    expect(inventory.rows.map((row) => row.name).sort()).toEqual(['first', 'second']);
  });

  it('does not instantiate a template with no active instances', async () => {
    const inventory = await runtime(new Map(), { empty: [] }).refresh({
      targetName: 'empty',
      source: 'mcpTemplates',
      config,
    });

    expect(inventory).toMatchObject({
      freshness: 'unavailable',
      activeInstanceCount: 0,
      inspection: { status: 'unavailable', reason: 'no_active_instances' },
    });
  });

  it('keeps same-name static and template retained snapshots isolated', async () => {
    const staticConnection = connection(
      'shared-name',
      vi.fn(async () => ({ tools: [tool('static-tool')] })),
    );
    const templateConnection = connection(
      'shared-name',
      vi.fn(async () => ({ tools: [tool('template-tool')] })),
    );
    const clients = new Map<string, OutboundConnection>([
      ['shared-name', staticConnection],
      ['shared-name:instance', templateConnection],
    ]);
    const instances = {
      'shared-name': [templateInstance('instance', 'shared-name', ['shared-name:instance'], templateConnection)],
    };
    const service = runtime(clients, instances);
    await service.refresh({ targetName: 'shared-name', source: 'mcpServers', config });
    await service.refresh({ targetName: 'shared-name', source: 'mcpTemplates', config });

    const staticRetained = await createConfiguredToolInventory({
      targetName: 'shared-name',
      source: 'mcpServers',
      config,
      connections: new Map(),
    });
    const templateRetained = await createConfiguredToolInventory({
      targetName: 'shared-name',
      source: 'mcpTemplates',
      config,
      connections: new Map(),
    });

    expect(staticRetained.rows.map((row) => row.name)).toEqual(['static-tool']);
    expect(templateRetained.rows.map((row) => row.name)).toEqual(['template-tool']);
  });

  it('joins concurrent refreshes for the same target', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listTools = vi.fn(async () => {
      await wait;
      return { tools: [tool('joined')] };
    });
    const outbound = connection('joined', listTools);
    const service = runtime(new Map([['joined', outbound]]));

    const first = service.refresh({ targetName: 'joined', source: 'mcpServers', config, model: 'gpt-4o' });
    const second = service.refresh({ targetName: 'joined', source: 'mcpServers', config, model: 'gpt-4o-mini' });
    release();
    const [firstInventory, secondInventory] = await Promise.all([first, second]);

    expect(listTools).toHaveBeenCalledTimes(1);
    expect(firstInventory.model).toBe('gpt-4o');
    expect(secondInventory.model).toBe('gpt-4o-mini');
    expect(firstInventory.generation).toBe(secondInventory.generation);
  });
});
