import { Client } from '@modelcontextprotocol/client';

import { describe, expect, it, vi } from 'vitest';

import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter } from './modernSdkClientAdapter.js';

describe('ModernSdkClientAdapter', () => {
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

      expect(request).toHaveBeenCalledWith(expect.objectContaining({ method, params: expected }), expect.any(Object));
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
