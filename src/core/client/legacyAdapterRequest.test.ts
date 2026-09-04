import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { describe, expect, it, vi } from 'vitest';

import { requestLegacyAdapter } from './legacyAdapterRequest.js';

function adapterRejecting(error: unknown): LegacySdkAdapter {
  return { request: vi.fn().mockRejectedValue(error) } as unknown as LegacySdkAdapter;
}

describe('requestLegacyAdapter protocol error boundary', () => {
  it('restores numeric protocol codes from plain gateway failures', async () => {
    const data = { retryAfter: 1 };

    await expect(
      requestLegacyAdapter(adapterRejecting({ code: '401', message: 'Unauthorized', data }), 'tools/call'),
    ).rejects.toEqual(
      expect.objectContaining({ name: 'OneMcpProtocolError', code: 401, message: 'Unauthorized', data }),
    );
  });

  it('leaves symbolic gateway failure codes as plain data', async () => {
    const failure = { code: 'gateway_transport_failed', message: 'Transport failed' };

    await expect(requestLegacyAdapter(adapterRejecting(failure), 'tools/list')).rejects.toBe(failure);
  });

  it('does not execute accessor-backed error fields', async () => {
    const code = vi.fn(() => '401');
    const failure = Object.defineProperty({ message: 'Unauthorized' }, 'code', { get: code });

    await expect(requestLegacyAdapter(adapterRejecting(failure), 'tools/list')).rejects.toBe(failure);
    expect(code).not.toHaveBeenCalled();
  });
});
