import { Client } from '@modelcontextprotocol/client';

import { describe, expect, it, vi } from 'vitest';

import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter } from './modernSdkClientAdapter.js';

describe('ModernSdkClientAdapter', () => {
  it('quarantines malformed template syntax before catalog capture', async () => {
    const client = new Client({ name: 'configured-client', version: '2.0.0' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const healthy = { name: 'guide', uriTemplate: 'file:///{name}', unknown: [1] };
    vi.spyOn(client, 'request').mockResolvedValue({
      resourceTemplates: [healthy, { name: 'broken', uriTemplate: 'file:///{' }],
    } as never);
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    await expect(adapter.request({ id: 'templates' as never, method: 'resources/templates/list' })).resolves.toEqual({
      resourceTemplates: [healthy, null],
    });
  });

  it.each(['notifications/progress', 'notifications/cancelled', 'notifications/roots/list_changed'])(
    'strips inbound metadata from %s before SDK envelope generation',
    async (method) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const notify = vi.spyOn(client, 'notification').mockResolvedValue(undefined);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
      await adapter.notify({
        method,
        params: {
          progressToken: 'one',
          progress: 1,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2025-11-25',
            'io.modelcontextprotocol/clientInfo': { name: 'inbound', version: '1' },
          },
        },
      });
      expect(notify).toHaveBeenCalledWith({ method, params: { progressToken: 'one', progress: 1 } });
    },
  );

  it.each([
    ['tools/list', { cursor: 'page-2', _meta: { attacker: true } }, { cursor: 'page-2' }],
    [
      'tools/call',
      {
        name: 'echo',
        arguments: { text: 'hello' },
        _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'spoof' } },
      },
      { name: 'echo', arguments: { text: 'hello' } },
    ],
  ] as const)(
    'strips caller-controlled _meta from %s while preserving business params',
    async (method, params, expected) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' }, { capabilities: { roots: {} } });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const request = vi.spyOn(client, 'request').mockResolvedValue({ tools: [] } as never);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);

      await adapter.request({ id: `request-${method}`, method, params } as never);

      expect(request.mock.calls[0][0]).toMatchObject({ method, params: expected });
      expect(request.mock.calls[0].at(-1)).toMatchObject({ signal: expect.any(AbortSignal) });
    },
  );

  it.each(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list'])(
    'preserves opaque %s data and malformed siblings for catalog quarantine',
    async (method) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const result = { arbitrary: [{ nested: [1, true, null] }, { name: 42 }] };
      const request = vi.spyOn(client, 'request').mockResolvedValue(result as never);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
      const captured = await adapter.request({ id: `list-${method}`, method } as never);
      const schema = request.mock.calls[0][1];
      expect(await schema['~standard'].validate(result)).toEqual({ value: result });
      expect(captured).toEqual(result);
      expect(captured).not.toBe(result);
      expect(await schema['~standard'].validate(null)).toHaveProperty('issues');
    },
  );

  it('shares concurrent close work and publishes closed once', async () => {
    const client = new Client({ name: 'modern-test', version: '2.0.0' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    let finishClose!: () => void;
    const close = vi
      .spyOn(client, 'close')
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishClose = resolve)));
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);

    const first = adapter.close();
    const second = adapter.close();
    await vi.waitFor(() => expect(finishClose).toBeTypeOf('function'));
    expect(close).toHaveBeenCalledOnce();

    finishClose();
    await Promise.all([first, second, adapter.close()]);

    expect(close).toHaveBeenCalledOnce();
    await expect(adapter.nextEvent()).resolves.toEqual({ type: 'closed' });
  });
});
