import { Client } from '@modelcontextprotocol/client';

import { describe, expect, it, vi } from 'vitest';

import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter } from './modernSdkClientAdapter.js';

describe('ModernSdkClientAdapter', () => {
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
