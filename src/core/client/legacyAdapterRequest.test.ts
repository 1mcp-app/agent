import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { describe, expect, it, vi } from 'vitest';

import { requestLegacyAdapter } from './legacyAdapterRequest.js';

function adapterRejecting(error: unknown): LegacySdkAdapter {
  return { request: vi.fn().mockRejectedValue(error) } as unknown as LegacySdkAdapter;
}

describe('requestLegacyAdapter protocol error boundary', () => {
  it.each([1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992', '1.5', '', null, true])(
    'preserves a rejection with invalid numeric code %s',
    async (code) => {
      const failure = { code, message: 'Invalid code' };
      await expect(requestLegacyAdapter(adapterRejecting(failure), 'tools/list')).rejects.toBe(failure);
    },
  );

  it('does not execute an accessor-backed data property', async () => {
    const data = vi.fn(() => ({ secret: true }));
    const failure = Object.defineProperty({ code: '-32602', message: 'Invalid params' }, 'data', { get: data });
    await expect(requestLegacyAdapter(adapterRejecting(failure), 'tools/list')).rejects.toMatchObject({ code: -32602 });
    expect(data).not.toHaveBeenCalled();
  });
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
